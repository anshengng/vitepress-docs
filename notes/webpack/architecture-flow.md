# Webpack 底层原理（编译流程）

Webpack 是一个**基于事件流的同步异步混合管线**：核心只有两个类——`Compiler`（全局单例，管一次进程）和 `Compilation`（一次构建，管一批模块和产物），其余一切能力都通过 tapable 钩子挂在这两个对象上。插件的本质 = 订阅钩子。本页讲生命周期全链路、tapable 钩子家族，并与 Rollup 架构对比（Rollup 侧详解见 [Rollup 执行流程与架构总览](/notes/rollup/architecture-flow)）。

## Compiler 与 Compilation 职责表

| 维度 | Compiler | Compilation |
| --- | --- | --- |
| 数量 | 每次 `webpack(options)` 一个，进程级单例 | 每次构建一个；watch 模式下**每次重编译新建** |
| 持有 | `options`、`context`、`resolvers`、`fileDependencies`、基础设施钩子 | `modules`、`chunks`、`assets`、`errors`、`dependencies`、构建期钩子 |
| 管什么 | 启动、watch、读配置、产出前后 | 模块图构建、chunk 划分、资源生成 |
| 代表钩子 | `initialize`、`beforeRun`、`run`、`thisCompilation`、`make`、`emit`、`afterEmit`、`done`、`watchRun` | `buildModule`、`succeedModule`、`optimizeModules`、`optimizeChunks`、`processAssets`、`afterSeal` |

一句话区分：**Compiler 管"进程和轮次"，Compilation 管"这一轮的模块与产物"**。

## 一次构建的完整生命周期

```
webpack(options) → new Compiler → plugins 逐个 apply(compiler)
    │
    ▼
compiler.run()
  ├─ hooks.initialize → beforeRun → run
  ├─ 创建 Compilation（hooks.thisCompilation → hooks.compilation）
  │
  ├─ hooks.make ──────────────── ┐
  │     ├─ addEntry → 入口依赖    │  模块构建阶段
  │     └─ NormalModuleFactory    │ （递归展开依赖图）
  │           factorize  解析请求 │
  │             ├─ beforeResolve  │
  │             ├─ resolve  别名/扩展名/ex 条件
  │             ├─ afterResolve   │
  │             └─ createModule → NormalModule
  │           compilation.buildModule
  │             ├─ hooks.buildModule
  │             ├─ loader 管线执行（pitching + normal）
  │             ├─ acorn 解析 AST
  │             ├─ JavaScriptParser 收集依赖（import/require/动态）
  │             ├─ 每个依赖再走 factorize → 递归
  │             └─ hooks.succeedModule / moduleAssets
  ├─ hooks.finishMake → afterCompile
  │
  ├─ seal() ──────────────────── ┐
  │     ├─ optimize 模块图       │  封装（打包）阶段
  │     ├─ chunk 划分：入口/动态  │
  │     │   import/splitChunks   │
  │     ├─ optimizeChunks        │
  │     ├─ 生成模块代码 + runtime │
  │     │   （__webpack_require__）
  │     ├─ hooks.processAssets   │  ← 插件改产物的主战场
  │     ├─ 计算 hash / contenthash
  │     └─ hooks.afterSeal       │
  │
  ├─ hooks.shouldEmit → emit → 写盘 → afterEmit
  └─ hooks.done
```

几个关键节点：

- **make**：从入口出发把整张模块图建起来，`factorize`（把请求字符串变成文件路径）和 `buildModule`（loader + parse + 收集依赖）在这里反复递归
- **seal**：图建好后才开始"打包"——分 chunk、生成 runtime、渲染模板、算 hash。seal 之前 `compilation.assets` 还不存在
- **processAssets**：带 `stage` 序号的水流钩子，插件按阶段插入（如 `PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE` 在压缩前后各阶段之间），这是 Terser/Compression 类插件的挂载点

## tapable：钩子家族速览

Webpack 全部生命周期事件由 [tapable](https://github.com/webpack/tapable) 提供。选钩子 = 选语义：

| 钩子类 | 调度语义 | Webpack 中的例子 |
| --- | --- | --- |
| `SyncHook` | 同步依次调用，忽略返回值 | `done`、`afterSeal` |
| `SyncBailHook` | 同步，第一个非 undefined 短路 | `shouldEmit`、`resolve` |
| `SyncWaterfallHook` | 同步，返回值接力给下一个第一个参数 | `processAssets`（同步版）、`webpackOptions` |
| `AsyncSeriesHook` | 异步串行，等全部完成 | `make`、`seal`、`emit` |
| `AsyncParallelHook` | 异步并发 | `beforeCompile` |
| `AsyncSeriesWaterfallHook` | 异步串行 + 接力 | `beforeResolve`、`afterResolve` |

插件就是一个带 `apply` 方法的对象/类——**apply 时订阅钩子，构建时被动执行**：

```js
class ExamplePlugin {
  apply(compiler) {
    // 订阅 Compiler 钩子
    compiler.hooks.done.tap('ExamplePlugin', (stats) => {
      console.log('构建完成', stats.hash)
    })
    // Compilation 每轮新建，要先从 thisCompilation 拿到实例
    compiler.hooks.thisCompilation.tap('ExamplePlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'ExamplePlugin',
          // 阶段决定在同钩子插件间的相对顺序
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
        },
        (assets) => {
          // 这里增删改产物
        }
      )
    })
  }
}
```

`tap` 的第二个参数（对象形式）里的 `stage` 是 Compilation 级钩子的排序依据；同阶段内按注册顺序。loader/plugin 的具体开发写法见 [Webpack loader 与 plugin 开发](/notes/webpack/loader-plugin)。

## 与 Rollup 架构对比

| 维度 | Webpack | Rollup |
| --- | --- | --- |
| 核心对象 | `Compiler` + `Compilation` 两层 | `Graph` + `Bundle`/`Chunk` |
| 入口模型 | 多入口天然支持 | 一次构建一张图，多入口靠 chunk 分割 |
| tree-shaking | 依赖 `harmony` 标记 + `sideEffects`，粒度较粗 | 自定义 AST 类逐节点 `hasEffects`/`include`，更精确 |
| 产物运行时 | 有：`__webpack_require__` + 模块注册表 | 无：模块扁平拼接，产物接近手写 ESM |
| 模块处理管线 | resolve → **loader 链** → parse → 递归依赖 | `resolveId` → `load` → `transform` 钩子链 |
| 扩展模型 | tapable 钩子订阅（类 + apply） | 插件对象钩子 + first/parallel/seq 调度 |
| 代码分割 | `splitChunks` 配置驱动 | 动态 import + `manualChunks` |
| 非 JS 资源 | loader 体系（一切皆模块） | 插件 transform（核心能力更偏 JS） |
| 设计目标 | 应用打包：任意资源、增量重编译 | 库打包：干净产物、ESM 语义保真 |

架构流程逐段对照可看 [Rollup 执行流程与架构总览](/notes/rollup/architecture-flow)：Webpack 的 `make` 大致对应 Rollup 的 `generateModuleGraph`，`seal` 对应 `Bundle.generate`，但 Webpack 把"解析请求"交给 resolve 系统 + loader，Rollup 交给插件钩子。

## 速查表

| 问题 | 答案 |
| --- | --- |
| 模块图什么时候建好 | `make` 钩子阶段（factorize + buildModule 递归） |
| 产物什么时候出现 | `seal` 内的代码生成之后 |
| 插件改产物挂哪 | `compilation.hooks.processAssets`（带 stage） |
| watch 重编译发生什么 | 新建 Compilation，只重建失效模块，复用其余 |
| 插件的本质 | `apply(compiler)` 订阅 tapable 钩子 |
| 和 Rollup 最大差异 | Webpack 产物带运行时、tree-shaking 较粗；Rollup 产物扁平 |

## 相关页面

- [Rollup 执行流程与架构总览](/notes/rollup/architecture-flow)
- [Rollup Tree-shaking 原理](/notes/rollup/tree-shaking)
- [Webpack 基础配置](/notes/webpack/config-basics)
- [Webpack loader 与 plugin 开发](/notes/webpack/loader-plugin)
