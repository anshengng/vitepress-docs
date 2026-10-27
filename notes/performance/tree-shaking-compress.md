# Tree-shaking、压缩与资源优化

产物体积的优化可以按「先删除、再压缩、最后换格式」三层来做：

```
① 删掉没用的代码      Tree-shaking、按需引入
        ↓
② 删掉代码里的冗余    minify、去掉 console / 注释
        ↓
③ 让传输的字节更小    gzip / brotli、图片 / 字体换格式
```

## 一、Tree-shaking 生效的四个前提

Tree-shaking 不是打开开关就必然生效，它同时依赖下面四件事：

| 前提 | 不满足会怎样 |
| --- | --- |
| **使用 ESM**（`import` / `export`） | CJS 的 `require` 是运行时函数调用，无法静态分析 |
| **模块无副作用**，或已正确标注 `sideEffects` | 打包器不敢删，怕删掉「导入即执行」的副作用 |
| **打包器能做静态分析** | 动态属性访问、`eval`、把模块整体挂到对象上都会让分析失效 |
| **生产模式** | 开发模式通常不做完整的删除与压缩 |

## 二、sideEffects：告诉打包器「这个包可以放心删」

```json
{
  "name": "my-lib",
  "sideEffects": false
}
```

如果库里有必须保留的副作用（典型是 CSS、polyfill）：

```json
{
  "sideEffects": [
    "*.css",
    "*.scss",
    "./src/polyfill.js"
  ]
}
```

注意：

- 把 `sideEffects` 写成 `false` 却含有 CSS 导入，会导致样式被删掉——这是实际项目里最常见的「样式消失」原因。
- 业务项目里对内部组件库同样适用：纯组件目录可以标 `false`，带副作用初始化的文件要单独列出。

## 三、破坏 Tree-shaking 的常见写法

| 写法 | 为什么失效 | 改法 |
| --- | --- | --- |
| `const _ = require('lodash')` | CJS 无法静态分析导出了哪些成员 | 用 `import { debounce } from 'lodash-es'` |
| `import * as _ from 'lodash'` 后动态取用 | 整个命名空间被引用，打包器不敢删 | 具名导入，或按需引入子模块 |
| 桶文件 `export * from './a'; export * from './b'` | 容易把整目录拉进依赖图 | 直接从具体文件导入，或使用 `sideEffects` 标注 |
| 顶层副作用代码 | 打包器无法判断能否删除 | 把副作用收敛到明确入口，或加 `/*#__PURE__*/` |
| Babel 把 ESM 转成 CJS | 打包器拿到的已是 `require` | `@babel/preset-env` 设置 `modules: false` |
| 动态属性访问 `obj[key]` | 打包器无法确定用到哪些导出 | 改成静态访问或显式白名单 |

标记纯函数调用，帮助压缩器删除未使用的调用：

```js
const result = /*#__PURE__*/ createHeavyObject()
```

## 四、Webpack 与 Rollup 的差异

| 维度 | Webpack | Rollup |
| --- | --- | --- |
| 分析方式 | `usedExports` + `sideEffects` + Terser 删除 | 基于作用域的深度分析，标记 `included` |
| 默认行为 | 生产模式默认开启 | `treeshake` 默认开启 |
| 副作用判断 | 依赖 `package.json` 的 `sideEffects` | 内置 `hasEffects` 判定 + 插件提示 |
| 典型失效点 | Babel 转 CJS、`sideEffects` 配置错误 | 顶层副作用、动态导入变量 |

Rollup 的判定细节见 [Tree-shaking 原理](/notes/rollup/tree-shaking)。

## 五、代码压缩

### JS

```js
// Webpack：Terser
const TerserPlugin = require('terser-webpack-plugin')

optimization: {
  minimizer: [
    new TerserPlugin({
      parallel: true,
      terserOptions: {
        compress: {
          drop_console: true,      // 去掉 console
          drop_debugger: true,
          passes: 2                // 多轮压缩，体积更小但更慢
        },
        format: { comments: false }
      }
    })
  ]
}
```

```ts
// Vite：默认 esbuild，需要更激进时再换 terser
export default defineConfig({
  build: {
    minify: 'terser',
    terserOptions: {
      compress: { drop_console: true, drop_debugger: true }
    }
  }
})
```

取舍：

- **esbuild 压缩快很多，terser 压缩率略高**。大多数项目用 esbuild 即可。
- `drop_console` 会连错误日志一起删，生产环境排查问题会变难；可改用 `pure_funcs: ['console.log']` 只删指定方法。

### CSS

```js
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin')

optimization: {
  minimizer: [
    new CssMinimizerPlugin()   // 默认使用 cssnano，也可配 lightningcss
  ]
}
```

## 六、传输压缩：gzip / brotli

压缩是「服务器发送时」做的事，和构建期的 minify 不是一回事：

| 方式 | 压缩率 | 兼容性 | 适用 |
| --- | --- | --- | --- |
| gzip | 中 | 全平台 | 通用兜底 |
| brotli | 更高（文本通常再小 15%~25%） | 现代浏览器 + HTTPS | 静态资源优先 |

构建时预生成压缩文件：

```js
// Webpack
const CompressionPlugin = require('compression-webpack-plugin')

plugins: [
  new CompressionPlugin({
    filename: '[path][base].gz',
    algorithm: 'gzip',
    test: /\.(js|css|html|svg)$/,
    threshold: 10240
  }),
  new CompressionPlugin({
    filename: '[path][base].br',
    algorithm: 'brotliCompress',
    test: /\.(js|css|html|svg)$/,
    threshold: 10240
  })
]
```

```ts
// Vite
import compression from 'vite-plugin-compression'

export default defineConfig({
  plugins: [
    compression({ algorithm: 'gzip' }),
    compression({ algorithm: 'brotliCompress', ext: '.br' })
  ]
})
```

服务端要配合开启静态压缩文件（如 Nginx 的 `gzip_static on;`），否则预压缩的文件不会被使用。如果 CDN 已自动压缩，构建期就可以省掉这一步。

## 七、图片与字体

### 图片

| 手段 | 效果 |
| --- | --- |
| WebP / AVIF | 比 JPG 小 25%~50%，现代浏览器支持 |
| `srcset` + `sizes` | 按屏幕密度返回合适尺寸，避免大图小用 |
| `loading="lazy"` | 首屏外图片延后加载 |
| `decoding="async"` | 图片解码不阻塞主线程 |
| 构建期压缩 | 统一转格式、压质量；建议放 CI，避免拖慢开发 |

```html
<img
  src="photo-800.webp"
  srcset="photo-400.webp 400w, photo-800.webp 800w, photo-1600.webp 1600w"
  sizes="(max-width: 600px) 400px, 800px"
  loading="lazy"
  decoding="async"
  alt="示例图片"
/>
```

### 字体

- 优先 `woff2`，体积最小、现代浏览器全支持。
- 做**字形子集化**（只保留实际用到的字符），中文字体收益尤其大。
- `font-display: swap` 避免字体阻塞文本渲染。
- 首屏关键字体可以用 `preload`，但别滥用（见[资源提示符](/interview/frontend-basics/resource-hints)）。

### 内联阈值

小资源内联能减少请求，但会增大 JS/CSS：

```ts
// Vite：小于 4 KB 的资源转 base64
build: { assetsInlineLimit: 4096 }
```

```js
// Webpack：asset 模块的内联条件
{
  test: /\.(png|svg)$/,
  type: 'asset',
  parser: { dataUrlCondition: { maxSize: 4 * 1024 } }
}
```

## 八、验收方式

- 构建输出里对比 **原始体积和 gzip 体积**
- 用 bundle analyzer 确认目标库确实被摇掉
- 搜产物里是否还有 `console.`、sourcemap 注释、未使用的语言包
- 用 `source-map-explorer` 看体积归属

## 工具对比小节

| 能力 | Webpack | Vite | Rollup | esbuild |
| --- | --- | --- | --- | --- |
| Tree-shaking | `usedExports` + `sideEffects` | 由 Rollup 完成 | `treeshake: true` | `treeShaking: true` |
| JS 压缩 | Terser / esbuild | esbuild / terser | 插件（terser） | 内置 `minify` |
| CSS 压缩 | `css-minimizer-webpack-plugin` | esbuild / lightningcss | 插件 | 内置 `minify` |
| 预压缩 gzip/br | `compression-webpack-plugin` | `vite-plugin-compression` | 插件 | 无内置 |
| 图片处理 | `asset` 模块 + 压缩插件 | `assetsInlineLimit` + 图片插件 | 插件 | `loader: 'dataurl' / 'file'` |
| 删除 console | `terserOptions.compress.drop_console` | `terserOptions` | 插件 | `drop: ['console']` |

## 相关页面

- [Rollup Tree-shaking 原理](/notes/rollup/tree-shaking)
- [Rollup 基础配置 · treeshake](/notes/rollup/config-basics)
- [Webpack 基础配置 · optimization](/notes/webpack/config-basics)
- [esbuild 基础配置](/notes/esbuild/config-basics)
- [前端基础 · 文件压缩方案](/interview/frontend-basics/file-compression)
- [前端基础 · 资源提示符](/interview/frontend-basics/resource-hints)
