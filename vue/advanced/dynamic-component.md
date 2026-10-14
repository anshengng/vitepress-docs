# 动态组件

## `<component :is>` 基本用法

`<component>` 是模板层的内置标签，配合 `is` 属性在运行时决定渲染什么：

| is 的值类型 | 示例 | 渲染结果 |
|------------|------|---------|
| 组件定义（对象） | `:is="MyComp"`（import 的 SFC） | 组件 |
| 字符串标签名 | `:is="'section'"` | 原生元素 |
| 字符串组件名 | `:is="'MyComp'"`（已全局注册） | 组件 |
| 异步组件定义 | `:is="AsyncComp"` | 异步组件 |
| keep-alive 场景 | 外层包 `<KeepAlive>` | 缓存实例 |

```vue
<script setup>
import { shallowRef } from 'vue'
import TabA from './TabA.vue'
import TabB from './TabB.vue'

// 用 shallowRef 存组件定义：组件对象不应被深层响应式代理
const current = shallowRef(TabA)
</script>

<template>
  <button @click="current = TabA">A</button>
  <button @click="current = TabB">B</button>
  <component :is="current" />
</template>
```

要点：`is` 存的是**组件引用**时用 `shallowRef`，避免 Vue 把组件定义也做成深层响应式代理（组件对象上的 `render`、`setup` 不需要深层侦测，深层代理纯属额外开销）。

## 字符串 is 的运行时解析

当 `is` 是字符串，编译器会把它交给 `resolveDynamicComponent`：

```typescript
export function resolveDynamicComponent(component: unknown) {
  if (isString(component)) {
    // 字符串：先当成已注册组件名查找，找不到就原样返回
    return resolveAsset(COMPONENTS, component, false) || component
  }
  return component || NULL_DYNAMIC_COMPONENT
}
```

`resolveAsset` 的查找顺序：

```
'MyComp' 字符串
    ↓ 1. 组件自身 components 选项（局部注册）
    ↓ 2. 实例上下文链上的 components（app.component 全局注册）
    ↓ 3. 都没命中 → 原样返回 'MyComp'
    ↓ 最终被当作原生元素标签名处理，渲染成 <mycomp>
```

编译产物：

```typescript
// <component :is="current">
(_openBlock(), _createBlock(_resolveDynamicComponent(_ctx.current), null, null, 1024 /* DYNAMIC_SLOTS */))
```

所以 `:is="'section'"` 会被当原生元素 `<section>`；`:is="'MyComp'"` 若从未注册，就会被当成未知 HTML 标签渲染出 `<mycomp>`，这是常见踩坑。

## 源码角度：谁来决定 vnode 类型

`<component>` 与内置组件 Teleport、KeepAlive 类似，由编译器特殊处理：它把 `is` 的表达式包进 `resolveDynamicComponent`，把结果作为 vnode 的 `type`。真正决定"渲染元素还是组件"的是 `createVNode` 内部的 shapeFlag 判定：

```typescript
function createVNode(type: VNodeTypes) {
  let shapeFlag
  if (typeof type === 'string') {
    shapeFlag = ShapeFlags.ELEMENT            // 原生元素分支
  } else if (typeof type === 'object' && type !== null) {
    shapeFlag = type.__isSuspense ? ShapeFlags.SUSPENSE
      : type.__isTeleport ? ShapeFlags.TELEPORT
      : type.__isFragment ? ShapeFlags.FRAGMENT
      : ShapeFlags.STATEFUL_COMPONENT         // 组件分支
  } else if (typeof type === 'function') {
    shapeFlag = ShapeFlags.FUNCTIONAL_COMPONENT
  }
  // ...
  return { type, shapeFlag, /* ... */ }
}
```

```
is 值（已由 resolveDynamicComponent 解析）
    ↓
createVNode(type)
    ↓ 判断 typeof type
    ├── string            → ELEMENT 分支  → patchElement → 真实 DOM 元素
    └── object / function → COMPONENT 分支 → 实例化组件 → 挂载组件
```

这就是动态组件的本质：**它不预先固定 vnode 类型，而是运行时根据 `is` 的值走元素或组件两条渲染路径**，后续 patch 也按对应分支处理。

## 切换默认销毁重建

不套 `<KeepAlive>` 时，`is` 一变，新旧 vnode 的 `type` 不同，diff 会走"卸载旧的、挂载新的"路径：

```
切换前：<TabA> 实例
    ↓ current 变更触发重渲染
patch(oldVNode, newVNode)
    ↓ type 不同（TabA → TabB）
unmount(oldVNode)  → 触发 TabA 的 onUnmounted，状态丢失
mount(newVNode)    → 新建 TabB 实例，onMounted 重新执行
```

| 影响 | 说明 |
|------|------|
| 组件状态 | setup 中的 ref、data 全部重置 |
| 副作用 | onUnmounted / onMounted 反复触发，定时器与请求被重建 |
| 用户输入 | 表单内容、滚动位置丢失 |

## keep-alive 保留状态

```vue
<template>
  <KeepAlive>
    <component :is="current" />
  </KeepAlive>
</template>
```

`KeepAlive` 是一个抽象组件，它拦截内部 vnode 的卸载：

- 被缓存组件的实例不再真正销毁，而是移入缓存容器（触发 `deactivated` 而非 `unmounted`）。
- 再次切回时从缓存取出**同一个实例**复用，状态得以保留。
- 缓存 key 默认是组件类型（+ vnode 的 key）；给不同实例加 `:key` 可区分同一组件的多份实例。
- `<KeepAlive>` 只对有状态的**组件 vnode** 生效，对原生元素无效。

缓存过多会占内存，可用 `include` / `exclude`（按组件 `name`）和 `max` 限制：

```vue
<KeepAlive :max="5">
  <component :is="current" />
</KeepAlive>
```

生命周期对照：

| 场景 | 触发钩子 |
|------|---------|
| 首次挂载 | `onMounted` + `onActivated` |
| 切走（被缓存） | `onDeactivated`（不触发 onUnmounted） |
| 切回（命中缓存） | `onActivated` |
| 超出 max 被淘汰 | `onUnmounted` |

## 动态组件与 v-if 的取舍

| 维度 | `<component :is>` | `v-if` / `v-else-if` |
|------|-------------------|----------------------|
| 决策时机 | 运行时，值可来自数据 | 编译期固定分支 |
| 分支可配置 | 分支数量、内容可由配置驱动 | 分支写死在模板 |
| 状态保留 | 可配 KeepAlive | 切换同样销毁，也可配 KeepAlive |
| key | 需手动给 `:key` 区分 | 编译期自动生成分支 key |
| 适用 | 选项卡、步骤表单、插件式 UI | 少量固定分支、条件展示 |

编译差异上，`v-if` 会在编译期生成分支结构（`v-if` / `v-else` 各带自己的 key，整体包在 Fragment 里）；`<component :is>` 只有一条渲染路径，把"选择"推迟到运行时的 `resolveDynamicComponent`。

选择建议：分支**固定且少**，用 `v-if` 更直观；分支**数量或内容由数据驱动**（设备类型、插件、配置化面板），用 `<component :is>`。

## 异步组件作为 is 的值

`defineAsyncComponent` 返回一个组件定义对象，可直接作为 `is`：

```vue
<script setup>
import { defineAsyncComponent, shallowRef } from 'vue'

const AsyncPanel = defineAsyncComponent(() => import('./Panel.vue'))
const current = shallowRef(AsyncPanel)
</script>

<template>
  <component :is="current" />
</template>
```

要点：

- 异步组件本质是带 `__asyncLoader` 的组件定义，最终仍走 COMPONENT 分支。
- 加载期间需要占位：用 `defineAsyncComponent` 的 `loadingComponent` / `errorComponent`，或外层包 `<Suspense>`。
- `is` 在两个异步组件之间切换时，配合 `<Suspense>` 可统一处理 pending 状态。
- 与 `keep-alive` 组合时，缓存的是加载完成后的实例。

## 典型场景

### 选项卡

```vue
<script setup>
import { shallowRef } from 'vue'
import HomeTab from './HomeTab.vue'
import OrdersTab from './OrdersTab.vue'

const tabs = { home: HomeTab, orders: OrdersTab }
const active = shallowRef('home')
</script>

<template>
  <nav>
    <button
      v-for="(_, name) in tabs"
      :key="name"
      @click="active = name"
    >{{ name }}</button>
  </nav>

  <KeepAlive>
    <component :is="tabs[active]" />
  </KeepAlive>
</template>
```

用对象做"名字 → 组件"的映射，配合 KeepAlive 保留各 Tab 的状态。

### 多步骤表单

```vue
<script setup>
import { shallowRef, shallowReactive, computed } from 'vue'
import StepOne from './StepOne.vue'
import StepTwo from './StepTwo.vue'
import StepThree from './StepThree.vue'

const steps = [StepOne, StepTwo, StepThree]
const step = shallowRef(0)
const current = computed(() => steps[step.value])
// 步骤组件共享同一份表单数据，填写内容得以保留
const form = shallowReactive({ name: '', age: null })
</script>

<template>
  <component :is="current" :form="form" />
  <button :disabled="step === 0" @click="step--">上一步</button>
  <button :disabled="step === steps.length - 1" @click="step++">下一步</button>
</template>
```

注意两点：步骤组件共享同一个 `form` 对象可保留填写内容；若某步骤还需要保留各自的**布局状态**（滚动、局部展开），再叠加 KeepAlive，或用 `:key` 控制实例是否复用。

## 面试答法

`<component :is>` 是模板层的内置标签，`is` 可以是组件定义、已注册的组件名字符串，也可以是原生标签名字符串；编译器把 `is` 包进 `resolveDynamicComponent`，它先按名字在局部和全局注册表里查找组件，找不到就原样返回当原生标签处理。到了 `createVNode` 里，根据 `typeof type` 决定走 ELEMENT 还是 COMPONENT 分支，所以动态组件的本质是运行时才确定渲染元素还是组件。默认切换时新旧 vnode 类型不同会走卸载加挂载，旧实例的 onUnmounted 触发、setup 状态全部重置；要保留状态就用 `<KeepAlive>`，它把实例移入缓存容器，切走只触发 deactivated、切回复用同一实例，缓存 key 是组件类型加 vnode key，还能用 include/exclude 和 max 控制。和 `v-if` 的区别在于 `v-if` 是编译期固定分支、只能写死在模板，而 `<component :is>` 的分支可以由数据驱动，适合选项卡、多步骤表单、插件化 UI。异步组件用 `defineAsyncComponent` 返回的定义也能直接喂给 `is`，加载态靠 loadingComponent 或外层 Suspense 处理。
