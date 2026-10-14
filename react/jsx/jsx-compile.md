# JSX 的本质与编译

## 核心思路

JSX 既不是字符串模板，也不是 HTML，更不是运行时才解析的东西。它只是一个**函数调用的语法糖**，在构建阶段被 Babel 或 TypeScript 直接改写成普通的 JavaScript 表达式。

| 常见误解 | 真实情况 |
|---------|---------|
| JSX 是字符串/模板，交给浏览器解析 | 浏览器只认识编译后的 JS，JSX 从不原样到达浏览器 |
| JSX 就是 HTML | 属性是驼峰命名（className 而非 class），本质是表达式 |
| JSX 是运行时解析的模板引擎 | 编译期静态改写，产物是函数调用，运行时只消费结果 |

理解 JSX 的关键一句话：**写的是标签，编译出来的是函数调用，运行出来的是一棵描述 UI 的对象树**。

## 编译流程总览

```text
.jsx / .tsx 源码
    ↓ Babel（@babel/preset-react）或 tsc 解析为 AST
AST（JSXElement 节点）
    ↓ 按 jsx 配置选择模式
函数调用表达式：React.createElement(...) 或 _jsx / _jsxs(...)
    ↓ 打包（产物里不再有尖括号）
浏览器执行 → 得到 React Element 对象
```

## 两种编译模式

### 经典模式（classic runtime）

编译为 `React.createElement(type, config, children...)`。因为名字 `React` 是硬编码在产物里的，所以**必须手动 `import React`**，否则运行时报 `React is not defined`。

```jsx
function App() {
  return (
    <div className="box" id="app">
      <h1>标题</h1>
      <p>{msg}</p>
    </div>
  )
}
```

编译产物（经典模式）：

```javascript
import React from "react"

function App() {
  return React.createElement(
    "div",
    { className: "box", id: "app" },
    React.createElement("h1", null, "标题"),
    React.createElement("p", null, msg)
  )
}
```

注意 `createElement` 用的是**可变参数**：`children` 从 `arguments` 里切片出来再拼成数组，元素越多这笔切片开销越明显。

### 自动运行时（automatic runtime，React 17+）

编译产物不再引用 `React` 全局名，而是从 `react/jsx-runtime` 导入 `_jsx` / `_jsxs`。**不必手动 import React**，产物更小，也更利于 tree-shaking。

```jsx
function App() {
  return (
    <div className="box" id="app">
      <h1>标题</h1>
      <p>{msg}</p>
    </div>
  )
}
```

编译产物（自动运行时）：

```javascript
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime"

function App() {
  return _jsxs("div", {
    className: "box",
    id: "app",
    children: [
      _jsx("h1", { children: "标题" }),
      _jsx("p", { children: msg })
    ]
  })
}
```

### _jsx 与 _jsxs 的区别

| 函数 | 使用场景 | 子节点传法 |
|------|---------|-----------|
| `_jsx` | 没有子节点，或只有一个子节点 | `children` 直接写在 props 上 |
| `_jsxs` | **静态已知的多个子节点** | `children` 直接作为数组塞进 props，省掉一次变参切片 |

`_jsxs` 的 `s` 表示 static children：子节点数量编译期已知，编译器直接把数组写进 `props.children`，跳过 `createElement` 那种「从 arguments 切出数组」的开销。当子节点是动态的（例如来自 `{...spread}` 或条件表达式数量不定）时会退回 `_jsx`。

```jsx
// 子节点数量静态已知 → _jsxs，children 直接是数组
<>
  <A />
  <B />
</>
```

```javascript
// 编译产物
import { jsxs as _jsxs } from "react/jsx-runtime"
_jsxs(Fragment, { children: [_jsx(A, {}), _jsx(B, {})] })
```

### 经典 vs 自动运行时对比

| 对比项 | 经典模式 | 自动运行时 |
|--------|---------|-----------|
| 编译目标 | `React.createElement` | `react/jsx-runtime` 的 `_jsx` / `_jsxs` |
| 是否需要 `import React` | 必须 | 不需要 |
| 子节点传参 | 变参切片成数组 | 静态时直接写数组，省开销 |
| 产物体积 | 较大 | 更小，更易 tree-shaking |
| 引入版本 | 一直可用 | React 17 起为默认 |

## React Element 对象结构

`createElement` 与 `_jsx` 最终都产出同一个形状的普通对象：

```javascript
const element = {
  $$typeof: Symbol.for('react.element'), // 类型标记，防伪造
  type: "div",                     // 字符串（host 标签）或函数/类（组件）
  key: null,                       // 从 config 里单独提取
  ref: null,                       // 从 config 里单独提取
  props: {                         // 除 key / ref 外的属性 + children
    className: "box",
    id: "app",
    children: [ /* 子元素 */ ]
  },
  _owner: null,                    // 创建它的组件（开发期用途）
  _store: { validated: false }     // 开发期校验标记
}
```

### 为什么用 $$typeof 防伪造

`Symbol.for('react.element')` 是**无法被 JSON 序列化**的值（JSON 里没有 symbol 类型）。如果服务端把用户内容当 JSON 直接注入到页面，攻击者无法构造出带该 Symbol 的字符串，因此即使注入了形似 element 的对象也不会被 React 当作合法元素渲染，从源头掐断了一类 XSS。注意用的是 `Symbol.for`（注册到全局符号表、可跨 realm 取值），而不是 `Symbol(...)`；React 19 起元素类型符号仍是同样的防伪造思路。

### key 与 ref 为什么不在 props 里

`key` 和 `ref` 在 `createElement(type, config, ...)` 阶段就从 `config` 中被**单独抽出来**赋给 `element.key` / `element.ref`，不会进入 `props`。原因是二者语义特殊：`key` 是 reconcile 时的身份标识，`ref` 是宿主实例的引用，都不属于组件「收到的属性」。所以在子组件里 `props.key`、`props.ref` 读不到它们。

但要注意 **React 19 起 `ref` 可作为普通 prop 向下传递**：函数组件不再需要对 `forwardRef` 包裹，`ref` 可像 `key` 之外的其他 prop 一样直接声明和透传。这是 19 相对 18 在 ref 处理上的重要变化。

## 编译配置

### Babel

```text
{
  "presets": [
    ["@babel/preset-react", { "runtime": "automatic" }]
  ]
}
```

`runtime: "automatic"` 即启用自动运行时；缺省（或不写）等价于经典模式，仍需 `import React`。

### TypeScript

```text
{
  "compilerOptions": {
    "jsx": "react-jsx"
  }
}
```

| tsconfig `jsx` 取值 | 对应模式 | 产物 |
|---------------------|---------|------|
| `"react"` | 经典 | `React.createElement`（需 import React） |
| `"react-jsx"` | 自动运行时 | `react/jsx-runtime` 的 `_jsx` |
| `"react-jsxdev"` | 自动运行时 + 调试信息 | `react/jsx-dev-runtime`，含源码位置 |

### createElement vs jsx/jsxs 对比

| 对比项 | `createElement` | `_jsx` / `_jsxs` |
|--------|-----------------|------------------|
| 子节点参数 | 变参，运行时切片成数组 | 编译期已知形态，静态多子节点直接写数组 |
| 是否需 React 在作用域 | 是 | 否 |
| key / ref 处理 | 从 config 提取 | 同样提取，key 以第三参传入 |
| 产物可压缩性 | 一般 | 更好（`/*#__PURE__*/` 便于压缩与摇树） |

## 面试答法

JSX 本质上只是 `React.createElement` 或 `_jsx` 这类函数调用的语法糖，在构建阶段被 Babel 或 TypeScript 静态改写成普通 JS 表达式，浏览器拿到的永远是编译产物而不是原始尖括号，所以它不是字符串模板也不是 HTML。它有两种编译模式：经典模式编成 `React.createElement(type, config, children...)`，因为产物里硬编码了 `React` 这个名字必须手动 import；React 17 引入的自动运行时则从 `react/jsx-runtime` 导入 `_jsx` / `_jsxs`，省掉手动引入、产物更小，其中 `_jsxs` 用于静态已知的多个子节点，直接把数组写进 `props.children` 省掉变参切片。编译出来的对象就是 React Element，包含 `$$typeof`、`type`、`key`、`ref`、`props` 等字段，`$$typeof` 用无法 JSON 序列化的 Symbol 防止外部注入伪造元素引发 XSS，`key` 和 `ref` 会在创建时从 config 中单独抽出而不放进 props，React 19 起 ref 还能作为普通 prop 向下传递。配置上，Babel 用 `@babel/preset-react` 的 `runtime: "automatic"`，TypeScript 用 `"jsx": "react-jsx"`。
