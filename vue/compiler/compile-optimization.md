# 编译优化：Vue3 为什么比 Vue2 快

## 核心思路

Vue2 的 diff 是运行时全量对比：不管节点会不会变，重渲染都要重新生成 VNode 并逐个比对。
Vue3 的思路是——**模板是静态可分析的，编译器在编译期就知道哪里会变**，把信息记录在产物里，运行时只处理"会变的部分"。

| 优化手段 | 解决的问题 |
|---------|-----------|
| PatchFlags | 运行时不知道该比哪里，只能全量 diff |
| 静态提升 hoistStatic | 静态 VNode 每次重渲染重复创建、重复比对 |
| cacheHandlers | 内联事件每次 render 生成新函数，引发子组件无意义更新 |
| Block Tree | 动态节点藏在深层，patch 需递归穿过所有静态层级 |

## 编译流程总览

```
template 字符串
    ↓ parse（baseParse，位于 @vue/compiler-core）
AST（抽象语法树：节点 + 指令 + 位置信息）
    ↓ transform（@vue/compiler-core）
优化 AST：标记 patchFlag、静态提升、事件缓存、收集 Block
    ↓ generate（@vue/compiler-core）
render 函数代码字符串 → new Function 构造为可执行函数
    ↓ 运行时执行
VNode 树（自带优化标记）
```

## PatchFlags：给动态节点打标

编译器分析每个节点"哪部分可能变化"，用位标记记录在 VNode 的 `patchFlag` 上：

| 枚举 | 值 | 含义 |
|------|-----|------|
| TEXT | 1 | 动态文本内容 |
| CLASS | 2 | 动态 class 绑定 |
| STYLE | 4 | 动态 style 绑定 |
| PROPS | 8 | 动态 props（配合 dynamicProps 数组列出具体 prop） |
| FULL_PROPS | 16 | 含动态 key（如 `v-bind="obj"`），需全量 diff props |
| STABLE_FRAGMENT | 64 | 子节点顺序不变的 fragment |
| KEYED_FRAGMENT | 128 | 带 key 的 fragment 子节点 |
| UNKEYED_FRAGMENT | 256 | 不带 key 的 fragment 子节点 |
| NEED_PATCH | 512 | 需 patch 但不必全量（如仅动态 ref） |
| DYNAMIC_SLOTS | 1024 | 动态插槽 |
| HOISTED | -1 | 静态提升节点，直接跳过 patch |
| BAIL | -2 | 退出优化模式，走全量 diff |

### 同一段模板的编译产物

```vue
<template>
  <div class="box">
    <h1>标题</h1>
    <p :class="cls">{{ message }}</p>
  </div>
</template>
```

编译产物（简化）：

```typescript
const _hoisted_1 = { class: "box" }
const _hoisted_2 = /*#__PURE__*/_createElementVNode("h1", null, "标题", -1 /* HOISTED */)

export function render(_ctx, _cache) {
  return (_openBlock(), _createElementBlock("div", _hoisted_1, [
    _hoisted_2,
    _createElementVNode("p", { class: _ctx.cls }, _toDisplayString(_ctx.message), 3 /* TEXT, CLASS */)
  ]))
}
```

`3 = TEXT(1) | CLASS(2)`：这个 p 节点只有文本和 class 可能变，其余部位运行时一概不比。

### 运行时按 flag 靶向 diff（patchElement 简化）

```typescript
function patchElement(n1, n2) {
  const el = (n2.el = n1.el)
  const patchFlag = n2.patchFlag

  // 只比对标记过的部位
  if (patchFlag & PatchFlags.CLASS) {
    if (n1.props.class !== n2.props.class) patchClass(el, n2.props.class)
  }
  if (patchFlag & PatchFlags.STYLE) { /* 同上，只比 style */ }
  if (patchFlag & PatchFlags.PROPS) {
    // 只遍历 dynamicProps 列出的几个 prop，不扫描整个 props
    for (const key of n2.dynamicProps) {
      patchProp(el, key, n1.props[key], n2.props[key])
    }
  }
  if (patchFlag & PatchFlags.TEXT) {
    if (n1.children !== n2.children) setText(el, n2.children)
  }
}
```

Vue2 的 patchElement 要遍历新旧 props 全量比对，children 也要全量 diff；Vue3 只比 flag 圈定的范围。

## 静态提升（hoistStatic）

纯静态节点在编译期被"提升"到 render 函数外面，变成模块级常量。

编译前（等价于无提升的手写 render）：

```typescript
export function render() {
  return h('div', { class: 'box' }, [
    h('h1', null, '标题'),               // 每次重渲染都重新创建 VNode
    h('p', { class: this.cls }, this.message)
  ])
}
```

提升后：

```typescript
// 模块加载时创建一次，之后所有重渲染复用同一个 VNode 对象
const _hoisted_2 = /*#__PURE__*/_createElementVNode("h1", null, "标题", -1 /* HOISTED */)

export function render(_ctx) {
  return (_openBlock(), _createElementBlock("div", null, [
    _hoisted_2,                          // 每次都是同一个引用
    _createElementVNode("p", { class: _ctx.cls }, _toDisplayString(_ctx.message), 3)
  ]))
}
```

两个收益：

1. 重渲染时不再为静态节点创建 VNode（省创建开销）
2. patch 开头 `if (n1 === n2) return`——新旧引用相同直接跳过（省比对开销），patchFlag = -1 即 HOISTED 标记

相邻的多个静态节点还会合并成一个静态 vnode 数组提升（`_hoisted_1 = [...]`），进一步减少产物体积。`/*#__PURE__*/` 注解帮助打包器做 tree-shaking 与压缩。

## cacheHandlers：内联事件缓存

```vue
<template>
  <button @click="count++">{{ count }}</button>
</template>
```

不加缓存时，每次 render 都会生成一个新的箭头函数作为 onClick → 传给子组件/子元素的 props 引用每次都变 → 无法通过引用比对跳过更新。

编译产物（cacheHandlers 默认开启）：

```typescript
export function render(_ctx, _cache) {
  return _createElementVNode("button", {
    onClick: _cache[0] || (_cache[0] = (...args) => _ctx.onClick && _ctx.onClick(...args))
  }, _toDisplayString(_ctx.count), 1 /* TEXT */)
}
```

第一次 render 把生成的函数存入 `_cache[0]`，之后每次 render 复用缓存引用。函数内部通过 `_ctx` 访问状态，`_ctx` 是同一个 Proxy，所以缓存不会导致闭包过期。

## Block Tree 与靶向更新

### 问题：动态节点藏在深层

```
div                          ← 根
└── section                  ← 静态
    ├── span                 ← 静态
    └── p {{ message }}      ← 动态文本

Vue2 patch：从根递归，穿过 section、span 才找到 p
```

### 解法：编译期收集动态节点

render 执行时：

```
_openBlock()                       → 开启收集（currentBlock = []）
  ...创建到带 patchFlag 的节点...   → push 进 currentBlock
_createElementBlock(...)           → 生成根 VNode，把 currentBlock 挂到 vnode.dynamicChildren
```

patch 阶段（简化）：

```typescript
function patchElement(n1, n2) {
  if (n2.dynamicChildren) {
    patchBlock(n1, n2)             // 只遍历收集好的动态节点
    return                         // 不再递归整棵子树
  }
  patchChildren(n1, n2)            // 退化路径：手写 render 等场景才全量 diff
}

function patchBlock(n1, n2) {
  for (let i = 0; i < n2.dynamicChildren.length; i++) {
    patch(n1.dynamicChildren[i], n2.dynamicChildren[i])
  }
}
```

静态层级全部被跳过：patch 成本只与**动态节点数量**相关，与树的规模无关。

### 结构不稳定的地方：开启新 Block

`v-if` / `v-for` 会让子结构不可预测，编译器的处理方式：

| 语法 | 处理 |
|------|------|
| v-if / v-else | 分支整体包在 Fragment Block 中，结构变化时整体替换 |
| v-for | 列表整体是一个 Fragment Block，内部动态节点收集到自己的 dynamicChildren |
| 稳定结构 | 动态节点一路向上收集到根 Block |

子 Block 自身作为一个动态节点挂在父 Block 的收集链上，更新时自上而下逐层靶向。

### 为什么模板语法约束使这成为可能

Block 机制依赖一个前提：**结构在编译期静态可预测**。模板是受限语法，DOM 结构只能被 v-if/v-for 这类已知指令改变，编译器能枚举出所有结构变化的边界并开出子 Block。而手写 render 函数是任意 JS，结构可以由任何逻辑决定，无法静态分析，只能退回全量 diff（BAIL）。这也是为什么这些优化都依赖编译器，脱离 template 直接写 render 拿不到。

## Vue2 vs Vue3 性能优化总结

| 对比项 | Vue2 | Vue3 |
|--------|------|------|
| 静态节点 | 重渲染仍重新创建 VNode 树 | 静态提升，VNode 只创建一次且跳过 patch |
| diff 粒度 | 新旧 VNode 全量递归比对 | PatchFlags 标记，只比变化部位 |
| 树遍历 | patch 递归整棵树 | Block Tree 收集动态节点，靶向更新 |
| 事件 props | 每次渲染生成新函数 | cacheHandlers 缓存引用 |
| 数据侦测 | defineProperty 初始化时全量递归 | Proxy 惰性代理，访问才深层转换 |

## 面试答法

Vue3 比 Vue2 快的核心是把优化从运行时挪到了编译时。第一，编译器给每个动态节点打 PatchFlags，运行时 diff 只比对被标记的部位，不再全量比对；第二，纯静态节点通过 hoistStatic 提升到 render 函数外，重渲染时复用同一个 VNode 引用，patch 直接跳过；第三，内联事件通过 cacheHandlers 缓存在 _cache 上，避免每次渲染生成新函数导致子组件无意义更新；第四，Block Tree 把动态节点收集到根节点的 dynamicChildren 数组，patch 时直接遍历这个数组做靶向更新，跳过所有静态层级，v-if/v-for 之外的结构必须静态可预测，这正是模板语法约束带来的可优化性。这些手段的共同前提是模板可被静态分析，所以手写 render 函数享受不到这些优化。
