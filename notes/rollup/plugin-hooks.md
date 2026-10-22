# Rollup 插件生命周期与钩子系统

Rollup 插件就是一个带 `name` 和钩子方法的对象，构建流程中几乎所有环节都暴露为钩子。理解「钩子类型 + 调用时机」就理解了 Rollup 的扩展模型。

## 插件形态

```js
const myPlugin = {
  name: 'my-plugin',
  // 钩子可以是同步/异步函数，也可以是 { handler, order } 对象
  resolveId(source) {
    if (source === 'virtual:answer') return '\0virtual:answer'
  },
  load(id) {
    if (id === '\0virtual:answer') return 'export default 42'
  }
}
```

> 约定：虚拟模块 ID 以 `\0` 开头，让其他插件/文件系统不会误处理它。

## 钩子的四种调度类型

`PluginDriver`（`src/utils/PluginDriver.ts`）按类型调度，这是理解执行顺序的关键：

| 类型 | 调度方式 | 返回值语义 | 代表钩子 |
| --- | --- | --- | --- |
| **first** | 按插件顺序逐个执行，**第一个非 null 结果短路** | 结果作为最终值 | `resolveId`、`load`、`renderChunk`、`banner` |
| **parallel** | 所有插件**并发**执行，忽略返回值 | 只用于副作用 | `buildStart`、`renderStart`、`generateBundle`* |
| **sequential** | 按顺序串行，忽略返回值 | 只用于副作用 | `moduleParsed`、`closeBundle` |
| **reduceArg0** | 串行，**前一个返回值改写第一个参数** | 链式接力 | `transform`、`options`、`outputOptions` |

（* `generateBundle` 实际是 parallel + 返回值可修改 bundle，此处记调度并发即可）

简化版调度源码：

```ts
// hookFirst：第一个非 null 者胜
async hookFirst(hookName, args, ...) {
  for (const { plugin, handler } of this.hooks[hookName]) {
    const result = await handler.call(this.getPluginContext(plugin), ...args)
    if (result != null) return result      // 短路
  }
  return null
}

// hookParallel：并发执行全部
async hookParallel(hookName, args) {
  await Promise.all(
    this.hooks[hookName].map(({ plugin, handler }) =>
      handler.call(this.getPluginContext(plugin), ...args))
  )
}

// hookReduceArg0：transform 用，code 逐棒传递
async hookReduceArg0(hookName, [arg0, ...args], reduce, ...) {
  let result = arg0
  for (const { plugin, handler } of this.hooks[hookName]) {
    const out = await handler.call(ctx, result, ...args)
    if (out != null) result = reduce(result, out, plugin)   // 合并/替换
  }
  return result
}
```

`this.hooks[hookName]` 在构造时按**插件数组顺序**收集好——所以插件数组的顺序就是同名钩子的执行顺序（Rollup 没有 Vite 的 `enforce`，靠数组顺序控制）。

## 完整生命周期时间线

```
── 构建阶段 ──────────────────────────────────────────────
options            [reduceArg0]  修改输入选项（入口、插件自身配置）
onLog / onwarn     [first]       拦截/过滤日志
buildStart         [parallel]    构建开始，初始化状态
  ↓
  对每个模块（递归）：
    resolveId        [first]       把 import 说明符解析为绝对 ID
    load             [first]       提供模块源码
    transform        [reduceArg0]  转换源码（TS→JS、编译 SFC 等）
    moduleParsed     [sequential]  模块 AST 解析完成，可查依赖信息
  ↓
buildEnd           [sequential]  构建结束（带错误对象）

── 生成阶段（每次 generate/write 都会走一遍）──────────────
outputOptions      [reduceArg0]  修改输出选项
renderStart        [parallel]    渲染开始
resolveDynamicImport [first]     动态 import() 的解析
renderChunk        [first]       每个 chunk 代码生成后（babel/压缩常挂这）
augmentChunkHash   [first]       追加影响 [hash] 的内容
banner/footer/intro/outro [first] 给 chunk 加头尾
renderError        [sequential]  渲染出错
generateBundle     [parallel]    产物字典最终形态，可增删改文件
writeBundle        [sequential]  已写盘后（仅 write）
closeBundle        [sequential]  全部结束
```

## 常用钩子职责速查

| 钩子 | 时机 | 典型用途 |
| --- | --- | --- |
| `options` | 最前 | 注入入口、polyfill 配置 |
| `buildStart` | 构建开始 | 清理上次产物、起计时 |
| `resolveId` | import 解析 | 路径别名、虚拟模块、bare 包解析（node-resolve） |
| `load` | 源码读取 | 虚拟模块给内容、非文件源（如从数据库） |
| `transform` | 每模块源码 | **最常用**：编译 TS/JSX/Vue、注入代码 |
| `moduleParsed` | AST 就绪 | 分析依赖图 |
| `renderChunk` | chunk 渲染后 | 压缩（terser）、后处理产物代码 |
| `generateBundle` | 产物就绪 | 注入额外文件、改写产物、上传 sourcemap |
| `writeBundle` | 写盘后 | 通知类副作用 |
| `closeBundle` | 结束 | 释放资源 |

## 插件上下文（this.*）

钩子函数内的 `this` 提供一组工具（`src/utils/pluginUtils.ts` 组装）：

| API | 说明 |
| --- | --- |
| `this.emitFile({ type: 'asset', fileName?, source })` | 发射静态资源，返回 referenceId |
| `this.emitFile({ type: 'chunk', ... })` | 发射新 chunk |
| `this.getFileName(refId)` | 取 emitFile 后的最终文件名 |
| `this.resolve(source, importer)` | 在插件里调用完整 resolveId 链 |
| `this.load(id)` | 强制加载某模块 |
| `this.parse(code)` | 把代码解析成 AST |
| `this.warn / this.error` | 带定位信息的警告/错误 |
| `this.getModuleInfo(id)` | 查询模块元信息（code、dependencies） |
| `this.addWatchFile(id)` | watch 模式下追加监听文件 |

## 实战：手写一个虚拟模块插件

把三种钩子串起来的最小完整例子：

```js
function answerPlugin() {
  const VIRTUAL = 'virtual:answer'
  const RESOLVED = '\0' + VIRTUAL

  return {
    name: 'answer',
    // resolveId：把 'virtual:answer' 解析成带 \0 前缀的私有 ID
    resolveId(source) {
      if (source === VIRTUAL) return RESOLVED
    },
    // load：看到这个 ID 时凭空给出源码（磁盘上并没有这个文件）
    load(id) {
      if (id === RESOLVED) return 'export default 42'
    }
  }
}

// 业务代码里即可：
// import answer from 'virtual:answer'  →  42
```

再加一个 transform 例子——给所有模块头部注入 banner（reduceArg0 接力语义）：

```js
function bannerPlugin(banner) {
  return {
    name: 'banner',
    transform(code, id) {
      if (id.includes('node_modules')) return null   // 返回 null 表示不处理
      return `/* ${banner} */\n${code}`              // 返回新代码，传给下一棒
    }
  }
}
```

## 与 Vite 插件的关系

Vite 复用 Rollup 钩子模型，额外在 `transform`/`load` 等钩子对象上支持 `enforce: 'pre' | 'post'` 与 `apply: 'serve' | 'build'` 来调整执行位置与生效阶段；钩子类型语义（first/parallel/seq）与 Rollup 完全一致。Vite 用法见[插件与常用插件](/notes/vite/plugins)。
