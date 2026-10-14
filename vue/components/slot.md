# 插槽原理

## 三种插槽

| 类型 | 写法 | 数据流 |
|------|------|--------|
| 默认插槽 | 子 `<slot />` / `<slot>备用内容</slot>` | 父提供内容，子决定渲染位置 |
| 具名插槽 | 父 `#header`，子 `<slot name="header" />` | 按 name 对号入座 |
| 作用域插槽 | 子 `<slot :row="row" />`，父 `#default="{ row }"` | 子把数据回传给父写的内容 |

作用域插槽是唯一能做到「内容由父写、数据由子给」的机制，表格、列表、下拉项的定制渲染都靠它。

## 编译产物

### 子组件：`<slot>` 编译成 _renderSlot

```vue
<template>
  <div class="card">
    <slot name="header" :title="title" />
    <slot />
  </div>
</template>
```

```typescript
// 子组件编译产物（简化）
export function render(_ctx, _cache) {
  return (_openBlock(), _createElementBlock("div", { class: "card" }, [
    _renderSlot(_ctx.$slots, "header", { title: _ctx.title }),
    _renderSlot(_ctx.$slots, "default")
  ]))
}
```

### 父组件：传入内容编译成 children 对象

```vue
<Card>
  <template #header="{ title }">
    <h1>{{ title }}</h1>
  </template>
  <p>正文</p>
</Card>
```

```typescript
// 父组件编译产物（简化）
export function render(_ctx, _cache) {
  return _createBlock(Card, null, {
    // 具名插槽 → 对象形式的 children，每个值是「返回 vnode 数组」的函数
    header: _withCtx(({ title }) => [
      _createElementVNode("h1", null, _toDisplayString(title), 1 /* TEXT */)
    ]),
    // 默认插槽也进对象，key 为 default
    default: _withCtx(() => [
      _createElementVNode("p", null, "正文")
    ]),
    _: 1 /* 标记 children 是稳定的插槽对象，便于运行时跳过归一化 */
  })
}
```

两类 children 的区别：

```text
普通 children                     插槽 children
[p1, p2]                          { default: fn, header: fn, _: 1 }
数组，vnode 在父渲染时就已生成      对象，每个值是「接受 props、返回 vnode 数组的函数」
```

## slots 的存储形态

实例上的 `slots` 就是这个对象。`initSlots` 会在 patch 子组件时，把 vnode.children 拷到 `instance.slots`，并对函数做归一化；`$slots` 是它的对外代理。

```typescript
// runtime-core/src/componentSlots.ts
export const initSlots = (instance, children, optimized) => {
  if (instance.vnode.shapeFlag & ShapeFlags.SLOTS_CHILDREN) {
    // children 形如 { default: fn, header: fn, _: 1 }
    if (optimized) {
      instance.slots = children as InternalSlots        // 编译优化过，直接复用
      Object.defineProperty(children, '_', { enumerable: false, value: 1 })
    } else {
      normalizeObjectSlots(children, (instance.slots = {}))
    }
  } else {
    instance.slots = {}
  }
}

function normalizeObjectSlots(rawSlots, slots) {
  for (const key in rawSlots) {
    const value = rawSlots[key]
    if (isFunction(value)) {
      // 归一化后每个 slot 都是「接受 props、返回 vnode 数组」的函数
      slots[key] = (props) => normalizeSlotValue(value(props))
    }
  }
}
```

`_renderSlot` 只是「取出 slot 函数并调用」：

```typescript
// runtime-core/src/helpers/renderSlot.ts（简化）
export function renderSlot(slots, name, props = {}, fallback) {
  const slot = slots[name]
  if (slot) {
    const rendered = slot(props)        // 调用父传下来的函数，把子的数据当参数
    return createVNode(Fragment, null, rendered, PatchFlags.STABLE_FRAGMENT)
  }
  return fallback ? fallback() : createVNode(Comment)
}
```

## 为什么作用域插槽本质是「函数」

```text
父组件编译期：
    props(子的数据) => [vnode, vnode, ...]      ← 生成「数据入、vnode 出」的函数
子组件运行期：
    _renderSlot → slot(childProps) → vnode[]     ← 用子组件当前数据调用它
```

也就是说：渲染归属仍在父组件——vnode 由父的渲染函数产生，遵循父的数据与依赖追踪；但**调用**发生在子组件渲染到 `<slot>` 时，参数是子组件提供的数据。这正是作用域插槽能做到「内容由父写、数据由子给」的原因，也是它天然保持父子各自响应式的原因。

## $slots 与 $scopedSlots

| 版本 | 形态 |
|------|------|
| Vue2 | `this.$slots`（普通插槽）与 `this.$scopedSlots`（作用域插槽）分开 |
| Vue3 | 统一为 `this.$slots`，普通插槽的每个 key 也是函数，不再单列 $scopedSlots |

在 Vue3 里 `$slots.default` 就是一个函数，具名插槽同理，所以模板里 `<slot>` 的工作方式已经完全统一。手写 render 时可以直接调用 `slots.default?.()`。

## 动态插槽名

```vue
<template>
  <Card>
    <template #[dynamicName]="slotProps">
      {{ slotProps.text }}
    </template>
  </Card>
</template>
```

动态插槽名在编译期生成运行时 key，产物形如：

```typescript
_createBlock(Card, null, {
  [dynamicName]: _withCtx((slotProps) => [...], ...),
  _: 1
})
```

因为 key 要到运行期才知道，编译器会给这个 block 打上 `DYNAMIC_SLOTS`(1024) 标记，更新时对 slots 做全量 diff。

## 渲染时机

```text
父 render：生成插槽对象 { default: fn }，随 vnode.children 传到子
    ↓ patch 遇到子组件
子 initSlots：把插槽对象挂到 instance.slots / $slots
    ↓
子 render：执行到 _renderSlot
    ↓
    slot(props)      ← 此时才真正调用父提供的函数，产生 vnode
    ↓
    生成的 vnode 作为子的子节点继续 patch
```

关键结论：插槽内容不是父渲染时立即生成，而是**延迟到子组件渲染到 `<slot>` 位置时才调用函数生成**。普通 children 是父渲染时就已生成的现成 vnode；插槽是「待调用的函数」，这也是它比普通 children 更灵活、天然响应式的原因。

## 面试答法

插槽本质是把 Vue2 分开的普通插槽和作用域插槽统一成了函数：父组件编译时把插槽内容编译进 children 对象，每个 key（default 或具名）对应一个返回 vnode 数组的函数，子组件用 `_renderSlot` 在渲染到 `<slot>` 时才调用它。因为调用发生在子组件渲染期、参数由子组件提供，所以作用域插槽能做到内容由父写、数据由子给，同时保持各自的响应式——这正是它区别于普通 children（父渲染时就生成的现成 vnode）的关键。实例上的 `$slots` 就是这个对象，`initSlots` 会在 patch 子组件时把它挂到 `instance.slots`，Vue3 不再有独立的 `$scopedSlots`。动态插槽名的 key 要到运行期才知道，编译器会打 `DYNAMIC_SLOTS` 标记、更新时走全量 diff。
