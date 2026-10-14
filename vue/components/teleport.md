# Teleport 传送门

## 解决的问题

弹窗、Modal、Toast、下拉浮层这类组件，逻辑上归属于某个组件，但 DOM 上希望挂到 `<body>` 或应用根节点下，以摆脱父级样式的影响。

| 父级样式 | 对 fixed 弹层的破坏 |
|---------|-------------------|
| overflow: hidden / auto | 裁剪超出父边界的弹层 |
| transform / filter / perspective | 使 `position: fixed` 相对该元素而非视口定位 |
| z-index 与层叠上下文 | 弹层被夹在父级层叠上下文内，压不过其他元素 |
| 主题 / 字体继承 | 弹层被动继承父级样式 |

Teleport 让 DOM 结构脱离父级，但逻辑关系（组件树、事件、依赖注入）保持不变。

## 基本用法

```vue
<script setup>
import { ref } from 'vue'
const open = ref(false)
</script>

<template>
  <button @click="open = true">打开</button>
  <Teleport to="body">
    <div v-if="open" class="modal">弹窗内容</div>
  </Teleport>
</template>
```

| prop | 说明 |
|------|------|
| to | 目标容器，CSS 选择器字符串或真实 DOM 元素 |
| disabled | 为 true 时不做传送，正常渲染在原位置 |

```vue
<!-- 条件禁用：移动端不传送 -->
<Teleport to="body" :disabled="isMobile">
  <div class="drawer">...</div>
</Teleport>
```

多个 Teleport 可以指向同一目标，它们按挂载顺序依次插入；同一目标下的多个 Teleport 之间有先后顺序，卸载时只移除自己那部分 DOM。

```vue
<Teleport to="#modals"><DialogA /></Teleport>
<Teleport to="#modals"><DialogB /></Teleport>
```

## 实现原理

Teleport 是内置组件（`ShapeFlags.TELEPORT`），渲染器为它准备了两套「宿主」：

| 概念 | 含义 |
|------|------|
| 逻辑定位（vnode 树） | 仍在父组件的子树中，patch 沿组件树走 |
| 物理定位（真实 DOM） | 挂到 `to` 指定容器里的指定位置 |

```typescript
// runtime-core/src/components/Teleport.ts（简化）
export const TeleportImpl = {
  process(n1, n2, container, anchor, parentComponent, ...) {
    const target = resolveTarget(n2.props)        // 解析 to
    const targetAnchor = prepareTargetAnchor(target, n2)
    if (n1 == null) {
      mountTeleport(n2, container, parentComponent, ...)   // 首次挂载
    } else {
      updateTeleport(n1, n2, target, targetAnchor, ...)    // 更新：比较 props，必要时移动 DOM
    }
    // 关键：patch 子节点时把 container 换成 target，而不是父容器
    mountChildren(n2.children, target, targetAnchor, parentComponent, ...)
  }
}
```

挂载时做的事：

```text
处理 <Teleport to="body">
    │
    ├─ resolveTarget：document.querySelector('body') → target
    ├─ 在父容器里放一个空的占位锚点（记录原位置，便于后续移动）
    ├─ 把 children 的真实 DOM 直接插入 target 内部
    └─ 逻辑上 vnode 仍挂在父的 subTree 上
```

更新时若 `to` 改变或目标被替换，渲染器会移动已挂载的真实 DOM（复用 `move` 逻辑），而不是重新创建。因为子节点被直接放进目标容器，patch 子节点时传入的 `container` 是 target 而非父容器——这就是「物理位置改变」的直接体现。

## vnode 层级 vs 真实 DOM 层级

```text
组件树 / vnode 树（逻辑）              真实 DOM 树（物理）
App                                   body
└─ Component                          ├─ #app
   └─ Teleport  ──────────────┐       │   └─ ...（本地内容）
      └─ Modal 内容            │       └─ #modals
                              └─────────────►  Modal 内容渲染到这里
```

因为 `vnode.parent` 链仍指向 Teleport 所在的父组件，以下行为按组件树生效：

| 行为 | 是否按组件树 | 说明 |
|------|------------|------|
| provide / inject | 是 | inject 沿 vnode 树的 parent 查找，不受 DOM 位置影响 |
| 组件自定义事件 | 是 | 遵循组件父子关系 |
| 组件更新与卸载 | 是 | 父组件重渲染 / 卸载会带动 Teleport 内容 |
| `$parent` / 组件引用 | 是 | 逻辑父子关系不变 |

```vue
<!-- 父组件 provide，Teleport 里的 Modal 仍能 inject 到 -->
<script setup>
import { provide, ref } from 'vue'
const open = ref(true)
provide('modal', { close: () => (open.value = false) })
</script>

<template>
  <Teleport to="#modals">
    <Modal /><!-- Modal 内 inject('modal') 成功 -->
  </Teleport>
</template>
```

需要注意：DOM 上的原生事件（如 `@click`）仍遵循真实 DOM 的冒泡路径——若目标容器在 DOM 上不是原父元素的祖先，事件不会冒泡回原父元素上的监听器。而 Vue 的组件事件、依赖注入走 vnode 树，与 DOM 位置无关。

## SSR 场景

服务端渲染 / 注水（hydration）时：

| 事项 | 说明 |
|------|------|
| target 必须已存在 | 服务器上 `to` 指向的容器要在注水前就绪，否则无法定位挂载位置 |
| 首次注水要一致 | 客户端首次注水必须与服务器产物结构一致，避免 Teleport 内容位置错乱 |
| 目标不存在时 | 开发环境会告警（Invalid Teleport target），并跳过传送 |

```typescript
// 简化：目标解析失败时的处理
function resolveTarget(props) {
  const target = props.to
  if (isString(target)) {
    const targetEl = document.querySelector(target)
    if (!targetEl) {
      warn(`Invalid Teleport target: ${target}`)    // 目标不存在，告警
    }
    return targetEl
  }
  return target
}
```

若 `to` 的动态目标在服务端不可知，应保证两端一致；或对无法传送的内容采用 `disabled` 回退到原位置渲染，避免注水不匹配。

## 面试答法

Teleport 解决的是逻辑归属与 DOM 位置分离的问题：弹窗、Modal 这类组件希望在组件树上仍属于调用它的父组件，但真实 DOM 要挂到 body 之类的位置，以避免被父级的 overflow、transform、z-index 层叠上下文影响。它是内置组件，渲染时用 `resolveTarget` 解析 `to` 指向的容器，把子节点的真实 DOM 直接插进去，patch 子节点时传入的 container 就是目标容器而不是父容器，所以物理位置变了。但 vnode 树里的层级没变，`vnode.parent` 仍指向原父组件，因此 provide/inject、组件事件、父子更新与卸载都按组件树生效，只有原生 DOM 事件的冒泡走真实 DOM 路径。它还会记录占位锚点，以便 `to` 变化或 target 被替换时移动已挂载的 DOM；SSR 注水时两端的目标容器都必须存在，否则会告警并跳过传送。
