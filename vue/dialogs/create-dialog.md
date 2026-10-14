# createDialog 工厂函数

## 问题

使用 `useDialog` 需要在每个页面的模板中预埋组件，这很麻烦。

```vue
<!-- 每个页面都要这样 -->
<template>
  <DialogA />
  <DialogB />
</template>
```

## 解决方案

使用 `createDialog` 工厂函数，支持**命令式调用**：

```typescript
// 直接调用，无需预埋组件
const result = await createDialog(FormModal, { title: '编辑' })
```

## 完整实现

### 1. createDialog 工具函数

```typescript
// src/composables/createDialog.ts
import { createApp, h, type Component, type App } from 'vue'

interface DialogOptions<T> {
  onResolve: (value: T) => void
  onCancel?: () => void
}

export function createDialog<T = any>(
  component: Component,
  props?: Record<string, any>
): Promise<T> {
  return new Promise((resolve, reject) => {
    // 创建容器
    const container = document.createElement('div')
    document.body.appendChild(container)

    // 存储 app 实例，用于清理
    let app: App | null = null

    const cleanup = () => {
      if (app) {
        app.unmount()
        app = null
      }
      if (container.parentNode) {
        container.parentNode.removeChild(container)
      }
    }

    // 创建 Vue 应用
    app = createApp({
      setup() {
        return () =>
          h(component, {
            ...props,
            // 组件内部调用 emit('resolve', data) 来关闭
            onResolve: (value: T) => {
              resolve(value)
              cleanup()
            },
            // 组件内部调用 emit('cancel') 来取消
            onCancel: () => {
              resolve(null as any) // 或 reject(new Error('cancelled'))
              cleanup()
            }
          })
      }
    })

    app.mount(container)
  })
}
```

### 2. 弹窗组件示例

```vue
<!-- src/components/FormModal.vue -->
<template>
  <Modal 
    :open="visible" 
    title="标题"
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

interface Props {
  title?: string
}

interface Emits {
  (e: 'resolve', value: { name: string }): void
  (e: 'cancel'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const visible = ref(true)
const formData = reactive({ name: '' })

const handleConfirm = () => {
  // 可以在这里做表单验证、提交接口等
  emit('resolve', { ...formData })
}

const handleCancel = () => {
  visible.value = false
  emit('cancel')
}
</script>
```

### 3. 页面中使用

```vue
<!-- src/views/Page.vue -->
<template>
  <Button @click="handleOpen">打开弹窗</Button>
</template>

<script setup lang="ts">
import { createDialog } from '@/composables/createDialog'
import FormModal from '@/components/FormModal.vue'

const handleOpen = async () => {
  // 直接调用，无需预埋组件
  const result = await createDialog<{ name: string }>(FormModal, {
    title: '编辑用户'
  })

  // result 就是 emit('resolve') 传递的值
  console.log('用户填写:', result?.name)

  if (!result) {
    console.log('用户取消了')
    return
  }

  // 可以继续 await 下一个弹窗
  const result2 = await createDialog(ConfirmModal, {
    content: `确定要保存 ${result.name} 吗?`
  })

  // ...
}
</script>
```

### 4. 封装常用弹窗（可选）

```typescript
// src/dialogs/index.ts
import { createDialog } from '@/composables/createDialog'
import FormModal from '@/components/FormModal.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'

export const dialogs = {
  // 表单弹窗
  form: <T = any>(props?: Record<string, any>) => 
    createDialog<T>(FormModal, props),

  // 确认弹窗
  confirm: (content: string) => 
    createDialog<boolean>(ConfirmModal, { content }),

  // 业务弹窗
  userForm: () => 
    createDialog<{ id: string; name: string }>(UserFormModal),

  orderDetail: (orderId: string) =>
    createDialog<OrderDetail>(OrderDetailModal, { orderId }),
}
```

### 5. 使用封装后的方法

```vue
<script setup lang="ts">
import { dialogs } from '@/dialogs'

const handleCreate = async () => {
  // 一行代码打开弹窗，等待结果
  const user = await dialogs.userForm()
  
  if (!user) return
  
  const confirmed = await dialogs.confirm(`确定要创建 ${user.name} 吗?`)
  
  if (!confirmed) return
  
  // 继续下一步...
}
</script>
```

## 对比

| 方式 | 优点 | 缺点 |
|------|------|------|
| 预埋组件 + `useDialog` | 组件模板可见，方便调试 | 每个页面都要放组件，管理 ID |
| `createDialog` 工厂 | 一行代码调用，无需预埋 | 组件动态创建，调试稍麻烦 |

**推荐**：使用 `createDialog` 方式更干净，特别是弹窗多、业务逻辑复杂的时候。

## 面试答法

`createDialog` 工厂函数把弹窗包装成一次返回 Promise 的命令式调用：调用时新建一个容器 `div` 挂到 `body`，用 `createApp` 生成一个独立应用挂载弹窗组件，组件通过 `emit('resolve')` / `emit('cancel')` 把结果回传，回调里完成 Promise 的 resolve，随后 `unmount()` 应用并移除容器。这样调用方能像同步一样 `await createDialog(...)`，还能把多个弹窗串成一条链，无需在页面模板预埋组件、也无需手动管理 visible 状态。代价是它用 `createApp` 创建的是独立应用，与页面 app 隔离，拿不到页面的 Pinia / Router / 全局注册能力，需要这些上下文时应改用页面内 `<Teleport>` 的状态驱动方式，或在 `h()` 后手动把 `appContext` 挂到 VNode 上。和 `useDialog`（预埋组件方案）相比，工厂方式调用更干净，适合弹窗多、流程复杂的场景。
