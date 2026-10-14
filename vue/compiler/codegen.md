# 代码生成：从 AST 到 render 函数

## generate 阶段在做什么

前面的 parse / transform 把模板字符串变成了优化过的 AST，generate 阶段负责把 AST 再"写回"成一段可执行的 JavaScript 源码。它本质上不是解释执行，而是**一个字符串拼接过程**：递归遍历 AST，一边遍历一边把对应的代码片段追加到上下文对象的 `code` 字段里。

```text
AST（已标记 patchFlag、静态提升、事件缓存）
    ↓ genNode / genElement 递归遍历
遍历到每个节点 → 生成对应代码片段
    ↓ context.push(...) 追加到缓冲区
context.code 字符串不断变长
    ↓ 收尾包装成函数骨架
完整 render 函数源码字符串
```

核心是 `CodegenContext`，它维护一个可变的代码缓冲区，并提供一组写入原语：

| 方法 / 字段 | 作用 |
|------------|------|
| `code` | 最终累积的代码字符串 |
| `push(code)` | 把一段代码片段追加到 `code` 末尾（可选带节点信息用于 source map） |
| `newline()` | 插入换行并按当前缩进层级补齐空格 |
| `indent()` / `deindent()` | 进入 / 退出一个缩进层级 |
| `helper(key)` | 登记运行时 helper，并返回它在产物里使用的变量名 |
| `pushScopeId` / `popScopeId` | 处理 scoped 样式需要注入的 DOM 属性 |

generate 的入口是 `generate()`，内部由 `genFunction` 生成函数骨架，由 `genNode` 作为递归分发器，把不同类型的节点交给对应的生成函数：

```text
genNode(node) 按 node.type 分派
├── ELEMENT / IF / FOR  → 递归进入 node.codegenNode（transform 阶段已生成的 VNodeCall）
├── VNODE_CALL          → genVNodeCall（产出 _createElementVNode / _createElementBlock 等调用）
├── TEXT                → genText
├── INTERPOLATION       → genInterpolation（包一层 _toDisplayString）
├── COMPOUND_EXPRESSION → genCompoundExpression（拼接多段文本 / 插值）
├── SIMPLE_EXPRESSION   → genExpression
├── COMMENT             → genComment
└── JS_* 系列           → 结构化 JS 片段
    ├── JS_CONDITIONAL_EXPRESSION → 条件三元表达式（v-if 产物）
    ├── JS_CALL_EXPRESSION        → 函数调用（如 _renderSlot）
    ├── JS_OBJECT_EXPRESSION      → 对象字面量（元素 props）
    ├── JS_ARRAY_EXPRESSION       → 数组字面量（插槽 / 参数列表）
    ├── JS_FUNCTION_EXPRESSION    → 函数表达式（事件回调、_renderList 回调）
    └── JS_CACHE_EXPRESSION       → _cache[...] 缓存（cacheHandlers）
```

遍历顺序决定了产物里代码片段的排列，`push` 与 `newline` 的组合让缩进和换行可控，最终输出一段格式接近手写的源码。

## 关键 helper

generate 不会把运行时逻辑内联进产物，而是收集所有需要的运行时函数，以 helper 的形式引用。这些 helper 全部来自 `@vue/runtime-core` / `@vue/runtime-dom`。

| helper | 含义 |
|--------|------|
| `_createElementVNode` | 创建普通元素 VNode |
| `_createElementBlock` | 创建"块"元素 VNode，同时收集动态子节点 |
| `_createBlock` | 创建带收集能力的块节点（常用于组件 / 动态结构根） |
| `_createTextVNode` | 创建文本 VNode（纯静态文本） |
| `_createCommentVNode` | 创建注释 VNode（v-if 占位等） |
| `_createVNode` | 创建组件 VNode 的底层函数 |
| `_toDisplayString` | 把插值结果转成可显示字符串（处理 null / 对象等） |
| `_openBlock` | 开启一次动态节点收集 |
| `_renderList` | 渲染 v-for 列表 |
| `_resolveComponent` | 按名字在上下文里解析组件 |
| `_resolveDirective` | 按名字在上下文里解析指令 |
| `_withModifiers` | 包装事件回调，内联常见修饰符（stop / prevent 等） |
| `_normalizeClass` | 归一化 class 绑定，统一字符串 / 数组 / 对象形态 |
| `_normalizeStyle` | 归一化 style 绑定 |
| `_mergeProps` | 合并 v-bind 的多段 props |
| `_createSlots` | 把动态插槽编译成插槽对象 |

这些名字在产物里统一带 `_` 前缀并做 alias，避免与用户代码里的同名标识符冲突。

## helper 从哪里来：两种编译模式

同一段模板，在不同编译模式下产物引用 helper 的方式不同：

| 模式 | 谁触发 | 引用方式 | 特点 |
|------|--------|---------|------|
| 构建时预编译 | `@vue/compiler-sfc`（Vite / webpack loader） | 文件顶部静态 `import { ... } from "vue"`，helper 名以 `_` 前缀并 alias，如 `import { createElementVNode as _createElementVNode } from "vue"` | 产物是标准 ES module，静态 import 可被 tree-shaking、可并行加载 |
| 运行时编译 | `@vue/runtime-dom` 的 `compile`（如 CDN 引入的完整版） | `compile()` 返回 `code` 字符串，用 `new Function("Vue", code)(runtimeDom)` 执行，Vue 对象作为参数传入；内部以 `const _createElementVNode = Vue.createElementVNode` 之类变量引用 helper | 适合 CDN 直接引入，但多一次编译开销，且难以静态优化 |

构建时预编译产物（module 模式）：

```typescript
import { createElementVNode as _createElementVNode, toDisplayString as _toDisplayString, openBlock as _openBlock, createElementBlock as _createElementBlock } from "vue"

export function render(_ctx, _cache) {
  return (_openBlock(), _createElementBlock("div", null, [
    _createElementVNode("p", null, _toDisplayString(_ctx.msg), 1 /* TEXT */)
  ]))
}
```

运行时编译产物（function 模式，简化）：

```javascript
const { createElementVNode: _createElementVNode, toDisplayString: _toDisplayString, openBlock: _openBlock, createElementBlock: _createElementBlock } = Vue

return function render(_ctx, _cache) {
  return (_openBlock(), _createElementBlock("div", null, [
    _createElementVNode("p", null, _toDisplayString(_ctx.msg), 1 /* TEXT */)
  ]))
}
```

运行时拿到这段 `code` 后，通过 `new Function("Vue", code)` 把完整的 runtime 对象喂进去，内部的 `Vue.createElementVNode` 等就取到了真实实现，产出的 `render` 函数挂到组件上使用。

## render 函数的结构

无论哪种模式，generate 最终产出的都是同一个形态的 render 函数：

```typescript
export function render(_ctx, _cache, $props, $setup, $data, $options) {
  return (_openBlock(), _createElementBlock("div", null, [
    /* ...子节点... */
  ]))
}
```

| 参数 | 含义 |
|------|------|
| `_ctx` | 渲染上下文。普通 `setup()` 场景指向暴露了 props / 状态的对象；`<script setup>` 场景可能直接是 setupState，或用 `$setup` 承载 |
| `_cache` | 用于 cacheHandlers 等缓存的数组，跨多次渲染复用 |
| `$props` | 组件 props（兼容 Options API 写法） |
| `$setup` | `setup()` / `<script setup>` 返回的状态 |
| `$data` | Options API 的 data |
| `$options` | 组件选项对象 |

模板里所有变量最终都通过 `_ctx`（或 `$setup`）显式访问，`_toDisplayString(_ctx.msg)` 就是一次具体读取。

## Vue3 为什么弃用 with

### Vue2 的产物形态

Vue2 编译出来的 render 函数把整段代码包在 `with` 里：

```javascript
with (this) { return _c('div', [_c('p', [_v(_s(msg))])]) }
```

`with` 把语句块的作用域指向组件实例（`this`），于是模板里写成 `{{ msg }}` 的变量可以直接裸写 `msg`，编译产物里就是 `_s(msg)`，不需要任何前缀。

### 弃用 with 的原因

| 原因 | 说明 |
|------|------|
| 性能 | `with` 会改变作用域链，块内所有标识符的解析都变成运行时逐级查找，JS 引擎无法做静态优化（不能内联、不能把属性访问编译成固定偏移），Vue2 渲染性能因此受限 |
| 严格模式不兼容 | 严格模式（ES module、class 内部等）里 `with` 直接抛 `SyntaxError`，无法作为标准模块产物 |
| 无法被工具链优化 | 带 `with` 的代码做 tree-shaking、压缩、静态分析都很困难，模块化构建不友好 |
| 作用域不清晰 | 块内标识符会被"吞"进实例作用域，容易与闭包变量、外层作用域冲突，可读性与可维护性差 |

### Vue3 的做法：`_ctx` 前缀

Vue3 彻底移除 `with`，模板里所有变量统一改写成显式前缀访问：

```vue
<template>
  <div>
    <p>{{ msg }}</p>
  </div>
</template>
```

```typescript
export function render(_ctx, _cache) {
  return (_openBlock(), _createElementBlock("div", null, [
    _createElementVNode("p", null, _toDisplayString(_ctx.msg), 1 /* TEXT */)
  ]))
}
```

这样带来几个好处：

1. **静态可分析**：每个标识符属于哪一层作用域一目了然，编译器能精确控制绑定关系、判断变量是 setup 状态还是 props。
2. **性能**：没有作用域链查找，`_ctx.msg` 变成一次固定的属性访问，引擎可以做内联与缓存。
3. **兼容严格模式**：产物是普通表达式，可以直接作为 ES module 输出。

运行时 `_ctx` 是一个 **Proxy**（渲染上下文代理），取值时通过 `ctx[key]` 统一代理到 setupState / data / props / attrs 等来源：

```typescript
const proxy = new Proxy(target, {
  get(target, key) {
    // 依次查 setupState、data、props、ctx（attrs 等），命中即返回
    if (key in setupState) return setupState[key]
    if (key in target) return target[key]
    return ctx[key]
  },
  has(target, key) {
    // 同时代理 has 陷阱，支持 `key in _ctx` 形式的判断
    return key in setupState || key in target || key in ctx
  }
})
```

这也让 `_ctx.xxx` 的读取不至于退化成普通对象的多次取值，仍然高效。

编译器层面，这套机制由 `prefixIdentifiers` 选项控制：

| 选项 | 行为 |
|------|------|
| `prefixIdentifiers: true`（默认） | 模板变量写成 `_ctx.xxx`，配合模块化产物，严格模式可用 |
| `prefixIdentifiers: false`（legacy） | 保留 `with` 包裹写法，仅为兼容旧构建 / 旧工具链保留 |

也就是说，`with` 模式依然存在于编译器里，只是默认关闭，普通项目永远走 `_ctx` 前缀这条路径。

## 完整对照：小模板 → render 产物

模板：

```vue
<template>
  <div class="box">
    <p>{{ msg }}</p>
    <button @click="count++">{{ count }}</button>
  </div>
</template>
```

构建时预编译产物（简化，略去 source map 与部分标记细节）：

```typescript
import { createElementVNode as _createElementVNode, toDisplayString as _toDisplayString, openBlock as _openBlock, createElementBlock as _createElementBlock } from "vue"

export function render(_ctx, _cache) {
  return (_openBlock(), _createElementBlock("div", { class: "box" }, [
    _createElementVNode("p", null, _toDisplayString(_ctx.msg), 1 /* TEXT */),
    _createElementVNode("button", {
      onClick: _cache[0] || (_cache[0] = $event => (_ctx.count++))
    }, _toDisplayString(_ctx.count), 1 /* TEXT */)
  ]))
}
```

对照可见：模板里的 `msg` / `count` 被统一改写成 `_ctx.msg` / `_ctx.count`；元素节点交给 `_createElementVNode` / `_createElementBlock`；文本插值交给 `_toDisplayString`；内联事件被 cacheHandlers 缓存进 `_cache[0]`；动态部位带上 `1 /* TEXT */` 的 PatchFlag。这正是 generate 阶段"边遍历边拼接"的最终结果。

## 面试答法

generate 的本质是一个字符串拼接过程，不是解释执行：它用 `genNode` / `genElement` 递归遍历已经优化好的 AST，一边遍历一边通过 `CodegenContext` 的 `push` / `newline` / `indent` 把代码片段写进 `code` 缓冲区，产物里所有运行时能力都以 `_` 前缀的 helper 形式引用，比如 `_createElementVNode`、`_toDisplayString`、`_openBlock`。这些 helper 的来源分两种模式：构建时预编译由 compiler-sfc 生成顶部 `import { ... } from "vue"`，运行时编译由 `compile` 返回 `code` 字符串再用 `new Function("Vue", code)(runtimeDom)` 执行。Vue3 相比 Vue2 最大的变化是弃用了 `with`：Vue2 用 `with(this)` 把作用域指向实例，模板变量可以裸写，但会破坏作用域链导致引擎无法静态优化、严格模式直接报 `SyntaxError`、产物也难以被 tree-shaking。Vue3 改为让所有变量显式走 `_ctx.xxx`，运行时 `_ctx` 是一个 Proxy，把访问统一代理到 setupState / data / props / attrs，既静态可分析又性能更好，`with` 模式只作为默认关闭的 legacy 选项保留。
