# 命令式组件调用（使用 render）

## 概念

使用 Vue 的 `render` 函数来动态创建组件，实现命令式调用。

## 完整实现

### 1. createDialog 工具函数

```typescript
// src/composables/createDialog.ts
import { h, render, type Component, type VNode } from 'vue'

interface DialogOptions {
  props?: Record<string, any>
  container?: HTMLElement
}

export function createDialog<T = any>(
  component: Component,
  options: DialogOptions = {}
): Promise<T> {
  const { props = {} } = options

  return new Promise((resolve, reject) => {
    // 创建容器
    const container = document.createElement('div')
    document.body.appendChild(container)

    // 存储 VNode 引用
    let vnode: VNode | null = null

    const cleanup = () => {
      // render(null) 会销毁之前的 VNode
      render(null, container)
      if (container.parentNode) {
        container.parentNode.removeChild(container)
      }
      vnode = null
    }

    // 创建虚拟节点并渲染
    vnode = h(component, {
      ...props,
      onResolve: (value: T) => {
        resolve(value)
        cleanup()
      },
      onCancel: () => {
        resolve(null as any)
        cleanup()
      }
    })

    // 挂载到容器
    render(vnode, container)
  })
}
```

### 2. 弹窗组件不变

```vue
<!-- src/components/FormModal.vue -->
<template>
  <Modal 
    :open="visible" 
    title="编辑"
    @cancel="handleCancel"
  >
    <Form :model="formData">
      <Form.Item label="姓名">
        <Input v-model:value="formData.name" />
      </Form.Item>
    </Form>

    <template #footer>
      <Button @click="handleCancel">取消</Button>
      <Button type="primary" @click="handleConfirm">确定</Button>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'

interface Emits {
  (e: 'resolve', value: { name: string }): void
  (e: 'cancel'): void
}

const emit = defineEmits<Emits>()

const visible = ref(true)
const formData = reactive({ name: '' })

const handleConfirm = () => {
  emit('resolve', { ...formData })
}

const handleCancel = () => {
  visible.value = false
  emit('cancel')
}
</script>
```

### 3. 页面使用

```vue
<script setup lang="ts">
import { createDialog } from '@/composables/createDialog'
import FormModal from '@/components/FormModal.vue'

const handleOpen = async () => {
  const result = await createDialog(FormModal, {
    props: { title: '编辑' }
  })
  
  console.log(result)
}
</script>
```

## createApp vs render 对比

### createApp — 独立的应用实例

```typescript
const app = createApp({ render() { return h(Component) } })
app.use(pinia)        // 需要重新注册插件
app.use(router)       // 需要重新注册插件
app.component('Xxx')  // 需要重新注册全局组件
app.mount(el)
```

创建的是一个**全新的 Vue 应用**，和当前页面的 app 完全隔离：没有页面的 Pinia store、没有页面的 Vue Router、没有页面注册的全局组件与指令，`inject()` 也拿不到页面 provide 的值。

### render — 直接渲染一个 VNode

```typescript
const vnode = h(Component, { onResolve })
render(vnode, container)
```

注意：`render()` 只是把一个 VNode 挂到容器上，**并不会继承调用处所在组件的应用上下文**。这个 VNode 自身不带 `appContext`，所以 `inject()` 同样返回 undefined，Pinia、Router 也不生效——它和 createApp 一样是"孤立"的。网上常说"用 render 就能继承页面上下文"，这是常见误解。

## 如何真正拿到页面上下文

要让命令式弹窗访问页面的状态与上下文，正确做法有两种：

### 方式 1：把弹窗放进页面组件树（推荐）

用状态驱动 + `<Teleport>`，弹窗节点挂在页面实例下，provide/inject、Pinia、Router 全部自然继承：

```vue
<template>
  <Button @click="visible = true">打开</Button>
  <Teleport to="body">
    <FormModal v-if="visible" @resolve="onResolve" @cancel="visible = false" />
  </Teleport>
</template>
```

### 方式 2：手动借用 appContext

在 `getCurrentInstance()` 可用的上下文里，把当前实例的 `appContext` 赋给 VNode，再交给 `render`：

```typescript
import { getCurrentInstance, h, render, type VNode } from 'vue'

const instance = getCurrentInstance()
const vnode = h(Component, { onResolve })
vnode.appContext = instance!.appContext   // 关键：借用页面 app 的上下文
render(vnode, container)
```

## 总结

| | `createApp` | `render`（不设 appContext） | `render` + 借用 appContext |
|---|---|---|---|
| 应用实例 | 新建一个 | 无（孤立 VNode） | 复用页面的 |
| provide/inject | 隔离 | 拿不到 | 共享 |
| Pinia store | 需重新注册 | 不可用 | 直接可用 |
| Vue Router | 需重新注册 | 不可用 | 直接可用 |
| 全局组件/指令 | 需重新注册 | 不可用 | 直接可用 |

结论：对于需要访问页面上下文的弹窗，优先用"页面内组件 + Teleport"的状态驱动方式；若一定要命令式调用，则必须手动把 `appContext` 挂到 VNode 上，单纯用 `render` 是拿不到页面上下文的。

## 面试答法

命令式弹窗（`createDialog` / `render`）的核心是把组件挂到一个临时容器上，从而脱离模板调用，但要特别注意上下文问题：`createApp` 会新建一个与页面隔离的应用，直接 `render(vnode, container)` 的 VNode 自身也不带 `appContext`，两者都拿不到页面的 provide/inject、Pinia、Router 和全局注册能力，网上"用 render 就能继承页面上下文"的说法并不成立。想复用页面上下文，推荐把弹窗放进页面组件树、用状态驱动加 `<Teleport>`；一定要命令式的话，则要在 `getCurrentInstance()` 可用的位置把当前实例的 `appContext` 赋给 VNode 再 `render`。理解"appContext 决定组件能访问哪些应用级能力"这一点，是回答这类问题的关键。
