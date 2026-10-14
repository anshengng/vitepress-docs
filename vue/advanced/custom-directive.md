# 自定义指令原理

## 指令的本质

指令是 `v-` 开头的特殊 attribute。它不是普通 prop，而是在**编译期被识别并保留为运行时指令**，最终不会以属性形式进 DOM，而是变成挂在 VNode 上的一组钩子。

```text
模板中出现 v-xxx
    ↓ 编译期识别（compiler-core 的 transform 阶段）
标记为指令节点：聚合到 vnode.dirs 上
    ↓ 运行时
渲染器在 patch 各阶段按需调用指令钩子
    ↓
直接操作真实 DOM
```

指令关注的是**对 DOM 的一次性/阶段性操作**，不参与组件的状态与模板渲染。

| 对比 | 指令 | 组件 |
|------|------|------|
| 关注点 | 直接操作 DOM | 状态 + 模板 |
| 复用粒度 | 一小段 DOM 行为 | 完整的视图单元 |
| 是否有状态 | 一般无内部状态 | 有 |
| 典型用途 | 聚焦、拖拽、懒加载 | 页面、列表、卡片 |

## 注册与使用

### 注册方式

| 方式 | 写法 | 作用域 |
|------|------|--------|
| 局部注册 | 组件 `directives` 选项 | 仅当前组件 |
| 全局注册 | `app.directive(name, def)` | 整个应用 |

```typescript
// 全局注册
app.directive('focus', {
  mounted(el) {
    el.focus()
  }
})

// 组件内局部注册（options API 写法）
export default {
  directives: {
    focus: { mounted(el) { el.focus() } }
  }
}
```

```vue
<!-- setup 里局部注册：以 v 前缀开头的变量会被识别为指令 -->
<script setup>
import { vFocus } from './directives/focus'
</script>
```

### 使用形式

| 形式 | 示例 | 说明 |
|------|------|------|
| 基础 | `v-focus` | 无值 |
| 带值 | `v-color="'red'"` | binding.value |
| 动态值 | `v-color="color"` | 值随状态变化 |
| 参数 | `v-demo:foo` | binding.arg = 'foo' |
| 修饰符 | `v-demo.foo.bar` | binding.modifiers = { foo: true, bar: true } |

```vue
<template>
  <input v-focus />
  <p v-color="'red'">红色文字</p>
  <div v-demo:pos.big="'x'">带参数与修饰符</div>
</template>
```

## 钩子函数

一个指令定义对象可以声明的完整钩子：

| 钩子 | 调用时机 | 对应组件生命周期 |
|------|---------|-----------------|
| created | 元素属性/事件绑定时（在 vnode 属性应用前） | 早于 beforeMount |
| beforeMount | 元素挂载到 DOM 前 | beforeMount |
| mounted | 元素已插入 DOM | mounted |
| beforeUpdate | 包含该元素的 vnode 更新前 | beforeUpdate |
| updated | 包含该元素的 vnode 更新后 | updated |
| beforeUnmount | 元素卸载前 | beforeUnmount |
| unmounted | 元素已卸载 | unmounted |

```typescript
const myDirective = {
  created(el, binding, vnode, prevVnode) {},
  beforeMount(el, binding) {},
  mounted(el, binding) {},
  beforeUpdate(el, binding, vnode, prevVnode) {},
  updated(el, binding, vnode, prevVnode) {},
  beforeUnmount(el, binding) {},
  unmounted(el, binding) {}
}
```

| 参数 | 含义 |
|------|------|
| el | 指令绑定的真实 DOM 元素 |
| binding | `{ value, oldValue, arg, modifiers, instance }` |
| vnode | 编译生成的 VNode |
| prevVnode | 更新前的 VNode（仅 beforeUpdate / updated） |

注意：除了 `el`，其余参数（binding / vnode）不应长期保留，因为它们可能被复用。

## 运行时实现

`withDirectives` 是编译产物到运行时指令的桥。编译期生成的 render 里，指令被包成 `withDirectives(vnode, [[指令, 值, 参数, 修饰符]])`：

```typescript
// 编译产物（简化）：v-color="'red'" 的等价 render
const _directive_color = _resolveDirective('color')

export function render(_ctx, _cache) {
  return _withDirectives(
    (_openBlock(), _createElementBlock('p', null, '红色文字')),
    [[_directive_color, 'red']]
  )
}
```

```text
withDirectives(vnode, dirs)
    ↓ 把每个指令与值归一化成 DirectiveBinding 结构
挂到 vnode.dirs 上
    ↓
渲染器 patch 各阶段读取 vnode.dirs，调用对应钩子
```

渲染器在各阶段的分发（简化）：

```typescript
// 元素挂载时
if (dirs) invokeDirectiveHook(vnode, null, 'created')
// ...挂载 DOM...
if (dirs) invokeDirectiveHook(vnode, null, 'mounted')

// 更新时
if (dirs) invokeDirectiveHook(n2, n1, 'beforeUpdate')
// ...patch 完成...
if (dirs) invokeDirectiveHook(n2, n1, 'updated')

// 卸载时
if (dirs) invokeDirectiveHook(vnode, null, 'beforeUnmount')
// ...移除 DOM...
if (dirs) invokeDirectiveHook(vnode, null, 'unmounted')
```

其中 `beforeUpdate` / `updated` 只在值或参数变化、或元素本身需要更新时才触发，且会带上 `binding.oldValue`。与编译产物相关的更细分析可参见 `compiler/directive-compile.md` 的 `withDirectives` 部分。

## 常见指令示例

### v-focus：自动聚焦

```typescript
export const vFocus = {
  mounted(el: HTMLElement) {
    el.focus()
  }
}
```

### v-copy：点击复制

```typescript
export const vCopy = {
  mounted(el: HTMLElement, binding: { value: string }) {
    el.addEventListener('click', () => {
      navigator.clipboard.writeText(binding.value)
    })
  }
}
```

### v-lazy：图片懒加载（IntersectionObserver）

```typescript
export const vLazy = {
  mounted(el: HTMLImageElement, binding: { value: string }) {
    // 观察元素是否进入视口，进入后再赋值 src
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (entry.isIntersecting) {
        el.src = binding.value
        observer.disconnect()   // 加载后停止观察
      }
    })
    observer.observe(el)
    // 指令实例上存一份，便于卸载时清理
    ;(el as any)._observer = observer
  },
  unmounted(el: HTMLImageElement) {
    (el as any)._observer?.disconnect()
  }
}
```

## 与组件的分工

选择原则：

```text
只是对某个 DOM 做一次性/阶段性操作     → 自定义指令
需要状态、需要模板、需要插槽/事件与复用 → 组件
```

| 判断维度 | 用指令 | 用组件 |
|---------|-------|-------|
| 有没有内部状态 | 无 | 有 |
| 是否需要渲染结构 | 否，作用于已有元素 | 是 |
| 复用方式 | 挂在元素上 | 放入模板 |
| 典型例子 | focus / 拖拽 / 水印 | 弹窗 / 表格 / 上传 |

## 面试答法

自定义指令本质是 v- 开头的特殊 attribute，编译期被识别并保留成运行时指令，不会作为普通属性进 DOM，而是通过 withDirectives 把指令和值归一化成绑定结构挂到 vnode 的 dirs 上，渲染器在挂载、更新、卸载各个阶段读取 dirs 并调用对应钩子来直接操作真实元素。它可以在组件的 directives 选项里局部注册，也可以用 app.directive 全局注册，使用时有值、参数和修饰符三种形态，分别落在 binding 的 value、arg 和 modifiers 上。钩子完整包含 created、beforeMount、mounted、beforeUpdate、updated、beforeUnmount、unmounted，基本和组件的生命周期一一对应，参数里最常见的是 el 和 binding，binding 带 value、oldValue、arg、modifiers，需要注意的是除了 el，其它参数都不应长期保留。常见用途是自动聚焦、复制文本、用 IntersectionObserver 做图片懒加载这类纯 DOM 操作，而判断用指令还是组件的分界线就是：只做一次性 DOM 操作用指令，需要状态和模板结构就用组件。
