# 函数式组件

## 概念

实现一个类似 `ElMessage` 的函数式调用组件。

## 完整实现

### 1. Message 组件

```vue
<!-- src/components/Message.vue -->
<template>
  <Transition name="message-fade">
    <div v-show="visible" :class="['message', `message--${type}`]">
      <span class="message__content">{{ message }}</span>
      <span v-if="showClose" class="message__close" @click="close">×</span>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

interface Props {
  type?: 'success' | 'warning' | 'error' | 'info'
  message?: string
  duration?: number
  showClose?: boolean
  onClose?: () => void
}

const props = withDefaults(defineProps<Props>(), {
  type: 'info',
  duration: 3000,
  showClose: false
})

const visible = ref(false)

let timer: ReturnType<typeof setTimeout>

const startTimer = () => {
  if (props.duration > 0) {
    timer = setTimeout(() => {
      close()
    }, props.duration)
  }
}

const close = () => {
  visible.value = false
  setTimeout(() => {
    props.onClose?.()
  }, 300) // 等动画结束
}

onMounted(() => {
  visible.value = true
  startTimer()
})

onUnmounted(() => {
  clearTimeout(timer)
})
</script>

<style scoped>
.message {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 20px;
  border-radius: 4px;
  z-index: 10000;
  display: flex;
  align-items: center;
  gap: 10px;
}

.message--success {
  background: #f0f9eb;
  color: #67c23a;
  border: 1px solid #e1f3d8;
}

.message--warning {
  background: #fdf6ec;
  color: #e6a23c;
  border: 1px solid #faecd8;
}

.message--error {
  background: #fef0f0;
  color: #f56c6c;
  border: 1px solid #fde2e2;
}

.message--info {
  background: #f4f4f5;
  color: #909399;
  border: 1px solid #e9e9eb;
}

.message__close {
  cursor: pointer;
  font-size: 16px;
}

.message-fade-enter-active,
.message-fade-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}

.message-fade-enter-from,
.message-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-20px);
}
</style>
```

### 2. createMessage 工厂函数

```typescript
// src/composables/createMessage.ts
import { h, render, type VNode } from 'vue'
import Message from '@/components/Message.vue'

type MessageType = 'success' | 'warning' | 'error' | 'info'

interface MessageOptions {
  type?: MessageType
  message?: string
  duration?: number
  showClose?: boolean
}

// 存储所有 message 实例，用于管理堆叠
const instances: VNode[] = []

export function createMessage(options: MessageOptions = {}) {
  const { type = 'info', message = '', duration = 3000, showClose = false } = options

  // 创建容器
  const container = document.createElement('div')
  document.body.appendChild(container)

  // 清理函数
  const cleanup = () => {
    render(null, container)
    if (container.parentNode) {
      container.parentNode.removeChild(container)
    }
    // 从 instances 中移除
    const idx = instances.indexOf(vnode)
    if (idx > -1) instances.splice(idx, 1)
  }

  // 创建 VNode
  const vnode = h(Message, {
    type,
    message,
    duration,
    showClose,
    onClose: cleanup
  })

  // 存储并渲染
  instances.push(vnode)
  render(vnode, container)

  return { close: cleanup }
}

// 便捷方法
export const message = {
  success: (msg: string, duration?: number) => 
    createMessage({ type: 'success', message: msg, duration }),
  
  warning: (msg: string, duration?: number) => 
    createMessage({ type: 'warning', message: msg, duration }),
  
  error: (msg: string, duration?: number) => 
    createMessage({ type: 'error', message: msg, duration }),
  
  info: (msg: string, duration?: number) => 
    createMessage({ type: 'info', message: msg, duration })
}
```

### 3. 使用

```vue
<script setup lang="ts">
import { message } from '@/composables/createMessage'

const handleSave = async () => {
  try {
    await api.save(data)
    message.success('保存成功')
  } catch (err) {
    message.error('保存失败')
  }
}
</script>
```

## 增强：支持堆叠位置

如果需要多个消息堆叠显示：

```typescript
// src/composables/createMessage.ts
let topOffset = 20 // 顶部起始偏移

export function createMessage(options: MessageOptions = {}) {
  // ...
  
  const vnode = h(Message, {
    type,
    message,
    duration,
    showClose,
    top: topOffset, // 动态计算位置
    onClose: () => {
      cleanup()
      topOffset -= 50 // 关闭后减少偏移
    }
  })

  topOffset += 50 // 每个消息增加偏移
  // ...
}
```

组件中使用 `top` prop：

```vue
<template>
  <div class="message" :style="{ top: `${top}px` }">
    ...
  </div>
</template>
```

## 类型提示增强

```typescript
// src/composables/createMessage.ts
interface MessageInstance {
  close: () => void
}

// 让 message.xxx 返回可关闭的实例
export const message = {
  success: (msg: string, duration?: number): MessageInstance => 
    createMessage({ type: 'success', message: msg, duration }),
  // ...
}

// 使用
const msg = message.success('操作成功')
// msg.close() // 手动关闭
```

这样就实现了一个类似 `ElMessage` 的函数式消息提示组件。

## 面试答法

像 `ElMessage` 这种函数式提示组件，核心是用工厂函数动态创建一个独立容器来挂载组件，而不是在页面模板里预埋。流程是：调用工厂时创建一个 `div` 挂到 `body`，用 `h()` 生成组件 VNode 并 `render(vnode, container)` 上去；组件内部通过 props 接收配置、通过 `onClose` 之类的回调把关闭事件回传，回调里 `render(null, container)` 卸载、移除容器并清理定时器等副作用。要注意这种动态挂载的组件不在页面组件树内，拿不到页面的 provide/inject、Pinia、Router，需要这些上下文时要手动借用 `appContext` 或改用页面内的 `<Teleport>` 状态驱动方案；此外还要处理多条消息的堆叠偏移、关闭动画延时后再移除节点、`onUnmounted` 清理定时器等工程细节。
