# 模块化与构建工具：CommonJS/ESM、Webpack、Vite

## 题目

> CommonJS 和 ESM 有哪些区别？为什么说 ESM 是静态的、CJS 是动态的？tree-shaking 为什么只有 ESM 能做？循环依赖时两者表现有何不同？Webpack 的打包流程是怎样的，loader 和 plugin 分别工作在哪个环节？Vite 开发环境为什么比 Webpack 快，esbuild 预构建解决什么问题？HMR 的原理是什么？

## 为什么需要

模块化是工程化的地基，构建工具是地基上的工厂。两条主线：

1. **模块规范之争**：CJS 诞生于 Node 早期（同步 IO 模型），ESM 是语言标准（为静态分析设计）。今天写库、配构建、读报错（`require is not defined` / `Cannot use import statement`）全绕不开它俩的差异。
2. **构建范式之争**：Webpack 代表"**先全量打包再服务**"，Vite 代表"**浏览器原生 ESM 按需服务**"。理解了 ESM 的静态特性，才能理解 tree-shaking、预构建、HMR 这些概念为什么存在。

```
一句话定位：
  CJS：运行时确定依赖（值拷贝，路径可变量）
  ESM：编译期确定依赖（引用绑定，import 是"指针"不是"快照"）
  静态结构 ──► 可安全删除未使用代码 ──► tree-shaking ──► 更小的 bundle
```

## 核心要点

### 1. CommonJS vs ESM 全维度对比

```javascript
// CJS：module.exports / require，运行时同步加载
const utils = require('./utils')          // 路径可以是变量/模板串
module.exports = { foo }                 // 导出"值的拷贝"

// ESM：import/export，加载阶段静态解析
import { foo } from './utils.js'         // 路径必须字面量（顶层 import）
export const foo = 1                     // 导出"活的引用绑定"
```

| 维度 | CommonJS | ESM |
| --- | --- | --- |
| 语法 | require / module.exports | import / export |
| 加载时机 | **运行时**同步加载并执行 | **编译阶段**静态分析依赖，执行前链接 |
| 导出本质 | 值的拷贝（修改互不影响） | 实时引用绑定（源变则导入方跟着变） |
| 动态路径 | `require(变量)` 随意 | 顶层 import 必须静态，动态用 `import()` |
| this | 指向 module.exports | undefined |
| 顶层作用域 | 有 module/exports/require | 无上述三件套；有 `import.meta` |
| this/顶层变量差异后果 | 可 monkey-patch | 严格模式，全局变量不泄漏 |
| 循环依赖 | 返回**已执行部分的快照**（可能拿到 undefined） | 返回**引用**，执行期才取值（函数声明通常能救回） |
| Tree-shaking | 不可靠（静态分析不了） | 原生支持 |
| 环境 | Node 生态 | 浏览器原生 + Node（.mjs/type:module） |

```
循环依赖对比（a↔b 互相 require/import）：

CJS：a 执行到一半被 b require → b 拿到 a 的"半成品拷贝"
      └─ 后果：b 里 a 的后定义成员永远 undefined（快照定格）

ESM：链接阶段只登记引用，不取值；a、b 都执行完后
     引用才"通电" → 若依赖的是函数声明（提升），运行期正常
      └─ 后果：TDZ 类错误只在"执行期真的用到未初始化变量"时才爆
```

### 2. Tree-shaking 为什么依赖 ESM 静态结构

```javascript
// math.js
export const add = (a, b) => a + b
export const mul = (a, b) => a * b

// main.js
import { add } from './math.js'   // 编译期即可确定：mul 从未被引用
```

- ESM 的 `import/export` 在**解析阶段**就形成确定的依赖图，且导出绑定不可被条件改写 → 打包器可以证明"某导出无人引用"，安全删除。
- CJS 做不到：`const m = require(p)` 里 p 是变量、`m.xxx` 可以动态拼属性、`module.exports = 任意对象`——静态分析无法穷举"哪些导出会被用到"，删任何都可能有副作用。
- 副作用控制：`package.json` 的 `"sideEffects": false`（或文件列表）告诉打包器"删代码不会改变行为"，否则模块顶层的 `console.log`/polyfill 会阻止摇树。

### 3. Webpack 打包流程

```
  entry（声明入口）
    │
    ▼ ① 从入口递归构建【依赖图】
       每个模块：resolve 路径 → 匹配 loader → 编译成 JS → 解析 AST 找新依赖
       ┌──────────────────────────────────────────┐
       │ loader 位置：单文件翻译官（源码级）          │
       │  .ts→babel/swc   .scss→sass+css-loader     │
       │  .vue→vue-loader  图片→asset/resource      │
       └──────────────────────────────────────────┘
    ▼ ② 按 chunk 配置切分【代码块】（entry/splitChunks/动态 import）
       ┌──────────────────────────────────────────┐
       │ plugin 位置：生命周期钩子（全局事件级）       │
       │  在 compile / emit 等钩子上注入能力：        │
       │  HTML 注入、压缩、CSS 抽取、Bundle 分析      │
       └──────────────────────────────────────────┘
    ▼ ③ 每个 chunk 内模块按 runtime 包装成函数
       __webpack_modules__ = { './src/a.js': (m,e,r)=>{...}, ... }
    ▼ ④ 输出 bundle：runtime + 入口 chunk + 异步 chunk（.js 文件）
```

记忆锚点：**loader 管"翻译"（一个文件怎么变成 JS），plugin 管"流程"（打包各阶段还能顺手干什么）**；loader 是编译子任务，plugin 是事件总线订阅者。

### 4. Vite 为什么快

```
Webpack 冷启动：
  请求页面 ─►【全量构建依赖图 + 编译所有模块 + 打包 bundle】─► 才能响应
             ├──────────── 项目越大越久（分钟级）────────────┤

Vite 冷启动（dev）：
  请求页面 ─► 直接返回原始 HTML ─► 浏览器解析 <script type="module">
             │
             ▼ 浏览器遇到 import '/src/a.js' 才【按需】请求
             开发服务器：只编译这一个文件（esbuild 转 TS/JSX）─► 返回
             未请求的模块永远不编译 ─► 启动 O(1)，与项目体积几乎无关
```

两个关键设计：

1. **原生 ESM 按需编译**：dev server 不做打包，把"依赖图构建"外包给浏览器；改一个文件只失效一个模块请求。
2. **esbuild 预构建依赖**（node_modules）：
   - CJS/UMD 依赖 → 统一转成 ESM（浏览器只认 ESM）；
   - 把成百上千个小文件合并（lodash-es 的每个函数一个文件 → 合成 1 个），避免浏览器发起海量请求；
   - esbuild 用 Go 编写，比 JS 写的 babel 转译快 10~100 倍，产物缓存到 `node_modules/.vite`。

```
生产构建：Vite 用 Rollup 打包（仍是全量），
         但依赖预构建缓存 + 并行加载让整体仍占优
```

### 5. HMR 原理简述

```
┌─ 浏览器 ────────────────┐        ┌─ dev server ──────────────┐
│ 页面内注入 client 脚本     │◄─WS──►│ 文件监听(chokidar)          │
│ 收到 'update' 消息         │        │ 变更 → 定位影响模块          │
│   │                        │        │ 广播 hmr payload            │
│   ▼                        │        └─────────────────────────────┘
│ 动态 import 新模块
│   ├─ 模块导出 accept 边界 ─► 只替换该模块（React Fast Refresh 保状态）
│   └─ 无 accept 边界       ─► 整页 reload
```

Webpack/Vite 思路一致：**WebSocket 推送变更 + 浏览器端热替换模块**；能否"无刷新保留状态"取决于模块是否声明了 HMR 边界（`import.meta.hot.accept` / vue-loader、react-refresh 自动注入）。

## 面试答法

### 30 秒版（可背诵）

> CJS 是运行时同步加载、导出值的拷贝、路径可以动态；ESM 是编译期静态分析依赖、导出实时引用绑定、顶层 import 必须字面量。ESM 的静态结构让打包器能证明哪些导出没人用，所以 tree-shaking 只有 ESM 可靠，CJS 的动态 require 静态分析不了。循环依赖上 CJS 拿半成品快照容易 undefined，ESM 是引用、执行期才取值。Webpack 流程是入口→递归构建依赖图（loader 负责单文件翻译）→按 chunk 切分（plugin 挂在生命周期钩子上做全局事）→打包输出 bundle。Vite 开发环境不打包，直接利用浏览器原生 ESM 按需请求、按需编译，启动成本与项目体积无关；node_modules 用 esbuild 预构建成 ESM 并合并小文件，解决 CJS 兼容和请求瀑布问题。HMR 是 dev server 通过 WebSocket 推送模块变更，浏览器动态导入新模块替换，无 accept 边界则整页刷新。

### 深入版（被追问时按编号展开）

1. **对比表逐行讲**：重点"值拷贝 vs 引用绑定"，用循环依赖快照/通电图解释差异后果
2. **tree-shaking**：静态结构可证明 + sideEffects 声明 + 为什么 CJS 删代码不安全
3. **Webpack 流程图**：标清 loader（文件翻译）与 plugin（生命周期钩子）的位置差异
4. **冷启动时间线对比**：Webpack 全量构建后才响应 vs Vite 返回 HTML 后逐模块按需编译
5. **预构建两动机**：CJS→ESM 统一格式 + 小文件合并防请求瀑布；esbuild 的 Go 性能
6. **HMR 链路**：WS 推送→动态 import→accept 边界替换或整页刷新；React Fast Refresh 保状态
7. **收尾加分**：Vite 生产用 Rollup 的取舍、Module Federation 运行时共享依赖

### 常见追问

- **ESM 加载一定异步吗？** → 浏览器里 `<script type=module>` 和静态 import 都在解析阶段异步获取；Node 的 ESM 链接阶段也是先 fetch 再执行；只有 `require` 是同步
- **`import()` 动态导入算破坏静态性吗？** → 不算：它返回 Promise，是显式的运行时加载点，打包器把它识别为 chunk 分割线（代码分割基础）
- **为什么 ESM 修改导入变量会报错而 CJS 不会？** → ESM 导出绑定是只读的实时引用（类似 const 视图）；CJS 导出只是一个普通对象，随便改
- **top-level await 谁支持？** → 只有 ESM（`await import()`、配置加载场景）；CJS 同步模型无法表达"顶层等待"
- **双包问题（dual package hazard）是什么？** → 同一库同时被 CJS 和 ESM 加载会产生两份实例（单例/ instanceof 失效）；现代方案是打包器统一或 exports 字段做条件映射
- **Vite dev 下为什么有时还慢/闪烁？** → 深层依赖链导致请求瀑布（预构建可缓解）、CJS 依赖未预构建、未配 optimizeDeps.include；新优化方向是 Rolldown 统一 dev/build
