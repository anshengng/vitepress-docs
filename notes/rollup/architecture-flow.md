# Rollup 执行流程与架构总览

Rollup 源码目录（v4）：`src/rollup/rollup.ts` 主入口、`src/Graph.ts` 模块图、`src/ModuleLoader.ts` 加载器、`src/Module.ts` 模块、`src/Bundle.ts` 输出束、`src/Chunk.ts` 输出块、`src/ast/` AST 与作用域、`src/finalisers/` 各格式包装。

## 两阶段架构

Rollup 把一次完整构建拆成两个阶段，边界在 `rollup()` 返回的 `RollupBuild` 对象上：

```
┌──────────── 构建阶段（只做一次）────────────┐
│ rollup(options)                              │
│   选项标准化 → 模块加载/解析 → 依赖图 → 排序  │
│   → Tree-shaking 标记                        │
└──────────────────┬───────────────────────────┘
                   ↓ 返回 RollupBuild（含模块图快照）
┌──────────── 生成阶段（可多次）───────────────┐
│ build.generate(outputOptions)                │
│   分块 → 渲染 → 变量去冲突 → 格式包装 → 哈希  │
│ build.write(outputOptions) = generate + 写盘 │
└──────────────────────────────────────────────┘
```

这样设计的原因：**依赖图只构建一次，就能以不同 output 配置生成多份产物**（如 es + cjs + umd），这正是库打包的典型需求。

## 入口：rollupInternal

`src/rollup/rollup.ts`（简化源码）：

```ts
export async function rollupInternal(rawInputOptions, watcher) {
  // 1. 解析并规范化输入选项（默认值、插件数组化等）
  const { options: inputOptions, errors } = getInputOptions(rawInputOptions, watcher)
  if (errors) throw new Error(...)

  // 2. 创建 Graph —— 整个构建的"大脑"，持有模块图与 PluginDriver
  const graph = new Graph(inputOptions, watcher)

  // 3. 执行构建阶段
  await graph.build()

  // 4. 返回 RollupBuild：把 graph 包起来，暴露 generate/write/close
  return new Build(graph, inputOptions.cache, watcher)
}
```

`Graph` 内部的关键成员：

| 成员 | 作用 |
| --- | --- |
| `modulesById` | 模块 ID → `Module` 实例的映射 |
| `entryModules` | 入口模块列表 |
| `pluginDriver` | 插件驱动器，所有钩子经它调用 |
| `moduleLoader` | `ModuleLoader` 实例 |

## 构建阶段：Graph.build()

`src/Graph.ts`（简化源码），三步走：

```ts
async build() {
  try {
    // ① 生成模块图：递归加载所有依赖
    await this.generateModuleGraph()

    // ② 排序与绑定：确定执行顺序、检测循环依赖、绑定跨模块变量引用
    await this.sortAndBindModules()

    // ③ Tree-shaking：从入口出发标记需要保留的语句
    await this.includeStatements()
  } catch (e) {
    await this.pluginDriver.hookSeqSync('buildEnd', [e])
    throw e
  }
  await this.pluginDriver.hookSeqSync('buildEnd', [])
}
```

### ① generateModuleGraph → ModuleLoader

模块加载是递归的，单个模块的处理管线（`src/ModuleLoader.ts` 简化）：

```ts
async fetchModule(id, importer, ...) {
  // 1. resolveId 钩子：插件可改写模块 ID（如虚拟模块）
  const resolution = await this.pluginDriver.hookFirst('resolveId', [id, importer])

  // 2. 外部依赖？直接建 ExternalModule，不加载源码
  if (isExternal(resolution)) return new ExternalModule(...)

  // 3. load 钩子：插件可提供源码，否则读磁盘
  let source = await this.pluginDriver.hookFirst('load', [resolvedId])
  if (source == null) source = await readFile(resolvedId)

  // 4. transform 钩子链：逐个插件串行转换源码（TS→JS 就在这）
  for (const { plugin, handler } of transformHandlers) {
    source = await handler.call(context, source, ...)
  }

  // 5. 创建 Module 实例并解析 AST
  const module = new Module(graph, source, resolvedId, ...)
  module.setSource(source)   // acorn 解析 → Rollup 内部 AST

  // 6. 收集依赖：静态 import 与动态 import()，递归 fetchModule
  for (const dep of module.dependencies) {
    await this.fetchModule(dep, resolvedId)   // 递归
  }
  return module
}
```

入口由 `addEntryModules()` 触发，整个依赖图像爬虫一样铺开。

### ② sortAndBindModules

- **执行顺序排序**：ESM 是"先执行被依赖模块"，Rollup 对模块图做拓扑类排序得到执行序列；循环依赖在此被检测（Rollup 能容忍但会调整顺序保证语义）
- **bindReferences**：把每个 AST 节点里引用的标识符绑定到作用域系统中的 `Variable` 对象上，跨模块的 import 绑定到导出方的声明——这是后续 tree-shaking 能精确判断"谁用了谁"的前提

### ③ includeStatements（Tree-shaking 标记）

```ts
async includeStatements() {
  for (const module of [...this.entryModules, ...this.implicitEntryModules]) {
    if (this.options.treeshake === false) {
      module.includeAllInBundle()      // 关闭 tree-shaking：全量保留
    } else {
      module.include()                 // 入口默认保留所有顶层执行
    }
  }
  // 反复传递：新被 include 的代码可能引用了未标记的语句，直到收敛
  do {
    marked = runTask(taskQueue)
  } while (marked)
}
```

每个 `Module` / AST 节点身上只有一个布尔 `included` 标记，**没被标记的语句在渲染阶段直接不输出**。原理详见 [Tree-shaking 原理](/notes/rollup/tree-shaking)。

## 生成阶段：Bundle.generate

`src/Bundle.ts`（简化源码）：

```ts
async generate(outputOptions, write) {
  // 1. 钩子：renderStart
  await this.pluginDriver.hookParallel('renderStart', [])

  // 2. 分块：把模块分配到 Chunk（入口 chunk + 动态 import 产生的 chunk）
  const chunks = this.getChunkAssignments(entryModules)

  // 3. 渲染每个 chunk
  const rendered = await this.renderChunks(chunks)

  // 4. 逐个 chunk：格式包装 + renderChunk 钩子
  for (const chunk of chunks) {
    let code = chunk.code
    code = finalisers[format](chunk, ...)        // ESM/CJS/UMD/IIFE 包装
    code = await pluginDriver.hookFirst('renderChunk', [code, chunk, ...])
  }

  // 5. 计算内容哈希，替换 [hash] 占位符
  // 6. 钩子：generateBundle（可增删产物）→ 写盘 → writeBundle
}
```

chunk 渲染内部（`src/Chunk.ts`）依次做：

1. `render()`：只输出 `included` 的模块代码，重写 import/export
2. `deconflictChunk()`：多模块合并后变量可能重名，按作用域重新命名
3. 计算 chunk 的导出表、依赖表

## 完整流程图

```
rollup(options)
    ↓
rollupInternal()
    ↓
getInputOptions → normalizeInputOptions        # 选项标准化
    ↓
new Graph()                                     # 模块图 + PluginDriver
    ↓
graph.build()                                   # ── 构建阶段 ──
    ├─ generateModuleGraph()
    │   └─ addEntryModules → fetchModule(递归)
    │       resolveId → load → transform → parse AST → 收集依赖
    ├─ sortAndBindModules()
    │   └─ 执行顺序排序 / 循环依赖检测 / bindReferences
    └─ includeStatements()
        └─ 从入口标记 included，多轮传递直到收敛
    ↓
RollupBuild { generate, write, close }
    ↓
build.generate(outputOptions)                   # ── 生成阶段 ──
    ├─ renderStart 钩子
    ├─ 模块分配到 Chunk（入口 + 动态 import 分割点）
    ├─ chunk.render()：只渲染 included 代码，重写 import/export
    ├─ deconflictChunk()：变量去冲突
    ├─ finaliser：按 format 包装（esm/cjs/umd/iife）
    ├─ renderChunk 钩子
    ├─ 内容哈希替换 [hash]
    └─ generateBundle / writeBundle 钩子 → 写盘
```

## 最小示例走查

`main.js`：

```js
import { foo } from './foo.js'
console.log(foo)
```

`foo.js`：

```js
export const foo = 1
export const bar = 2   // 没人用
function unused() {}   // 没人用、无副作用
```

| 阶段 | 发生了什么 |
| --- | --- |
| fetchModule | 解析 main.js → 发现 `./foo.js` → 递归加载，两张 AST |
| sortAndBind | 执行顺序 `[foo, main]`；main 里的 `foo` 绑定到 foo.js 的声明 |
| includeStatements | `console.log` 有副作用 → 保留 → 用到 `foo` 变量 → 标记；`bar`/`unused` 无人引用 → 不标记 |
| render | 只输出 `const foo = 1` 与 `console.log(foo)`，import/export 被重写掉 |

产物（esm）：

```js
const foo = 1;

console.log(foo);
```

## 核心类速查

| 类 | 文件 | 职责 |
| --- | --- | --- |
| `Graph` | `src/Graph.ts` | 持有模块图，驱动构建三步骤 |
| `ModuleLoader` | `src/ModuleLoader.ts` | resolveId/load/transform 管线，递归建图 |
| `Module` | `src/Module.ts` | 单模块：AST、作用域、依赖、included 标记 |
| `ExternalModule` | `src/ExternalModule.ts` | 外部依赖，无源码只处理导入导出 |
| `Bundle` | `src/Bundle.ts` | 一次 generate 的总调度 |
| `Chunk` | `src/Chunk.ts` | 一个输出文件：渲染、去冲突、导出表 |
| `PluginDriver` | `src/utils/PluginDriver.ts` | 钩子调度（见[插件生命周期](/notes/rollup/plugin-hooks)） |
