# Promise 弹窗方案

## 问题背景

在 Vue3 项目中，如果有多个弹窗串联使用，传统的管理方式很麻烦：

```vue
<!-- 传统方式 -->
弹窗A → 关闭A → 打开B → 关闭B
```

需要手动管理每个弹窗的 `visible` 状态和数据。

## 解决方案

把弹窗封装成 **Promise-based** 的调用方式：

```typescript
// 目标用法
await openA()
await openB()
```

这样 A 处理完 resolve 后自动打开 B，不需要手动管理状态。

## 完整实现

### 1. 创建 useDialog composable

```typescript
// src/composables/useDialog.ts
import { ref, readonly } from 'vue'

interface DialogState<T> {
  visible: boolean
  loading: boolean
  data?: T
}

// 全局存储 dialog 状态
const dialogs = ref<Record<string, DialogState<any>>>({})

let resolveFn: ((value: any) => void) | null = null

export function useDialog<T>(dialogId: string) {
  // 初始化 dialog 状态
  if (!dialogs.value[dialogId]) {
    dialogs.value[dialogId] = {
      visible: false,
      loading: false
    }
  }

  const state = readonly(dialogs.value[dialogId])

  // 打开弹窗并返回 Promise
  const open = (): Promise<T> => {
    return new Promise((resolve) => {
      resolveFn = resolve
      dialogs.value[dialogId].visible = true
    })
  }

  // 确认（关闭并 resolve）
  const confirm = (result: T) => {
    dialogs.value[dialogId].visible = false
    resolveFn?.(result)
    resolveFn = null
  }

  // 取消（关闭并 reject）
  const cancel = () => {
    dialogs.value[dialogId].visible = false
    resolveFn?.(null)
    resolveFn = null
  }

  return { state, open, confirm, cancel }
}
```

### 2. 封装弹窗组件

```vue
<!-- src/components/DialogA.vue -->
<template>
  <Modal v-model:open="state.visible" @cancel="cancel">
    <Form :model="formData">
      <Form.Item label="姓名">
        <Input v-model:value="formData.name" />
      </Form.Item>
    </Form>
    <template #footer>
      <Button @click="cancel">取消</Button>
      <Button type="primary" @click="handleSubmit">确定</Button>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import { useDialog } from '@/composables/useDialog'

const { state, confirm, cancel } = useDialog<{ name: string }>('dialogA')

const formData = reactive({ name: '' })

const handleSubmit = async () => {
  // 这里可以做表单验证、提交接口等
  // await api.submit(formData)
  confirm(formData) // 关闭弹窗并返回数据
}
</script>
```

### 3. 页面中使用

```vue
<!-- src/views/MyPage.vue -->
<template>
  <Button @click="handleOpen">打开弹窗流程</Button>
  
  <!-- 放在全局或页面中 -->
  <DialogA />
  <DialogB />
</template>

<script setup lang="ts">
import { useDialog } from '@/composables/useDialog'

const dialogA = useDialog<{ name: string }>('dialogA')
const dialogB = useDialog<{ id: string }>('dialogB')

const handleOpen = async () => {
  // await 弹窗 A，拿到结果
  const resultA = await dialogA.open()
  console.log('弹窗A的结果:', resultA.name)

  // A 关闭后，紧接着打开 B
  const resultB = await dialogB.open()
  console.log('弹窗B的结果:', resultB.id)

  // 所有弹窗完成后执行后续逻辑
  // await api.submit({ ...resultA, ...resultB })
}
</script>
```

### 4. 可选增强：支持 loading 状态

```typescript
const { state, confirm, cancel } = useDialog<SubmitResult>('dialogA')

const handleSubmit = async () => {
  try {
    // 设置 loading
    dialogs.value['dialogA'].loading = true
    const result = await api.submit(formData)
    confirm(result)
  } finally {
    dialogs.value['dialogA'].loading = false
  }
}
```

## 优点

- ✅ 代码像同步一样写，`await openA()` → `await openB()`
- ✅ 不需要手动管理 `visible`、`formData` 等状态
- ✅ 弹窗之间数据可以串联传递
- ✅ 类型安全（TypeScript）

## dialogId 管理

### 方式 1：导出常量（推荐）

```typescript
// src/composables/dialogIds.ts
export const DIALOG_IDS = {
  USER_FORM: 'userForm',
  ORDER_DETAIL: 'orderDetail',
} as const
```

### 方式 2：集中管理（最推荐）

```typescript
// src/dialogs/index.ts
import { createDialogController } from '@/composables/useDialog'

// 集中定义所有 dialog
export const dialogs = {
  userForm: createDialogController<UserFormResult>('userForm'),
  orderDetail: createDialogController<OrderDetail>('orderDetail'),
}
```

## 原理解析

`dialogs` 是一个全局的 `ref`，不管在哪个组件中调用 `useDialog('dialogA')`，访问的都是同一个对象：

```typescript
// 全局存储
const dialogs = ref<Record<string, DialogState<any>>>({})

// 多处调用 useDialog('dialogA') → 都会访问 dialogs.value['dialogA']
```

这就是 Vue 的响应式系统的特性——同一份数据源可以被多处访问和修改。
