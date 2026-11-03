# JSX 到底是什么：一段你写不出来的函数调用

## 先从一个报错说起

刚上手 React 的人几乎都被这个坑绊过一次：把文件顶上那句 `import React from 'react'` 删掉——代码里明明一个 `React.` 都没写啊——刷新，白屏：

```text
ReferenceError: React is not defined
```

尖括号明明是"标签"，报的却是 `React` 没定义。这两件事怎么会扯上关系？

因为**你写的尖括号，在到达浏览器之前就已经不存在了**。编译器把它换成了一次普通函数调用，而被调用的那个函数，恰好挂在 `React` 这个名字下面。JSX 的全部秘密，都在这句"偷换"里。

## 打个比方：便签、面单、包裹

- JSX 是你随手写在便签上的地址，人一眼看懂，快递系统读不懂
- 编译器是打印面单的柜台，负责把便签翻译成系统认识的标准字段
- `React.createElement(...)` / `_jsx(...)` 就是那串标准字段
- 产出的 React Element 是打印出来的那张面单：收件人（`type`）、物品清单（`props`）、运单号（`key`）

面单打印出来就定稿，改不了；每次寄件都得重新打一张；一张面单也不带"快递送到哪了"的进度。后面 Element 的所有脾气，都是这张纸的脾气。

先把几个流传很广的误解摘清楚：

| 常见误解 | 真实情况 |
|---------|---------|
| JSX 是字符串/模板，交给浏览器解析 | 浏览器只认识编译后的 JS，尖括号从不原样到达浏览器 |
| JSX 就是 HTML | 属性是驼峰命名（`className` 而非 `class`），本质是表达式，可以嵌任意 JS |
| JSX 是运行时解析的模板引擎 | 编译期静态改写，产物是函数调用，运行时只消费结果 |

一句话记住：**写的是标签，编译出来的是函数调用，跑出来的是一棵描述 UI 的对象树。**

## 编译器在什么时候动的手

```text
.jsx / .tsx 源码
    ↓ Babel（@babel/preset-react）或 tsc 解析为 AST
AST（JSXElement 节点）
    ↓ 按 jsx 配置选定模式
函数调用表达式：React.createElement(...) 或 _jsx / _jsxs(...)
    ↓ 打包（产物里不再有尖括号）
浏览器执行 → 得到 React Element 对象
```

注意从 AST 到函数调用这一步：它是**静态改写**，不是运行时解析。产物送进浏览器时，JSX 的痕迹已经一点不剩了。

## 两种翻译法之一：经典模式（每张面单自己盖章）

经典模式（classic runtime）编译成 `React.createElement(type, config, children...)`。因为 `React` 这个名字是**硬编码写死在产物里**的，所以必须手动 `import React`——这就是开头那个报错的来源。

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
    "div",                                  // type：标签名，原样变成字符串
    { className: "box", id: "app" },        // config：属性集中在一个对象里
    React.createElement("h1", null, "标题"), // children：从第三个参数起，一个个平铺进来
    React.createElement("p", null, msg)      // 表达式 {msg} 变成普通实参 msg
  )
}
```

`createElement` 用的是**可变参数**：`children` 从 `arguments` 里切片出来再拼成数组。子节点越多，这笔切片开销越明显——这也是后来要改自动运行时的原因之一。

## 两种翻译法之二：自动运行时（柜台自带印章）

React 17 起默认走自动运行时（automatic runtime）。产物不再引用 `React` 这个全局名，而是从 `react/jsx-runtime` 导入 `_jsx` / `_jsxs`。**不必手动 import React**，产物更小，也更利于 tree-shaking。

同一个组件，编译产物变成：

```javascript
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime"

function App() {
  return _jsxs("div", {                    // 多个静态子节点 → _jsxs
    className: "box",
    id: "app",
    children: [                            // children 直接就是数组，不再靠变参切片
      _jsx("h1", { children: "标题" }),     // 单个子节点 → _jsx，children 挂在 props 上
      _jsx("p", { children: msg })
    ]
  })
}
```

### 为什么要分成 `_jsx` 和 `_jsxs`

| 函数 | 使用场景 | 子节点传法 |
|------|---------|-----------|
| `_jsx` | 没有子节点，或只有一个子节点 | `children` 直接写在 props 上 |
| `_jsxs` | **静态已知的多个子节点** | `children` 直接作为数组塞进 props，省掉一次变参切片 |

`_jsxs` 的 `s` 就是 static children：子节点数量编译器在编译期就知道，于是它把数组直接写进 `props.children`，跳过 `createElement` 那种"从 `arguments` 切出数组"的开销。子节点数量动态时（例如来自 `{...spread}`、或条件表达式导致数量不定）就无法预知，只能退回 `_jsx`。

```jsx
// 两个子节点，数量编译期已知 → _jsxs
<>
  <A />
  <B />
</>
```

```javascript
// 编译产物：children 直接写成数组
import { jsxs as _jsxs } from "react/jsx-runtime"
_jsxs(Fragment, { children: [_jsx(A, {}), _jsx(B, {})] })
```

### 两种模式摆在一起看

| 对比项 | 经典模式 | 自动运行时 |
|--------|---------|-----------|
| 编译目标 | `React.createElement` | `react/jsx-runtime` 的 `_jsx` / `_jsxs` |
| 是否需要 `import React` | 必须 | 不需要 |
| 子节点传参 | 变参切片成数组 | 静态时直接写数组，省开销 |
| 产物体积 | 较大 | 更小，更易 tree-shaking |
| 引入版本 | 一直可用 | React 17 起为默认 |

## 面单长什么样：Element 对象结构

`createElement` 与 `_jsx` 最终都产出同一个形状的普通对象：

```javascript
const element = {
  $$typeof: Symbol.for('react.element'), // 防伪水印，下面单独讲
  type: "div",                     // 字符串（host 标签）或函数/类（组件）
  key: null,                       // 从 config 里单独提取，不进 props
  ref: null,                       // 同上
  props: {                         // 除 key / ref 之外的所有属性 + children
    className: "box",
    id: "app",
    children: [ /* 子元素 */ ]
  },
  _owner: null,                    // 创建它的组件（仅开发期调试用途）
  _store: { validated: false }     // 开发期校验标记
}
```

注意 `props` 里确实没有 `key` 和 `ref`：它们在创建时就被单独拎到了同级的 `key` / `ref` 字段上。

## `$$typeof`：张贴在面单上的防伪水印

`Symbol.for('react.element')` 是**无法被 JSON 序列化**的值——JSON 里根本没有 symbol 这个类型，`JSON.parse` 永远造不出它。如果服务端把用户内容当 JSON 直接注入页面，攻击者构造不出带该 Symbol 的对象，即使注入了形似 element 的假面单，React 也不会把它当合法元素渲染，从源头掐断了一类 XSS。

细节是：这里用的是 `Symbol.for`（注册到全局符号表、可跨 realm 取值），而不是 `Symbol(...)`；React 19 起元素类型符号仍是同样的防伪造思路。

## 为什么 key、ref 不跟 props 混在一起

在 `createElement(type, config, ...)` 阶段，`key` 和 `ref` 就从 `config` 里被**单独抽出来**赋给 `element.key` / `element.ref`，不会进入 `props`。原因是二者语义特殊：`key` 是 reconcile 时的身份标识（运单号），`ref` 是宿主实例的引用（签收人），都不属于组件"收到的属性"。所以在子组件里写 `props.key`、`props.ref` 是读不到的。

但要注意 **React 19 起 `ref` 可以作为普通 prop 向下传递**：函数组件不再需要 `forwardRef` 包裹，`ref` 能像其他 prop 一样直接声明和透传。这是 19 相对 18 在 ref 处理上的重要变化。

## 工程里怎么配

### Babel

```json
{
  "presets": [
    ["@babel/preset-react", { "runtime": "automatic" }]
  ]
}
```

`runtime: "automatic"` 即启用自动运行时；不写这一项等价于经典模式，仍然需要 `import React`。

### TypeScript

```json
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

### `createElement` 与 `_jsx` / `_jsxs` 的其余差别

| 对比项 | `createElement` | `_jsx` / `_jsxs` |
|--------|-----------------|------------------|
| 子节点参数 | 变参，运行时切片成数组 | 编译期已知形态，静态多子节点直接写数组 |
| 是否需 React 在作用域 | 是 | 否 |
| key / ref 处理 | 从 config 提取 | 同样提取，`key` 以第三参传入 |
| 产物可压缩性 | 一般 | 更好（`/*#__PURE__*/` 便于压缩与摇树） |

## 面试答法

JSX 只是函数调用的语法糖，构建阶段被 Babel 或 TypeScript 静态改写成普通 JS，浏览器拿到的永远是编译产物，所以它既不是字符串模板也不是 HTML。两种编译模式：经典模式编成 `React.createElement(type, config, children...)`，产物里硬编码了 `React`，必须手动 import；React 17 的自动运行时改从 `react/jsx-runtime` 导入 `_jsx` / `_jsxs`，不用 import、产物更小更好 tree-shaking，其中 `_jsxs` 用于静态已知的多子节点，直接把数组写进 `props.children`，省掉变参切片。编译产物是一个 React Element 对象，核心字段 `$$typeof`、`type`、`key`、`ref`、`props`，`$$typeof` 用无法 JSON 序列化的 Symbol 防伪造注入、掐断一类 XSS，`key` 和 `ref` 在创建时从 config 单独抽出、不进 props，React 19 起 ref 能当普通 prop 传下去。配置上 Babel 写 `runtime: "automatic"`，TS 写 `"jsx": "react-jsx"`。
