# 代码分割与分包策略

分包的目标不是「拆得越多越好」，而是三件事：

1. **首屏只下载必需代码**，把非首屏逻辑延后
2. **按变更频率分组**，让不常变的库长期命中缓存
3. **避免单个 chunk 过大**，让下载与解析可以并行

## 一、两个分割点

| 分割方式 | 触发者 | 特点 |
| --- | --- | --- |
| 动态 `import()` | 业务代码 | 天然分割点，打包器自动产出独立 chunk |
| 手动/自动分组 | 构建配置 | 把多个模块归并到指定 chunk，控制缓存粒度 |

两者是配合关系：动态 import 决定「哪些代码可以晚点加载」，分组策略决定「晚点加载的代码怎么归堆」。

## 二、路由级懒加载

最常见的落地方式是按路由拆分：

```ts
// Vue Router
const routes = [
  {
    path: '/',
    component: () => import('@/views/Home.vue')
  },
  {
    path: '/about',
    component: () => import('@/views/About.vue')   // 独立 chunk
  }
]
```

```tsx
// React Router + lazy
import { lazy, Suspense } from 'react'

const About = lazy(() => import('./views/About'))

function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <Routes>
        <Route path="/about" element={<About />} />
      </Routes>
    </Suspense>
  )
}
```

动态 import 的注释可以指定 chunk 名（Webpack 支持魔法注释）：

```js
const Chart = () => import(/* webpackChunkName: "chart" */ './Chart.vue')
```

## 三、Webpack：splitChunks

```js
module.exports = {
  output: {
    filename: 'js/[name].[contenthash:8].js',
    chunkFilename: 'js/[name].[contenthash:8].js'
  },
  optimization: {
    // 把运行时代码单独抽出：它几乎每次构建都变，
    // 混在业务 chunk 里会让 contenthash 失效
    runtimeChunk: 'single',
    moduleIds: 'deterministic',
    chunkIds: 'deterministic',
    splitChunks: {
      chunks: 'all',              // 同时作用于初始和异步 chunk
      minSize: 20_000,            // 小于 20 KB 不单独拆
      maxInitialRequests: 30,     // 入口 chunk 的最多并行请求数
      cacheGroups: {
        react: {
          test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
          name: 'react',
          priority: 30,
          reuseExistingChunk: true
        },
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendor',
          priority: 10,
          reuseExistingChunk: true
        },
        common: {
          minChunks: 2,           // 被两个以上入口共用才抽
          name: 'common',
          priority: 5,
          reuseExistingChunk: true
        }
      }
    }
  }
}
```

关键参数：

| 参数 | 作用 | 常见误区 |
| --- | --- | --- |
| `chunks: 'all'` | 初始 + 异步 chunk 都参与拆分 | 只写 `async` 会导致首屏库全进入口包 |
| `minSize` | 小于阈值不拆，避免碎包 | 设得太小会产出大量小请求 |
| `maxInitialRequests` | 入口最多并行请求数 | 拆得太碎会顶到这个上限，反而合并 |
| `cacheGroups.priority` | 同模块命中多个组时的优先级 | 不设优先级会出现「库被塞进业务包」 |
| `reuseExistingChunk` | 复用已有 chunk | 关掉会产生重复模块 |
| `runtimeChunk: 'single'` | 抽离 runtime | 不做会让任何业务改动都影响入口 hash |

## 四、Vite / Rollup：manualChunks

对象形式最稳妥，语义就是「这些包归到一个 chunk」：

```ts
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vue-core': ['vue', 'vue-router', 'pinia'],
          echarts: ['echarts']
        }
      }
    }
  }
})
```

函数形式更灵活，适合按目录归类，但要小心循环 chunk 依赖：

```ts
manualChunks(id) {
  if (!id.includes('node_modules')) return
  if (id.includes('/echarts/')) return 'echarts'
  if (id.includes('/lodash-es/')) return 'lodash'
  return 'vendor'
}
```

实践建议：

- **优先用对象形式**。函数形式容易把互相依赖的包拆进不同 chunk，产生循环引用警告。
- 大库单独成 chunk（如 `echarts`、`monaco-editor`），它们体积大、变更少，最适合长效缓存。
- 不要把 `node_modules` 无脑拆成几十个 chunk：请求开销和缓存碎片都会增加。

## 五、分包粒度的权衡

| 策略 | 优点 | 缺点 | 适用 |
| --- | --- | --- | --- |
| 全部打成一个包 | 请求最少 | 首屏大、任何改动都让整包缓存失效 | 小型项目、离线应用 |
| 单个 vendor 包 | 简单、缓存稳定 | vendor 仍然可能很大 | 中小型项目 |
| 核心库 + 大库 + 业务 | 缓存粒度好、首屏可控 | 配置复杂一点 | 中大型项目（推荐） |
| 按包无限拆分 | 单包小 | 请求多、缓存碎片、循环依赖风险 | 一般不推荐 |

推荐的分组模型：

```
entry（业务入口，变化频繁）
 ├─ runtime（构建运行时，必需单独抽）
 ├─ framework（vue/react 核心，几乎不变）
 ├─ large-lib（echarts / monaco 等，按需加载）
 ├─ vendor（其余第三方，较少变化）
 └─ 路由 chunk（按页面懒加载）
```

## 六、验证分包效果

构建后先看产物体积分布：

```bash
# Vite 输出会直接打印每个 chunk 的 gzip 大小
npm run build
```

如果某个 chunk 异常大，用分析工具定位：

```bash
npx vite-bundle-visualizer        # Vite
npx webpack-bundle-analyzer stats.json   # Webpack
```

具体用法见[度量与分析](/notes/performance/measurement)。

## 工具对比小节

| 能力 | Webpack | Vite (Rollup) | Rollup | esbuild |
| --- | --- | --- | --- | --- |
| 自动拆分 | `splitChunks` | 由 Rollup 处理 | 默认只按动态 import 拆 | `splitting: true`（仅 ESM + outdir） |
| 手动分组 | `cacheGroups` | `manualChunks` | `manualChunks` / `output` | 不支持细粒度手动分组 |
| 运行时代码抽离 | `runtimeChunk` | 默认处理 | 默认处理 | 默认处理 |
| 长效缓存文件名 | `[contenthash]` | `[hash]` | `[hash]` | `[hash]` |
| 路由懒加载 | 动态 import | 动态 import | 动态 import | 动态 import |

## 相关页面

- [Vite build 构建配置 · rollupOptions](/notes/vite/build)
- [Webpack 基础配置 · optimization](/notes/webpack/config-basics)
- [Rollup 基础配置 · output](/notes/rollup/config-basics)
- [esbuild 基础配置 · splitting](/notes/esbuild/config-basics)
- [Tree-shaking、压缩与资源优化](/notes/performance/tree-shaking-compress)
