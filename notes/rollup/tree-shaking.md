# Rollup Tree-shaking 原理

Tree-shaking = 从入口出发，沿「被使用」关系标记保留的代码，没被标记的语句在渲染时直接不输出。Rollup 是这套机制的开创者，核心依赖三点：**ESM 静态结构 + 自定义 AST 类系统 + 作用域变量追踪**。

## 为什么 ESM 才能摇

```js
// ESM：编译期即可确定导入导出关系，静态可分析
import { foo } from './lib.js'

// CJS：运行时才知道导出什么、导入什么
const lib = require(dynamicName)
exports[computedKey] = fn
```

ESM 的 `import`/`export` 声明在顶层、说明符是字面量，Rollup 才能在「不执行代码」的前提下精确判断每个导出的使用情况。

## 三件套：hasEffects / include / render

Rollup 不用 acorn 的裸 AST 做分析，而是把每个节点实例化成类（`src/ast/nodes/`，每个 ESTree 类型对应一个 TS 类），节点自带三个关键方法：

```
┌──────────────────────────────────────────────┐
│  hasEffects(context)   这个节点执行时有副作用吗？ │
│  include(context)      标记：我要被保留          │
│  render(code, options) 渲染：输出自己的代码       │
└──────────────────────────────────────────────┘
```

### 标记阶段：include

基类 `Node` 的简化源码（`src/ast/nodes/Node.ts`）：

```ts
class Node {
  included = false

  include(context, includeChildrenRecursively) {
    if (!this.included) {
      this.included = true
      // 把自己 include，同时把"依赖"也拉进来：
      // 比如这条语句用到了变量 foo，就顺着 Variable 找到 foo 的声明节点，
      // 把它也 include（跨模块也一样，Variable 绑定的是导出方的声明）
      for (const variable of this.getReferencedVariables()) {
        variable.include(context, includeChildrenRecursively)
      }
      this.includeChildren(context, includeChildrenRecursively)
    }
  }
}
```

入口模块的顶层语句默认全部 `include`（模块加载即执行），然后**多轮传递直到收敛**——新标记的代码又引用了别的声明，继续拉进来，直到没有新增。

### 判定阶段：hasEffects

哪些顶层语句"必须保留哪怕没人引用"？看副作用。简化示例（`CallExpression`）：

```ts
class CallExpression extends Node {
  hasEffects(context) {
    // 1. /* #__PURE__ */ 注释声明为纯 → 无副作用
    if (this.annotations.some(a => a.value === 'PURE')) return false

    // 2. callee 本身有副作用（如 console.log 的成员访问）
    if (this.callee.hasEffects(context)) return true

    // 3. 参数求值有副作用
    for (const arg of this.arguments) {
      if (arg.hasEffects(context)) return true
    }

    // 4. 函数体是否"已知纯"：内置函数查表（Math.max 纯、Date.now 不纯）
    //    用户函数则分析函数体内是否只有纯操作
    return !this.isPureFunction()
  }
}
```

常见判定速记：

| 代码 | 有副作用？ |
| --- | --- |
| `const x = 1 + 2` | 无 |
| `function f() { ... }`（声明本身） | 无 |
| `console.log(x)` / `alert()` | 有 |
| `Math.max(1, 2)` | 无（内置表标记为纯） |
| `Date.now()` / `Math.random()` | 有（结果依赖环境） |
| `x = 1`（x 是外部变量） | 有（改写外部状态） |
| `new Foo()` | 保守视为有（构造函数可能做任何事） |
| `/* #__PURE__ */ fetchData()` | 无（你说了算） |

### 渲染阶段：render

只有 `included === true` 的节点参与渲染；Rollup 用 MagicString 对原始代码做**切除/改写**：未标记的函数声明整段删掉，import 语句按实际用到的导出重写，最后拼出 chunk。

## 作用域与变量系统

`include` 能跨模块追踪，靠的是 `src/ast/scopes/` 与 `src/ast/variables/`：

```
ModuleScope（模块作用域）
  └─ variables: { foo: Variable, bar: Variable }
        Variable
          ├─ declarations: [声明节点]        # 谁声明的
          └─ references / included: 使用情况  # 谁在用
```

流程：

1. **解析**：每个模块建 `ModuleScope`，收集声明 → `Variable`
2. **bindReferences**（构建阶段第②步）：标识符引用绑定到对应 `Variable`；`import { foo }` 绑定到**导出模块**里那个 `foo` 的 Variable——引用关系就此打通
3. **include 传递**：用到引用 → 标记 Variable → Variable 标记其声明节点（可能在另一个模块）→ 声明节点再拉自己的依赖

## 走查：一个跨模块的例子

`lib.js`：

```js
export const used = 'yes'
export const unused = 'no'
export function helper() { return used }
export function dead() { return unused }
init()                       // 顶层调用 → 有副作用，必须保留
function init() { console.log('boot') }
```

`main.js`：

```js
import { used, helper } from './lib.js'
console.log(used, helper())
```

标记过程：

```
main 顶层语句 include
  └─ console.log(...) 用到 used、helper
       ├─ lib.used 的 Variable → 标记 const used = 'yes'
       └─ lib.helper 的 Variable → 标记 function helper()
            └─ helper 用到 used → 已标记，收敛
lib.init 的 Variable ← 顶层调用 init() 有副作用 → 标记
  └─ init 用到 console.log → 内置有副作用 → 保留

未标记：unused、dead → 渲染时整段删除
```

产物（esm）：

```js
const used = 'yes';
function helper() { return used }
function init() { console.log('boot') }
init();

console.log(used, helper());
```

## sideEffects 字段：粗粒度开关

`package.json`：

```json
{ "sideEffects": false }
```

含义：本包所有模块，**只要导出的东西没人用，整个模块可以完全不加载执行**（连 `import './style.css'` 这种副作用导入都会被丢弃，所以 CSS 包千万别标 false）。它是构建器级别的快速剪枝，Rollup 自身更多靠节点级分析。

## 与 Webpack 的差异速记

| 维度 | Rollup | Webpack |
| --- | --- | --- |
| 分析基础 | 自定义 AST 类，节点级 `hasEffects` | 依赖 `harmony` 模块 + `sideEffects` 标记，粒度较粗 |
| 导出使用情况 | 逐 Variable 追踪，跨模块精确 | 也能摇，但对 CJS 混合模块保守 |
| 设计目标 | 产物接近手写 ESM，无运行时包装 | 一切皆 chunk，带 require 运行时 |
