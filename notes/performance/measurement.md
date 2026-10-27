# 度量与分析：让优化有数据

优化前先回答三个问题：**慢在哪、有多慢、改完有没有变好**。这一页把「构建、体积、加载、运行时」四类度量串起来，并给出可直接落地的命令和 CI 基线方案。

## 一、度量什么

| 维度 | 关键指标 | 常用工具 |
| --- | --- | --- |
| 构建 | 冷构建耗时、热构建耗时、各阶段占比 | `--profile`、SMP、`perf`、`--debug` |
| 体积 | chunk 原始大小、gzip/brotli 后大小、模块归属 | bundle analyzer、source-map-explorer |
| 加载 | FCP、LCP、请求数、传输字节 | Lighthouse、Chrome Network |
| 运行时 | INP、CLS、长任务、FPS | Lighthouse、`web-vitals`、Performance 面板 |

**实验室数据 ≠ 真实用户数据**。Lighthouse 是可复现的实验室指标，RUM（真实用户监控）才能反映不同网络、设备下的实际体验，两者要结合看。

## 二、构建度量

### Webpack

```bash
# 生成包含各模块 / 各阶段耗时的 stats.json
npx webpack --profile --json > stats.json
```

```js
// 打印每个 loader / plugin 的耗时
const SpeedMeasurePlugin = require('speed-measure-webpack-plugin')
module.exports = new SpeedMeasurePlugin().wrap({
  // webpack config
})
```

### Vite

```bash
vite build --debug     # 输出插件、解析、转换等调试信息
vite --profile         # 启动 CPU profiler
```

### Rollup

```js
export default {
  perf: true,          // 打印各阶段耗时
  // ...
}
```

### 记录方式

至少记录两组数据，并注明环境：

| 场景 | 说明 |
| --- | --- |
| 冷构建 | 清掉 `node_modules/.cache` 后的首次构建 |
| 热构建 | 缓存命中、只改一个文件后的增量构建 |

只看冷构建会低估缓存价值，只看热构建会掩盖首次安装后的真实成本。

## 三、体积分析

### Webpack

```bash
npx webpack-bundle-analyzer stats.json
```

### Vite / Rollup

```bash
npx vite-bundle-visualizer
# 或直接在 rollup 配置里使用 rollup-plugin-visualizer
```

### 任意产物

```bash
npx source-map-explorer dist/assets/*.js
```

### 看什么

| 现象 | 可能原因 |
| --- | --- |
| 某个第三方包异常大 | 全量引入（如整个 `lodash`、`moment` 带语言包） |
| 同一依赖出现多份 | 版本不一致、多个包各自打包了一份 |
| 业务代码占比很低 | vendor 没拆、或把大库打进了入口 |
| gzip 后仍然很大 | 未压缩的资源、图片内联过多、sourcemap 混入 |
| 出现未使用的导出 | Tree-shaking 被 CJS 或副作用挡住 |

## 四、加载与运行时度量

### Lighthouse / Lighthouse CI

```bash
npx lighthouse http://localhost:4173 --view
```

CI 中用 Lighthouse CI 设置分数红线：

```yaml
# .lighthouserc.yml
ci:
  collect:
    staticDistDir: ./dist
  assert:
    assertions:
      'categories:performance': ['warn', { minScore: 0.9 }]
      'largest-contentful-paint': ['warn', { maxNumericValue: 2500 }]
```

### Core Web Vitals 阈值

| 指标 | 含义 | 良好 | 需改进 |
| --- | --- | --- | --- |
| LCP | 最大内容绘制，衡量「看到主要内容」 | ≤ 2.5 s | 2.5 ~ 4 s |
| INP | 交互到下一次绘制，衡量「响应快不快」 | ≤ 200 ms | 200 ~ 500 ms |
| CLS | 布局偏移，衡量「页面稳不稳」 | ≤ 0.1 | 0.1 ~ 0.25 |

### 代码里采集真实数据

```ts
import { onLCP, onINP, onCLS } from 'web-vitals'

onLCP(metric => report('lcp', metric.value))
onINP(metric => report('inp', metric.value))
onCLS(metric => report('cls', metric.value))
```

长任务可以直接用 `PerformanceObserver` 观察：

```ts
new PerformanceObserver(list => {
  for (const entry of list.getEntries()) {
    if (entry.duration > 50) {
      console.log('长任务', entry.duration, entry.name)
    }
  }
}).observe({ type: 'longtask', buffered: true })
```

## 五、在 CI 里守住体积预算

`size-limit` 可以在 PR 阶段拦住「不小心把包变大」：

```json
{
  "size-limit": [
    {
      "name": "入口 JS",
      "path": "dist/assets/index-*.js",
      "limit": "150 kB"
    },
    {
      "name": "总 CSS",
      "path": "dist/assets/*.css",
      "limit": "60 kB"
    }
  ]
}
```

```json
{
  "scripts": {
    "size": "size-limit"
  }
}
```

CI 中还可以同时记录构建耗时，和历史值比较：

```
PR 构建耗时：42.3s（基线 38.1s，+11%）
入口体积：152 kB（基线 148 kB，+2.7%）
```

超出阈值就让流水线失败或至少标记警告，避免性能问题悄悄累积。

## 六、一次完整的排查流程

```
发现异常（首屏慢 / 包变大 / 构建变慢）
        │
        ▼
① 量化：拿到基线数字（体积、耗时、LCP）
        │
        ▼
② 定位：analyzer 看模块归属；profile 看阶段耗时
        │
        ▼
③ 归因：是依赖问题、配置问题，还是代码写法问题
        │
        ▼
④ 修改：一次只改一个变量
        │
        ▼
⑤ 回归：同一环境、同一指标复测
        │
        ▼
⑥ 固化：写进 CI 预算，防止回退
```

三个典型案例：

| 症状 | 定位结果 | 处理 |
| --- | --- | --- |
| 包体突然 +400 KB | 新引入的图表库全量打包 | 改按需引入 + 独立 chunk |
| 首屏 LCP 4.5 s | 入口 chunk 太大、图片未压缩 | 路由懒加载 + WebP + 预加载关键资源 |
| 构建从 20 s 涨到 60 s | 新插件对全量文件做 AST 转换 | 收窄 `include` 范围，或改为 `apply: 'build'` |

## 工具对比小节

| 能力 | Webpack | Vite | Rollup | esbuild |
| --- | --- | --- | --- | --- |
| 构建耗时分析 | `--profile` + SMP | `--debug` / `--profile` | `perf: true` | `metafile` |
| 产物体积分析 | `webpack-bundle-analyzer` | `vite-bundle-visualizer` | `rollup-plugin-visualizer` | 基于 `metafile` 自行分析 |
| 构建统计文件 | `stats.json` | `--debug` 输出 | `perf` 输出 | `metafile`（JSON） |
| 运行时指标 | 无内置，接 `web-vitals` | 无内置，接 `web-vitals` | 不适用 | 不适用 |
| CI 体积预算 | `size-limit` | `size-limit` | `size-limit` | `size-limit` |

## 相关页面

- [性能优化总览](/notes/performance/overview)
- [Webpack 构建提速](/notes/performance/build-speed-webpack)
- [Vite 与 Rollup 构建提速](/notes/performance/build-speed-vite-rollup)
- [代码分割与分包策略](/notes/performance/bundle-splitting)
- [Tree-shaking、压缩与资源优化](/notes/performance/tree-shaking-compress)
- [前端基础 · Web 性能优化](/interview/frontend-basics/performance-optimization)
