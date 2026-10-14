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

创建的是一个**全新的 Vue 应用**，和当前页面的 app 是隔离的。它：
- 没有页面的 Pinia store
- 没有页面的 Vue Router
- 没有页面注册的全局组件、指令
- `inject()` 拿不到页面 provide 的东西

### render — 继承当前应用上下文

```typescript
const vnode = h(Component, { onResolve })
render(vnode, container)
```

直接在**当前应用的上下文**中渲染，所以：
- 能访问页面的 Pinia store
- 能使用 Vue Router
- 能拿到页面 provide 的值
- 能用全局注册的组件和指令

## 实际影响

假设页面这样：

```vue
<script setup>
// Page.vue
provide('theme', 'dark')

const store = useUserStore()
provide('userStore', store)
</script>
```

### 用 createApp 创建的弹窗

```typescript
// ❌ 拿不到
inject('theme')      // undefined
inject('userStore')  // undefined
useUserStore()       // 报错，没有注册 Pinia
```

### 用 render 创建的弹窗

```typescript
// ✅ 能拿到
inject('theme')      // 'dark'
inject('userStore')  // store 实例
useUserStore()       // 正常工作
```

## 总结

| | `createApp` | `render` |
|---|---|---|
| 应用实例 | 新建一个 | 复用当前页面的 |
| provide/inject | ❌ 隔离 | ✅ 共享 |
| Pinia store | ❌ 需重新注册 | ✅ 直接可用 |
| Vue Router | ❌ 需重新注册 | ✅ 直接可用 |
| 全局组件/指令 | ❌ 需重新注册 | ✅ 直接可用 |

**对于弹窗场景，`render` 更合适**，因为弹窗通常需要访问页面的状态和上下文。
