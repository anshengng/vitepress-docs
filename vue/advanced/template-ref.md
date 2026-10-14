# 模板 ref 与组件实例访问

## 两个 ref 不要混为一谈

`ref` 这个词在 Vue 里承担两种完全不同的职责：

| 名称 | 写法 | 归属 | 拿到什么 |
|------|------|------|---------|
| 响应式 ref | `const n = ref(0)` | 响应式系统 | 一个带 `.value` 的包装容器 |
| 模板 ref | `<div ref="n">` | 渲染器 | 真实 DOM 或组件实例 |

两者只是名字撞了：响应式 ref 由 `ref()` API 创建，底层是 `RefImpl`，负责依赖收集与触发更新；模板 ref 是模板上的一个 `ref` 属性，由渲染器在挂载/更新时把 DOM 或组件实例赋值进去。理解了这层区别，"为什么模板里写了 `ref="foo"`、脚本里还要 `const foo = ref(null)`"就不难解释——脚本里的那个 `ref(null)` 只是充当**接收容器**，它本身仍是响应式数据，值会被渲染器改写成 DOM。

```
响应式 ref：  ref() → RefImpl → .value → 响应式数据（依赖收集）
模板 ref：    ref 属性 in vnode → 渲染器 patch 时 setRef → 写入容器
```

## 模板 ref 的三种写法

### 写法一：Vue 3.5 的 useTemplateRef（推荐）

```vue
<script setup lang="ts">
import { useTemplateRef, onMounted } from 'vue'

const inputRef = useTemplateRef<HTMLInputElement>('input')

onMounted(() => {
  inputRef.value?.focus()
})
</script>

<template>
  <input ref="input" />
</template>
```

`useTemplateRef('input')` 的参数就是模板里 `ref` 属性的字符串值，返回一个 `ShallowRef`。变量名与模板 ref 名解耦，可读性最好，也彻底避免"同名巧合"。

### 写法二：ref="" + 同名响应式变量

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'

const input = ref<HTMLInputElement | null>(null)

onMounted(() => input.value?.focus())
</script>

<template>
  <input ref="input" />
</template>
```

关键在"同名"：`<script setup>` 里声明的 `input` 会被编译进 setup 作用域，运行时 `setRef` 按名字在实例的 setup 绑定里找到这个 ref 并把值写进去。名字不一致（比如变量叫 `el`、模板写 `ref="input"`）就永远拿不到值。

### 写法三：函数式 ref

```vue
<script setup lang="ts">
import { ref } from 'vue'

const el = ref<HTMLInputElement | null>(null)

function setEl(value: Element | null) {
  el.value = value as HTMLInputElement | null
}
</script>

<template>
  <!-- 挂载/更新时收到元素或组件实例，卸载时收到 null -->
  <input :ref="setEl" />
</template>
```

函数 ref 的回调在元素挂载、更新时收到元素（或组件实例），**卸载时收到 `null`**。它适合需要自定义逻辑、或需要在 v-for 里精确区分每个元素引用的场景。

| 写法 | 参数来源 | 是否随重渲染重建函数 | 适用 |
|------|---------|------------------|------|
| `useTemplateRef` | 模板 ref 名字符串 | 否（每次返回同一 ref 对象） | 3.5+ 首选 |
| 同名响应式变量 | 依赖变量与模板名相同 | 否 | 传统写法，仍支持 |
| 函数 ref | 直接收到元素/实例 | 每次渲染生成新函数 | 条件收集、v-for 精确追踪 |

## 绑定到元素 vs 绑定到组件

`ref` 能挂两种目标，拿到的值完全不同：

```
<div ref="el">          →  ref.value === 原生 DOM 元素（如 HTMLDivElement）
<Child ref="child">     →  ref.value === 子组件实例的"公开代理"
```

绑到组件时拿到的不是裸实例，而是 `getComponentPublicInstance` 返回的代理：

```typescript
function getComponentPublicInstance(instance: ComponentInternalInstance) {
  if (instance.exposed) {
    // 通过 defineExpose 暴露后，返回只包含暴露项的代理
    return instance.exposeProxy ||
      (instance.exposeProxy = new Proxy(proxyRefs(markRaw(instance.exposed)), {
        get(target, key) { /* 读拦截：取暴露项 */ },
        has(target, key) { /* 用于 in 判断 */ }
      }))
  } else {
    // 未使用 <script setup>（如 Options API）时退回完整实例 proxy
    return instance.proxy
  }
}
```

两个结论直接对应面试常问点：

- 父组件通过 ref 只能访问子组件**愿意暴露的内容**，不是子组件的全部内部状态。
- `<script setup>` 的绑定默认是"关闭"的（不对外暴露），只有调用 `defineExpose` 之后父组件才拿得到。

## defineExpose

```vue
<!-- Child.vue -->
<script setup lang="ts">
import { ref } from 'vue'

const count = ref(0)
function reset() {
  count.value = 0
}

// 只暴露这两项，其余绑定对父组件不可见
defineExpose({ count, reset })
</script>
```

```vue
<!-- Parent.vue -->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Child from './Child.vue'

const child = ref<InstanceType<typeof Child> | null>(null)

onMounted(() => {
  console.log(child.value?.count)   // 0，已暴露
  child.value?.reset()              // 合法，已暴露
  // child.value?.privateState      // undefined：未暴露
})
</script>

<template>
  <Child ref="child" />
</template>
```

`defineExpose` 是编译宏，只能出现在 `<script setup>` 顶层，编译后等价于给实例设置 `exposed`。它正是上面 `getComponentPublicInstance` 走哪个分支的开关：有 `exposed` 就返回受控代理，没有就退回完整实例。

## 编译产物：ref 是 vnode 上的一个属性

```vue
<template>
  <input ref="input" />
</template>
```

```typescript
function render(_ctx, _cache) {
  return _createElementVNode("input", { ref: "input" }, null, 512 /* NEED_PATCH */)
}
```

`ref` 被编译成子节点的 `ref` 属性，并带上 `NEED_PATCH` 标记——运行时 patch 阶段通过 `setRef` 完成赋值。v-for 中的 ref 会额外附加 `ref_for: true`：

```typescript
function render(_ctx, _cache) {
  return (_openBlock(), _createElementBlock(_Fragment, null, _renderList(_ctx.items, (item) => {
    return _createElementVNode("li", { ref_for: true, ref: "itemRefs" }, null, 512)
  }), 256 /* UNKEYED_FRAGMENT */))
}
```

`ref_for: true` 告诉运行时要收集成数组，而不是只保留最后一个值。

## v-for 里的数组 ref

```vue
<script setup lang="ts">
import { ref } from 'vue'

const itemRefs = ref<HTMLLIElement[]>([])
</script>

<template>
  <ul>
    <li v-for="item in 3" :key="item" ref="itemRefs">{{ item }}</li>
  </ul>
</template>
```

要点：

- 同名 ref 出现在循环里多次 → 运行时把值累积成数组。
- **数组顺序不保证与源数组一致**（官方明确：ref 数组不保证与源数组相同顺序）。
- 变量必须显式初始化为数组 `ref([])`，否则渲染器按数组处理会出错。
- 需要与源数组精确对应时，改用函数 ref，把 key 与元素存进 Map，不依赖数组顺序。

## $refs 与 Options API

Options API 中，字符串模板 ref 会被收集到 `this.$refs`：

```javascript
export default {
  mounted() { this.$refs.input.focus() }   // $refs 里存着 DOM 或组件公开代理
}
```

`$refs` 是普通对象（非响应式），只在挂载后保证可用，不要把它当响应式数据来依赖。组合式 API 里对等的就是"同名变量"或 `useTemplateRef` 返回的 ref。

## ref 什么时候是空的

| 场景 | ref.value | 原因 |
|------|-----------|------|
| 挂载前 | null | 还没渲染，元素不存在 |
| `v-if` 为 false | null | 该分支未渲染，节点未创建 |
| `v-for` 数据为空 | [] 或 null | 循环体一个都没渲染 |
| 组件卸载后 | null | setRef 收到卸载，写回 null |

一个高频坑：**切换条件后立刻读 ref 是拿不到的**。因为 `v-if` 变 true 只是触发了数据更新，DOM 的创建被推进异步渲染队列：

```typescript
const show = ref(false)
const box = useTemplateRef<HTMLDivElement>('box')

async function toggle() {
  show.value = true
  // 此时 box.value 仍是 null，DOM 还没创建
  await nextTick()          // 等渲染队列刷新
  box.value?.scrollIntoView()
}
```

## 模板 ref 与 nextTick

要分清两件事：

- **ref 本身是在 patch 阶段被赋值的**，属于渲染过程的一部分，而渲染是异步批处理的 → 数据变更后 DOM 尚未生成时，ref 也就还没写入。
- **已挂载的元素，ref 指向的始终是同一个 DOM 对象**，不会因重渲染换成新对象，所以"已挂载后读 ref"通常不需要 nextTick。

| 需求 | 是否需要 nextTick |
|------|------------------|
| onMounted 里读已渲染元素 | 不需要（挂载已完成，ref 已写入） |
| 响应式变更引起尺寸/样式变化后读布局 | 需要（等 DOM 更新） |
| 条件渲染使元素从无到有 | 需要（等新节点创建） |
| 只读 ref 指向的元素本身（不关心新内容） | 不需要 |

`onMounted` 之所以能拿到 DOM，是因为钩子排在挂载完成之后；而"响应式变更引发的 DOM 更新"排在 `nextTick` 微任务里。两者时间点不同，不要混用。

## 面试答法

模板 ref 和响应式 ref 只是名字撞了：前者是模板上的 `ref` 属性，由渲染器在挂载和更新时把真实 DOM 或组件实例写给它；后者是 `ref()` 创建的响应式容器，脚本里那句 `const x = ref(null)` 只是当接收容器用。写模板 ref 有三种方式，3.5 的 `useTemplateRef` 最清晰，传统的是 `ref=""` 配合同名变量、名字必须一致运行时才能按名匹配，还有函数式 ref，挂载给元素、卸载收 null。绑到普通元素拿到真实 DOM，绑到组件拿到的是公开代理，`<script setup>` 的绑定默认不对外暴露，必须 `defineExpose` 才会出现在代理上，Options API 则收集在 `$refs`。ref 在挂载前、`v-if` 为假、`v-for` 无数据时都是空的，因为赋值发生在 patch 阶段而 patch 是异步批处理的，所以条件渲染后想马上读 ref 要先 `await nextTick`，但已挂载元素读 ref 本身并不需要。
