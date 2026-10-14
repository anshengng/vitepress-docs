# 编译流程：parse → transform → generate

## 为什么要编译

浏览器和 JS 引擎不认识 `<div>{{ msg }}</div>` 这样的模板。Vue 组件最终要靠一个能返回 VNode 的 **render 函数** 来渲染，而模板必须先被翻译成普通的 JS 代码，这个翻译过程就是编译。

编译发生在"运行时之外"：它是提前编译（AOT，Ahead-Of-Time）式的转换——先把模板整体翻译成普通 JS，运行时只负责执行产物，不再解析字符串。

```
template 字符串
    ↓ parse（词法扫描 → 语法组装）
AST（抽象语法树）
    ↓ transform（nodeTransforms 插件逐个改写）
优化后的 AST
    ↓ generate（codegen）
render 函数代码字符串
```

## 三种编译时机

| 时机 | 谁来编译 | 典型用法 | 运行时是否带 compiler | 体积 / 性能 |
|------|---------|---------|---------------------|------------|
| 运行时编译 | `vue` 完整版（runtime + compiler） | `createApp({ template })`、`app.component('x', { template })` | 是 | 包体积最大，首次渲染前多一次编译开销 |
| 构建时预编译 | vite + `@vue/compiler-sfc` | 单文件组件 `.vue` | 否（runtime-only） | 体积最小、启动最快，官方推荐 |
| 手动编译 | `@vue/compiler-dom` 的 `compile` | 自己调 `compile(template)` | 取决调用方 | 灵活，用于自定义构建 / SSR |

> 注：Vue 2 用 `new Vue({ template: '...' })` 走运行时编译；Vue 3 默认导出的 `vue` 是 runtime-only 包，需要运行时编译时要换成含编译器的 `vue/dist/vue.esm-bundler.js`。

## 阶段一 parse：模板字符串 → AST

`parse` 把 template 字符串解析成一棵带位置信息的语法树（AST）。实现位于 `@vue/compiler-core` 的 `parser.ts`，核心是一个逐字符扫描的 **tokenizer（词法分析器，可理解为有限状态机）**：它按状态逐段匹配 HTML 标签、文本、插值、注释，切成 token 后再由解析器组装成节点树。`@vue/compiler-dom` 的 `parse` 在此基础上叠加 DOM 特有处理（如自闭合标签、`is` 属性等）。

AST 节点类型由 `NodeTypes` 枚举统一定义：

| 枚举 | 值 | 含义 |
|------|----|------|
| ROOT | 0 | 根节点，children 是模板的顶层内容 |
| ELEMENT | 1 | 元素节点，含 tag / props / children |
| TEXT | 2 | 纯文本节点 |
| COMMENT | 3 | 注释节点 |
| SIMPLE_EXPRESSION | 4 | 表达式节点，如插值里的 `msg`、指令里的 `exp` |
| INTERPOLATION | 5 | 插值节点 `{{ }}`，content 是 SIMPLE_EXPRESSION |
| ATTRIBUTE | 6 | 普通/静态属性（id、class 等） |
| DIRECTIVE | 7 | 指令节点（v-if、v-for、v-bind、v-on 等） |
| COMPOUND_EXPRESSION | 8 | 复合表达式，如 `abc{{ x }}def` 这种文本与插值混合 |
| IF | 9 | v-if 转换后生成的条件节点 |
| IF_BRANCH | 10 | 条件分支，v-if / v-else-if / v-else 各占一支 |
| FOR | 11 | v-for 转换后生成的循环节点 |
| TEXT_CALL | 12 | 文本调用节点，为 `createTextVNode` 准备 |

### 一段 template 对应的 AST

输入：

```vue
<template>
  <div id="app">{{ msg }}</div>
</template>
```

解析出的 AST（缩进树表示）：

```
ROOT (type: 0)
└── ELEMENT (type: 1)   tag: "div"
    ├── props
    │   └── ATTRIBUTE (type: 6)
    │       ├── name: "id"
    │       └── value: SIMPLE_EXPRESSION (type: 4)   content: "app"
    └── children
        └── INTERPOLATION (type: 5)
            └── content: SIMPLE_EXPRESSION (type: 4)
                ├── content: "msg"
                └── isStatic: false
```

指令节点（DIRECTIVE）的 `name` / `arg` / `exp` / `modifiers` 字段结构：

| 模板写法 | name | arg | exp | modifiers |
|---------|------|-----|-----|-----------|
| `v-if="ok"` | `if` | 空 | `ok` | `{}` |
| `:href="url"` | `bind` | `href` | `url` | `{}` |
| `@click.stop` | `on` | `click` | 空 | `{ stop: true }` |

## 阶段二 transform：遍历并改写 AST

`transform` 对 AST 做 **深度优先遍历**（`traverseNode`），依次应用一组 `nodeTransforms` 插件。每个 transform 本身可以返回一个 **onExit 回调**，该回调在它的子节点全部处理完成后、退出该节点时执行，用来做收尾改写。

core 内置的 `nodeTransforms`：

| Transform | 作用 |
|-----------|------|
| `transformOnce` | 处理 `v-once`，标记该子树只渲染一次 |
| `transformIf` | 把 `v-if` / `v-else` 改写成 `IF` / `IF_BRANCH` 节点 |
| `transformFor` | 把 `v-for` 改写成 `FOR` 节点 |
| `transformExpression` | 处理插值与表达式里的标识符，把它们挂到 `_ctx` 上 |
| `transformSlotOutlet` | 处理 `<slot>`，生成 `renderSlot` 调用 |
| `transformElement` | 把 `ELEMENT` 转成 `VNODE_CALL`，决定 props 与 patchFlag 的挂载 |
| `transformText` | 合并相邻的 `TEXT` / `INTERPOLATION` 为复合文本 |
| `transformOn` | 处理 `v-on`（含事件修饰符，compiler-dom） |
| `transformStyle` / `transformShow` | DOM 特有指令处理（compiler-dom） |

transform 阶段本质上做两件事：

1. **语义转换**：把模板语法糖变成显式结构——`v-if` → `IF` 节点，`v-for` → `FOR` 节点，元素 → `VNODE_CALL`，插值 → 文本调用。
2. **优化标记**：挂 `patchFlag`、创建静态提升（hoist）节点、收集 block。这些优化细节见同目录的 `compile-optimization.md`，本阶段只负责把标记写进 AST。

## 阶段三 generate：AST → render 函数代码字符串

`generate` 位于 `@vue/compiler-core` 的 `codegen.ts`，把 transform 后的 AST 打印成 **代码字符串**（不是函数对象）。产物形态取决于输出模式：

| 模式 | 产物形态 | 如何变为可执行代码 |
|------|---------|------------------|
| 函数模式（运行时编译） | `function render(_ctx, _cache) { ... }` 字符串 | `new Function('Vue', code)(runtimeHelpers)` 动态构造 |
| 模块模式（构建时预编译） | `import { helper } from 'vue'` + `export function render(...)` | vite / rollup 直接打包成 ESM 模块，无需 `new Function` |
| SSR | codegen 产出 `ssrRender` 函数 | 同上，由构建工具打包 |

运行时编译之所以要用 `new Function`，是因为字符串只能通过它变成真正的函数；代价是包体积更大，且受 CSP 对 `eval` 的限制。构建时预编译则把这一步交给打包器，运行时不再需要编译器。

## 一个完整的最小例子

输入：

```vue
<template>
  <div id="app">{{ msg }}</div>
</template>
```

**① parse** 得到 `ROOT → ELEMENT(div) → INTERPOLATION(msg)` 的 AST（见上文树结构）。

**② transform**：`transformElement` 把 `div` 改写为 VNODE_CALL 节点，`transformExpression` 把 `msg` 改写为 `_ctx.msg`，`transformText` 把子节点归一为文本调用，同时在 div 上挂 `patchFlag = 1 (TEXT)`。

**③ generate** 产出：

```typescript
import { createElementBlock as _createElementBlock, openBlock as _openBlock, toDisplayString as _toDisplayString } from "vue"

export function render(_ctx, _cache) {
  return (_openBlock(), _createElementBlock("div", { id: "app" }, _toDisplayString(_ctx.msg), 1 /* TEXT */))
}
```

构建时预编译场景下，上面就是最终模块代码，直接交给打包器。

运行时编译场景下，codegen 生成的是一段字符串，再包进 `new Function`：

```javascript
// 由 @vue/compiler-dom 的 compile 产出的 code 字符串
const code = `const { toDisplayString: _toDisplayString, createElementBlock: _createElementBlock, openBlock: _openBlock } = Vue
return function render(_ctx, _cache) {
  return (_openBlock(), _createElementBlock("div", { id: "app" }, _toDisplayString(_ctx.msg), 1))
}`

// 用 new Function 把字符串构造成真正的函数
const render = new Function('Vue', code)(runtimeHelpers)
```

## 三阶段职责总结

| 阶段 | 输入 | 输出 | 关键动作 |
|------|------|------|---------|
| parse | template 字符串 | AST | tokenizer 逐段扫描，组装节点树，记录位置信息 |
| transform | AST | 优化后的 AST | 深度优先遍历，语义改写 + 优化标记 |
| generate | 优化后的 AST | render 函数代码字符串 | codegen 打印代码，再经 `new Function` 或打包器变为可执行函数 |

## 面试答法

Vue 的模板编译分三个阶段：parse 把 template 字符串解析成 AST，transform 遍历 AST 应用一系列 transform 插件做语义转换和优化标记，generate 把处理后的 AST 生成 render 函数的代码字符串。parse 内部是一个逐段扫描的词法分析器，把标签、文本、插值、注释切成 token 再组装成节点树，节点类型由 NodeTypes 枚举定义，比如 ELEMENT、INTERPOLATION、DIRECTIVE。transform 是深度优先遍历，每个 transform 可以返回一个退出时的回调，它一方面把 v-if、v-for 这些语法糖改写成 IF、FOR 节点、把元素改成 VNODE_CALL，另一方面挂 patchFlag、做静态提升、收集 block，Vue3 的性能优化主要就来自这一步。generate 产出的是字符串，运行时编译时靠 new Function 把它构造成可执行函数，而在 vite 加 compiler-sfc 的构建时预编译场景下，产物直接是 import 了 vue 内部 helper 的 ESM 模块，运行时既不需要编译器也不需要 new Function。整体上编译属于提前编译的 AOT 转换，把工作从运行时挪到了编译期，这也是 runtime-only 包更小、启动更快的原因。
