# Webpack 构建提速

Webpack 的构建过程本质是：**为每个模块依次执行 loader 链 → 解析 AST → 收集依赖 → 生成 chunk**。项目一大，这条链路就会变长。提速无非四件事：**少做、缓存、并行、换更快的工具**。

## 第一步：先定位时间花在哪

不看数据直接加配置，通常是白忙。两个最实用的手段：

```bash
# 记录每个模块、每个阶段的耗时，生成 stats.json
npx webpack --profile --json > stats.json
```

```js
// speed-measure-webpack-plugin：打印每个 loader / plugin 的耗时
const SpeedMeasurePlugin = require('speed-measure-webpack-plugin')
const smp = new SpeedMeasurePlugin()

module.exports = smp.wrap({
  mode: 'production',
  // ...
})
```

另外把统计输出降到最低，避免「打印日志」本身拖慢构建：

```js
module.exports = {
  stats: 'errors-warnings'
}
```

拿到耗时分布后，再看是 loader 慢、插件慢，还是模块数量太多。

## 一、少做：缩小处理范围

大部分项目的第一瓶颈不是工具慢，而是**让 loader 处理了不该处理的文件**。

```js
const path = require('path')

module.exports = {
  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        include: path.resolve(__dirname, 'src'),   // 只处理业务源码
        exclude: /node_modules/,
        use: 'swc-loader'
      },
      {
        // oneOf：命中第一条就停，避免同一文件被多条规则重复处理
        oneOf: [
          { test: /\.css$/, use: ['style-loader', 'css-loader'] },
          { test: /\.(png|jpg|svg)$/, type: 'asset/resource' }
        ]
      }
    ]
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js'],           // 只留真正用到的后缀
    alias: { '@': path.resolve(__dirname, 'src') },
    modules: [path.resolve(__dirname, 'src'), 'node_modules']
  }
}
```

- `resolve.extensions` 每多一个后缀，解析失败时就多一次文件探测。
- 大而全的库（如 `moment`）可以用 `IgnorePlugin` 砍掉不需要的部分：

```js
const webpack = require('webpack')

plugins: [
  new webpack.IgnorePlugin({
    resourceRegExp: /^\.\/locale$/,
    contextRegExp: /moment$/
  })
]
```

## 二、缓存：热构建的关键

Webpack 5 内置持久化缓存，这是提升**第二次及以后构建**速度最有效的一招：

```js
module.exports = {
  cache: {
    type: 'filesystem',
    cacheDirectory: path.resolve(__dirname, 'node_modules/.cache/webpack'),
    buildDependencies: {
      // 配置文件变化时自动失效缓存
      config: [__filename]
    }
  }
}
```

配合 loader 级缓存：

```js
{
  test: /\.[jt]sx?$/,
  include: path.resolve(__dirname, 'src'),
  use: [
    {
      loader: 'babel-loader',
      options: { cacheDirectory: true }   // 缓存 babel 转换结果
    }
  ]
}
```

TypeScript 项目常见组合：

```js
{
  loader: 'ts-loader',
  options: {
    transpileOnly: true                  // 只转译，不做类型检查
  }
}
// 类型检查交给独立进程并行执行
new ForkTsCheckerWebpackPlugin()
```

缓存注意事项：

- **缓存失效条件**要写全：配置文件、环境变量、loader 版本变化都可能导致结果不同。
- CI 环境要把 `node_modules/.cache/webpack` 持久化（如 GitHub Actions 的 `actions/cache`），否则冷构建永远享受不到缓存。
- 改完配置后第一次构建是冷的，别拿它和之前的热构建比。

## 三、并行：把单线程的活分出去

Webpack 的模块构建默认在单线程里串行执行。耗时 loader 可以用 `thread-loader` 放进 worker 池：

```js
{
  test: /\.[jt]sx?$/,
  include: path.resolve(__dirname, 'src'),
  use: [
    {
      loader: 'thread-loader',
      options: {
        workers: require('os').cpus().length - 1,
        poolTimeout: 2000
      }
    },
    'babel-loader'
  ]
}
```

同时开启压缩器的并行：

```js
const TerserPlugin = require('terser-webpack-plugin')

optimization: {
  minimizer: [
    new TerserPlugin({
      parallel: true,                    // 默认就是 CPU 核数 - 1
      terserOptions: {
        compress: { drop_console: true, drop_debugger: true }
      }
    })
  ]
}
```

注意：

- `thread-loader` 有进程/线程通信开销，**小项目或轻量 loader 套上反而更慢**。
- 只给真正耗时的 loader（Babel、TS、Sass）加，不要无脑全加。

## 四、换工具：用 Go / Rust 编译器替代 Babel / TS

如果耗时集中在语法转换，换编译器往往比调参数更立竿见影：

```js
// 方案 A：swc-loader（Rust）
{
  test: /\.[jt]sx?$/,
  include: path.resolve(__dirname, 'src'),
  use: {
    loader: 'swc-loader',
    options: {
      jsc: {
        parser: { syntax: 'typescript', tsx: true },
        target: 'es2017'
      }
    }
  }
}
```

```js
// 方案 B：esbuild-loader（Go）
{
  test: /\.[jt]sx?$/,
  include: path.resolve(__dirname, 'src'),
  use: {
    loader: 'esbuild-loader',
    options: { target: 'es2017' }
  }
}
```

取舍：

- 如果你的项目依赖自定义 Babel 插件（如特殊的按需引入、装饰器旧语法），换掉 Babel 可能不兼容。
- SWC / esbuild 对 TypeScript 只做「类型擦除」，不做类型检查，类型检查仍需 `tsc` 或 `ForkTsCheckerWebpackPlugin`。

## 五、开发与生产用两套配置

| 配置项 | 开发环境 | 生产环境 |
| --- | --- | --- |
| `devtool` | `eval-cheap-module-source-map` | `false` 或 `source-map`（按需） |
| 压缩 | 关闭 | 开启（Terser / esbuild） |
| CSS | `style-loader` | `MiniCssExtractPlugin` |
| 缓存 | `filesystem`（也可用 memory） | `filesystem` |
| HMR | 开启 | 不需要 |

开发环境的 sourcemap 建议用 `eval-cheap-module-source-map`，它保留行号、丢弃列号，速度明显快于完整 `source-map`。生产环境如果不需要线上调试，直接关掉 sourcemap 能省掉一大笔构建时间。

另外减少文件监听范围：

```js
module.exports = {
  watchOptions: {
    ignored: /node_modules/
  }
}
```

## 提速效果核对清单

- [ ] 已用 `--profile` 或 `speed-measure-webpack-plugin` 定位过瓶颈
- [ ] loader 的 `include` / `exclude` 已收窄到业务源码
- [ ] `resolve.extensions` 没有多余后缀
- [ ] 已开启 `cache.type = 'filesystem'`
- [ ] Babel / TS 编译已启用 `cacheDirectory` 或 `transpileOnly`
- [ ] 耗时 loader 已按需使用 `thread-loader`
- [ ] 压缩器已开启 `parallel`
- [ ] 开发与生产使用不同 `devtool`、不同压缩策略
- [ ] CI 已持久化构建缓存

## 工具对比小节

| 能力 | Webpack | Vite | Rollup | esbuild |
| --- | --- | --- | --- | --- |
| 持久化缓存 | `cache.type: 'filesystem'` 内置 | 依赖预构建缓存 + 浏览器缓存 | `cache`（watch/编程式） | 无内置持久化缓存 |
| 并行/多线程 | `thread-loader`、`parallel` | esbuild 内部并发 | 单进程为主，`maxParallelFileOps` 控制文件并发 | Go 协程，天然并行 |
| 换更快编译器 | `swc-loader` / `esbuild-loader` | 开发期默认 esbuild | 插件生态（SWC 需自行接入） | 自身即编译器 |
| 缩短解析范围 | `include` / `exclude` / `resolve` | `optimizeDeps` 控制范围 | `external` + 插件收敛 | 入口与 `resolve` 控制 |
| 构建分析 | `--profile` + stats + SMP | `--debug` / `--profile` | `perf: true` | `metafile` |

## 相关页面

- [Webpack 基础配置](/notes/webpack/config-basics)
- [Webpack 底层原理（编译流程）](/notes/webpack/architecture-flow)
- [Webpack loader 与 plugin 开发](/notes/webpack/loader-plugin)
- [Vite 与 Rollup 构建提速](/notes/performance/build-speed-vite-rollup)
- [度量与分析](/notes/performance/measurement)
