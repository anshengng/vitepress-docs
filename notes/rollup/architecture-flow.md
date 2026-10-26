# Rollup 执行流程与架构总览

一句话：Rollup 的构建阶段是一台**插件驱动的模块图爬虫**——每个模块都必须走完固定管线 `resolveId → load → transform → parse → 解析依赖 → moduleParsed`，然后对每个依赖重复同一套流程；生成阶段再基于这张模块图做分块与渲染。

源码目录（v4）：`src/rollup/rollup.ts` 主入口、`src/Graph.ts` 模块图、`src/ModuleLoader.ts` 加载管线、`src/Module.ts` 单模块、`src/Bundle.ts` 输出调度、`src/Chunk.ts` 输出块、`src/ast/` AST 与作用域、`src/parseAst/` 原生解析器、`src/finalisers/` 各格式包装。

## 两阶段架构

Rollup 把一次完整构建拆成两个阶段，边界在 `rollup()` 返回的 `RollupBuild` 对象上：

```
┌──────────── 构建阶段（只执行一次）────────────┐
│ rollup(options)                               │
│   options → buildStart                        │
│   模块管线 × N（递归建图）                     │
│   → 排序 / 绑定引用 → Tree-shaking 标记         │
│   buildEnd                                    │
└──────────────────┬────────────────────────────┘
                   ↓ 返回 RollupBuild（持有模块图）
┌──────────── 生成阶段（可执行多次）─────────────┐
│ build.generate(outputOptions)                │
│   outputOptions → renderStart                 │
│   分块 → 渲染 → 格式包装 → 哈希               │
│   generateBundle → (writeBundle) → closeBundle│
│ build.write() = generate + 写盘               │
└───────────────────────────────────────────────┘
```

这样设计的原因：**模块图只构建一次，就能用不同 output 配置生成多份产物**（如 es + cjs + umd），这正是库打包的典型需求。

## 构建阶段的中心：单模块管线

把「一个 import」当成原料，Rollup 对它的处理顺序是固定的。这张图是本页最重要的内容：

```
一个 import 说明符
      │
      ▼
① resolveId [first] ── 说明符 → 模块 ID
      │  false / { external: true } → ExternalModule（到此为止，不读源码）
      ▼
② modulesById 命中？ ── 是 → 直接复用已有 Module（整条管线跳过）
      │ 否
      ▼
③ load [first] ── ID → 原始源码（插件都没给才读磁盘）
      ▼
④ transform [reduceArg0] ── 源码逐棒转换（TS/JSX/Vue/注入…）
      ▼
⑤ parse（内部步骤，无钩子）── 源码 → AST，抽取 import/export
      ▼
⑥ 解析本模块的所有 import ── resolveId / resolveDynamicImport 并发执行
      ▼
⑦ moduleParsed [parallel] ── 只读通知：本模块信息已齐
      ▼
⑧ 并发 fetch 每个依赖模块 ── 回到 ①（每个依赖独立走整套管线）
      ▼
⑨ linkImports ── 把 import 绑定到导出方的声明
```

先记住四个问题、四个环节，后面就不会混：

| 问题 | 环节 | 输入 | 输出 |
| --- | --- | --- | --- |
| 这条 import 指向谁？ | `resolveId` | 说明符 + importer | 唯一 ID / external |
| 这个 ID 的内容是什么？ | `load` | ID | 原始源码（可带 AST） |
| 内容要改成什么？ | `transform` | 源码 + ID | 新源码 |
| 解析完能观察到什么？ | `moduleParsed` | 只读 `ModuleInfo` | 无 |

注意 ⑤ 与 ⑦ 的区别：**`parse` 是内部步骤，`moduleParsed` 是暴露给插件的通知**。Rollup 并没有 `moduleParse` 这个钩子。

## resolveId：把「说明符」变成「ID」

```ts
type ResolveIdHook = (
  source: string,                 // import 里写的原样字符串，如 './foo.js'、'lodash-es'
  importer: string | undefined,   // 谁在 import 它；入口模块为 undefined
  options: {
    attributes: Record<string, string>
    custom?: CustomPluginOptions
    isEntry: boolean              // 是否是入口
  }
) => string | false | null | ResolvedId

interface ResolvedId {
  id: string
  external?: boolean | 'absolute'
  moduleSideEffects?: boolean | 'no-treeshake'
  syntheticNamedExports?: boolean | string
  meta?: Record<string, any>
}
```

**四种返回值的语义：**

| 返回 | 含义 |
| --- | --- |
| `string` | 解析出的模块 ID，后续 `load` 收到它 |
| `{ id, external: true }` | 标记为外部依赖，不读源码，只保留 import 语句 |
| `false` | 等价于标记外部依赖（旧写法） |
| `null` / `undefined` | 我不处理，交给下一个插件 |

**调度方式是 `first`：按插件数组顺序执行，第一个返回非 `null` 的插件获胜**，后面的插件不再执行。原因是模块 ID 代表模块的**身份**，必须唯一——如果多个插件各返回一个 ID，Rollup 无法判断听谁的。

**没有插件接管时，Rollup 内置的兜底规则**（`src/utils/resolveId.ts`）：

1. `importer` 存在，且 `source` 既不是绝对路径、也不以 `.` 开头 → 直接返回 `null`。也就是说**裸模块（bare import）Rollup 自己不解析**，必须由 `@rollup/plugin-node-resolve` 这类插件处理，否则报 "Could not resolve"。
2. 相对路径 → 以 `importer` 所在目录为基准 `resolve`，依次探测 `文件名`、`文件名.mjs`、`文件名.js`。
3. 入口（`importer === undefined`）→ 以当前工作目录为基准解析。
4. 顺带处理符号链接（`preserveSymlinks`）与文件名大小写校验。

**典型用途**：路径别名、虚拟模块、bare 包解析、把某个包强制标记为 external。

## load：把「ID」变成「源码」

```ts
type LoadHook = (
  id: string,                     // resolveId 产出的 ID
  options: { attributes: Record<string, string> }
) => string | null | SourceDescription

interface SourceDescription {
  code: string
  map?: string | SourceMap
  ast?: ESTree.Program           // 已有 AST 可直接给，省一次 parse
  moduleSideEffects?: boolean | 'no-treeshake'
  syntheticNamedExports?: boolean | string
  meta?: Record<string, any>
}
```

调度同样是 `first`：插件都没返回内容时，Rollup 才 `fs.readFile(id)` 读磁盘。

- `load` 只对「这个 ID 的内容」负责，**不要在这里解析依赖**——依赖解析是 parse 之后的事。
- 返回 `ast` 可以让 Rollup 跳过自己的解析步骤，适合本身就有现成 AST 的编译器。
- 虚拟模块必须 `resolveId` + `load` 成对出现：`resolveId` 把 `virtual:answer` 解析成 `\0virtual:answer`，`load` 看到这个 ID 时凭空返回源码。`\0` 前缀是约定，用来避免被其他插件或文件系统误处理。

## transform：把源码变成新源码

```ts
type TransformHook = (
  code: string,                   // 上一棒产出的代码（第一个插件拿到的是 load 的结果）
  id: string
) => string | null | { code: string; map?: string | SourceMap; ast?: ESTree.Program }
```

调度方式是 `reduceArg0`：**串行接力，前一个插件的返回值作为下一个插件的 `code` 入参**。

```ts
// src/utils/transform.ts（简化）
const code = await pluginDriver.hookReduceArg0(
  'transform',
  [source.code, module.id, { attributes }],
  (previousCode, result) =>
    typeof result === 'string' ? result : (result?.code ?? previousCode)
)
```

为什么这里不用 `first`：转换是**可叠加**的，TS → JS、JSX → JS、注入 banner、压缩，每一步都要基于上一步的结果继续改，所以必须接力。

几个容易踩的点：

- **返回 `null` 表示「我不改」，不是清空**，代码会原样传给下一棒。
- 每个模块都会经过 `transform`，包括 `load` 提供的虚拟模块。
- `load` 与 `transform` 的分工：`load` 提供**原始源码**（磁盘上是什么就是什么），`transform` 负责**改写**。同样地，`load` 是 first（内容来源唯一），`transform` 是 reduce（改写可叠加）。
- 多个插件改写后会产生 sourcemap 链，插件里可用 `this.getCombinedSourcemap()` 拿到合并后的映射。

## parse：管线里唯一没有钩子的环节

`transform` 结束后，`Module.setSource()` 会用内置解析器把代码解析成 AST：

- v4 起使用 Rust 原生解析器（基于 SWC），不再是旧版的 acorn。
- 产出 ESTree 风格的 AST，并抽取：静态 `import` / `export`、`export * from`、动态 `import()`、`import.meta`。
- **插件无法插手 parse**。想影响 AST，只能在 `transform` 里返回合法的 `code`，或者直接返回一个 `ast`（必须与 `code` 一致）。
- parse 的输出决定了模块图长什么样——依赖列表就是从这里来的。

## 依赖解析：resolveId 的第二次出场

parse 拿到依赖列表后，Rollup 会为**本模块的每一条依赖**发起解析，且是**并发**的（`Promise.all`）：

| 依赖形式 | 走哪个钩子 |
| --- | --- |
| 静态 `import ... from './foo'` | `resolveId(source, importer)` |
| `export ... from './foo'` | 同上 |
| 动态 `import('./foo')`（字符串字面量） | 先 `resolveDynamicImport`，返回 `null` 才回退到 `resolveId` |
| 动态 `import(expr)`（表达式） | **只**调 `resolveDynamicImport`，参数是 AST 节点；插件必须显式返回，否则 Rollup 保留原样并给出警告 |

注意这里的层次：`resolveId` 解析的是「依赖指向哪个 ID」，而依赖模块的 `load` / `transform` 要等这一步完成后才会开始。

## moduleParsed：只读通知，不是解析钩子

```ts
type ModuleParsedHook = (moduleInfo: ModuleInfo) => void
```

**触发时机**：`transform` 完成 → parse 完成 → **本模块所有 import 的说明符都解析完成**之后触发；此时依赖模块自身的 `load` / `transform` 可能还没跑完。

这带来两个实用结论：

- `moduleInfo.importedIds`、`dynamicallyImportedIds`、`importedIdResolutions` 已经**完整准确**，可以放心做依赖分析。
- 但「谁 import 了我」的信息可能还不全，因为后面还可能发现新的 importer。需要完整信息请用 `buildEnd`。

其他特性：

- **只读**，不能改代码、不能改依赖；要改代码请回到 `transform`。
- 该钩子**永不使用缓存**，缓存命中的模块也会触发，可用于获取缓存模块的最终 `meta`、`code`、`ast`。
- 常见用途：统计模块数量、收集依赖关系、在 `this.getModuleInfo` 里读取模块元信息。

## 单模块管线的简化源码

`ModuleLoader` 的核心就是「一模块一管线 + 依赖递归」，下面是去掉错误处理后的主干：

```ts
// src/ModuleLoader.ts（简化）
async fetchModule(resolvedId, importer, isEntry) {
  // ② 按解析后的 ID 去重：同一个模块只会被处理一次
  const existing = this.modulesById.get(resolvedId.id)
  if (existing) return existing

  const module = new Module(this.graph, resolvedId, isEntry)
  this.modulesById.set(resolvedId.id, module)   // 先登记，循环依赖靠它拿到同一个实例

  // ③ load → ④ transform → ⑤ parse，全部在 addModuleSource 内完成
  await this.addModuleSource(resolvedId.id, importer, module)

  // ⑥ 为本模块的所有依赖并发发起解析
  const staticPromises = this.getResolveStaticDependencyPromises(module)
  const dynamicPromises = this.getResolveDynamicImportPromises(module)

  // ⑦ 等全部 import 解析完成后再通知插件
  const moduleParsedPromise = waitForDependencyResolution([...staticPromises, ...dynamicPromises])
    .then(() => this.pluginDriver.hookParallel('moduleParsed', [module.info]))

  // ⑧ 并发抓取依赖模块；⑨ 最后 linkImports
  await this.fetchModuleDependencies(module, staticPromises, dynamicPromises, moduleParsedPromise)

  return module
}
```

`addModuleSource` 把 `load` 和 `transform` 串起来，并处理缓存：

```ts
// src/ModuleLoader.ts（简化）
private async addModuleSource(id, importer, module) {
  // ③ load：插件优先，都没处理才读磁盘
  let source = await this.pluginDriver.hookFirst('load', [id, { attributes: module.info.attributes }])
  if (source === null) source = await this.options.fs.readFile(id, 'utf8')

  const sourceDescription = typeof source === 'string' ? { code: source } : source
  sourceDescription.code = stripBom(sourceDescription.code)

  // 缓存模式：源码没变且插件不要求重跑，就直接复用旧 AST，跳过 transform
  const cachedModule = this.graph.cachedModules.get(id)
  if (cachedModule && cachedModule.originalCode === sourceDescription.code) {
    if (!(await this.pluginDriver.hookFirst('shouldTransformCachedModule', [{ /* ... */ }]))) {
      await module.setSource(cachedModule)
      return
    }
  }

  // ④ transform（内部就是 hookReduceArg0）→ ⑤ setSource 里 parse
  module.updateOptions(sourceDescription)
  await module.setSource(await transform(sourceDescription, module, this.pluginDriver, this.options))
}
```

## 模块之间：递归建图、缓存与循环依赖

### 缓存结构

| 结构 | 作用 |
| --- | --- |
| `modulesById` | 解析后的 ID → `Module` / `ExternalModule`，模块去重的唯一依据 |
| `moduleLoadPromises` | 记录加载中的 Promise，避免并发重复加载 |
| `watchFiles` | 需要监听的文件集合 |
| `cachedModules` | 上一次构建的模块快照，watch 增量构建时复用 |

因为去重发生在 `resolveId` **之后**，所以 `./foo` 和 `./foo.js` 只要解析到同一个绝对 ID，就共享同一个 `Module` 实例——这也是「解析必须唯一」的原因。

### 两个模块的调用时序

`main.js` 里写了 `import { foo } from './foo.js'`：

```
buildStart
├─ resolveId('./main.js', undefined, { isEntry: true })   → /abs/main.js
├─ load(/abs/main.js)
├─ transform(code, /abs/main.js)
├─ parse(main.js)                  ← 发现依赖 './foo.js'
├─ resolveId('./foo.js', /abs/main.js)                    → /abs/foo.js
├─ moduleParsed(main.js)           ← main.js 的 import 已全部解析完
├─ load(/abs/foo.js)               ← 此刻才开始加载依赖
├─ transform(code, /abs/foo.js)
├─ parse(foo.js)                   ← 无依赖
├─ moduleParsed(foo.js)
├─ linkImports(main.js)            ← foo 绑定到 foo.js 的导出声明
└─ buildEnd
```

补充两点：

- **同一层的多个依赖是并发进入管线的**。上图只是单链路上能观察到的顺序，不要把父子钩子的严格先后当作 API 契约。
- **`moduleParsed` 早于依赖的 `load`**，但晚于依赖的 `resolveId`。这是在插件里做依赖分析时最容易判断错的地方。

### 循环依赖为什么不会死锁

`fetchModule` 在开始加载源码之前，就已经 `modulesById.set(id, module)`。所以 `A → B → A` 时，B 拿到的正是这个「已登记、源码还没完成」的 A 实例，直接复用而不是重新加载。真正的顺序问题留给后续的排序与 `linkImports` 处理——Rollup 允许循环依赖，但会调整执行顺序来保证 ESM 语义。

## 为什么钩子要这样分工

把「身份、内容、改写、通知」四件事拆开，是整条管线设计的核心：

| 常见混淆 | 结论 |
| --- | --- |
| `resolveId` vs `load` | 前者决定「指向谁」，后者决定「内容是什么」 |
| `load` vs `transform` | 前者给原始源码（first，来源唯一），后者改源码（reduce，可叠加） |
| `moduleParsed` vs parse | **没有 `moduleParse` 钩子**；parse 是内部步骤，`moduleParsed` 只是只读通知 |
| `resolveId` vs `resolveDynamicImport` | 静态依赖走 `resolveId`；动态依赖先走 `resolveDynamicImport`，字面量未处理再回退 |
| 为什么 `resolveId`/`load` 用 first | 身份与内容来源必须唯一，不能让多个插件同时说了算 |
| 为什么 `transform` 用 reduce | 转换需要叠加，前一棒输出就是后一棒输入 |

## 构建阶段剩余两步

模块图建完后，`Graph.build()` 还要做两件事：

### 排序与绑定

- **执行顺序排序**：ESM 的语义是「先执行被依赖模块」，Rollup 对模块图做拓扑类排序得到执行序列；循环依赖在这里被处理。
- **`linkImports` / 绑定引用**：把每个 AST 节点里引用的标识符绑定到作用域系统中的 `Variable`，跨模块的 import 绑定到导出方的声明。这是后续 Tree-shaking 能精确判断「谁用了谁」的前提。

### Tree-shaking 标记

```ts
// src/Graph.ts（简化）
async includeStatements() {
  for (const module of [...this.entryModules, ...this.implicitEntryModules]) {
    this.options.treeshake === false
      ? module.includeAllInBundle()   // 关闭 tree-shaking：全量保留
      : module.include()              // 入口默认保留所有顶层执行
  }
  // 新被 include 的代码可能引用未标记的语句，反复传递直到收敛
  while (await runTaskQueue()) { /* ... */ }
}
```

每个模块 / AST 节点身上只有一个布尔 `included` 标记，**没被标记的语句在渲染阶段直接不输出**。原理详见 [Tree-shaking 原理](/notes/rollup/tree-shaking)。

## 生成阶段：Bundle.generate

```ts
// src/Bundle.ts（简化）
async generate(outputOptions, write) {
  await this.pluginDriver.hookParallel('renderStart', [])

  // 分块：入口 chunk + 动态 import 产生的 chunk
  const chunks = this.getChunkAssignments(entryModules)

  for (const chunk of chunks) {
    chunk.render()                    // 只输出 included 代码，重写 import/export
    chunk.deconflictChunk()           // 多模块合并后变量重名，按作用域重命名
    let code = chunk.code
    code = finalisers[format](chunk)  // 按 format 包装（esm/cjs/umd/iife）
    code = await pluginDriver.hookFirst('renderChunk', [code, chunk, outputOptions])
    // 计算内容哈希，替换 [hash] 占位符
  }

  await this.pluginDriver.hookParallel('generateBundle', [outputOptions, bundle, false])
  // write 模式下：写盘 → writeBundle → closeBundle
}
```

`chunk.render()` 内部除了只输出 `included` 代码，还会计算 chunk 的导出表与依赖表——动态 import 的分割点就是在这里变成独立 chunk 的。

## 完整流程图

```
rollup(options)
    ↓
rollupInternal()
    ├─ getInputOptions → 选项标准化
    ├─ new Graph()                          # 模块图 + PluginDriver
    └─ graph.build()                        # ── 构建阶段 ──
         ├─ buildStart 钩子 [parallel]
         ├─ addEntryModules()               # 入口也会先走一遍 resolveId
         │   └─ fetchModule() × N（递归 + 并发）
         │       ├─ resolveId   [first]     说明符 → ID
         │       ├─ load        [first]     ID → 源码
         │       ├─ transform   [reduce]    源码 → 新源码
         │       ├─ parse（内部）           源码 → AST + 依赖列表
         │       ├─ resolveId / resolveDynamicImport  并发解析本模块依赖
         │       ├─ moduleParsed [parallel] 只读通知
         │       ├─ fetchModule(依赖)       递归
         │       └─ linkImports()           绑定跨模块引用
         ├─ sortModules()                   执行顺序 + 循环依赖处理
         ├─ includeStatements()             Tree-shaking 标记
         └─ buildEnd 钩子 [parallel]
    ↓
RollupBuild { generate, write, close }
    ↓
build.generate(outputOptions)               # ── 生成阶段 ──
    ├─ outputOptions 钩子 [reduce]
    ├─ renderStart 钩子 [parallel]
    ├─ 模块分配到 Chunk（入口 + 动态 import 分割点）
    ├─ chunk.render()：只渲染 included 代码，重写 import/export
    ├─ deconflictChunk()：变量去冲突
    ├─ finaliser：按 format 包装（esm/cjs/umd/iife）
    ├─ renderChunk 钩子 [first]（压缩、后处理）
    ├─ 内容哈希替换 [hash]
    ├─ generateBundle 钩子 [parallel]（可增删产物）
    └─ writeBundle [parallel] / closeBundle → 写盘结束
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

| 环节 | 发生了什么 |
| --- | --- |
| `resolveId` | `./main.js` 解析为绝对路径；入口 `importer` 为 `undefined`、`isEntry` 为 `true` |
| `load` | 读 `main.js`；再读 `foo.js` |
| `transform` | 两个模块各走一遍插件链（示例中没有插件，代码不变） |
| `parse` | 得到两张 AST；`main.js` 的依赖列表是 `['./foo.js']` |
| `resolveId`（依赖） | `./foo.js` → `/abs/foo.js` |
| `moduleParsed` | `main.js` 先触发（依赖已解析），`foo.js` 后触发 |
| 排序 + 绑定 | 执行顺序 `[foo, main]`；`main.js` 的 `foo` 绑定到 `foo.js` 的声明 |
| Tree-shaking | `console.log` 有副作用 → 保留 → 用到 `foo` → 标记；`bar` / `unused` 无人引用 → 不标记 |
| 渲染 | 只输出 `const foo = 1` 与 `console.log(foo)`，import/export 被重写掉 |

产物（esm）：

```js
const foo = 1;

console.log(foo);
```

## 核心类速查

| 类 | 文件 | 职责 |
| --- | --- | --- |
| `Graph` | `src/Graph.ts` | 持有模块图，驱动 buildStart / 建图 / 排序 / 标记 / buildEnd |
| `ModuleLoader` | `src/ModuleLoader.ts` | `resolveId → load → transform → parse → moduleParsed` 管线，递归建图 |
| `Module` | `src/Module.ts` | 单模块：AST、作用域、依赖、`included` 标记 |
| `ExternalModule` | `src/ExternalModule.ts` | 外部依赖，无源码，只处理导入导出 |
| `Bundle` | `src/Bundle.ts` | 一次 generate 的总调度 |
| `Chunk` | `src/Chunk.ts` | 一个输出文件：渲染、去冲突、导出表 |
| `PluginDriver` | `src/utils/PluginDriver.ts` | 钩子调度（first / parallel / reduceArg0），详见[插件生命周期](/notes/rollup/plugin-hooks) |
