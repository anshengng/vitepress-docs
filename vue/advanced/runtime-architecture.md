# Vue3 运行时架构

## 模块划分

```
@vue/compiler-dom    ← 编译器（编译时）
@vue/runtime-dom     ← DOM 操作（浏览器环境）
@vue/runtime-core    ← 核心运行时
@vue/reactivity      ← 响应式系统
```

## 一、运行时 vs 编译时

| | 编译时 | 运行时 |
|---|--------|--------|
| 时机 | 构建阶段 | 浏览器执行阶段 |
| 作用 | 模板 → render 函数 | 执行 render、管理组件、更新 DOM |
| 产物 | JavaScript 代码 | 应用实际运行 |

```vue
<!-- 编译时：转换模板 -->
<template>
  <div>{{ count }}</div>
</template>

<!-- 编译后 -->
<script>
export function render() {
  return h('div', null, this.count)
}
</script>
```

## 二、`@vue/runtime-core` 核心模块

### 1. 组件实例（ComponentInstance）

```typescript
// 创建组件实例
function createComponentInstance(vnode) {
  const instance = {
    type: vnode.type,          // 组件定义
    props: {},                 // 外部传入
    setupState: {},            // setup 返回值
    data: {},                  // Options API 的 data
    subTree: null,             // render 生成的 VNode 树
    isMounted: false,          // 是否已挂载
    // ...
  }
  return instance
}
```

### 2. 渲染流程（Render）

```typescript
// 核心渲染函数
function render(vnode, container) {
  if (vnode === null) {
    // 卸载
    unmount(container._vnode)
  } else {
    // 挂载或更新
    patch(container._vnode || null, vnode, container)
  }
  container._vnode = vnode
}
```

### 3. Patch 算法（Diff）

```typescript
function patch(oldVNode, newVNode, container) {
  const { type } = newVNode
  
  if (typeof type === 'string') {
    // 元素节点（div、span...）
    processElement(oldVNode, newVNode, container)
  }
  else if (typeof type === 'object') {
    // 组件节点
    processComponent(oldVNode, newVNode, container)
  }
}

function processElement(oldVNode, newVNode, container) {
  if (oldVNode === null) {
    // 挂载
    mountElement(newVNode, container)
  } else {
    // 更新（diff）
    patchElement(oldVNode, newVNode)
  }
}
```

## 三、`@vue/runtime-dom` DOM 操作层

```typescript
// 封装浏览器 DOM API
export const nodeOps = {
  // 创建元素
  createElement: (tag) => document.createElement(tag),
  
  // 创建文本节点
  createText: (text) => document.createTextNode(text),
  
  // 设置文本
  setText: (node, text) => { node.nodeValue = text },
  
  // 插入节点
  insert: (child, parent, anchor) => {
    parent.insertBefore(child, anchor || null)
  },
  
  // 移除节点
  remove: (child) => {
    const parent = child.parentNode
    if (parent) parent.removeChild(child)
  },
  
  // ...
}
```

## 四、`@vue/reactivity` 响应式系统

### 核心 API

```typescript
import { ref, reactive, computed, effect } from 'vue'

// ref — 基本类型响应式
const count = ref(0)

// reactive — 对象响应式
const state = reactive({ count: 0 })

// computed — 计算属性
const double = computed(() => count.value * 2)

// effect — 副作用函数
effect(() => {
  console.log(count.value) // 自动追踪依赖
})
```

### 响应式原理流程

```
1. 创建 reactive/ref 对象
       ↓
2. 使用 Proxy 劫持 get/set
       ↓
3. get 时：收集依赖（track）
       ↓
4. set 时：触发更新（trigger）
       ↓
5. 重新执行 effect 函数
```

### 存储结构

```javascript
// 全局依赖存储
WeakMap<
  target,       // 原始对象
  Map<
    key,        // 属性名
    Set<effect> // 依赖这个属性的 effect 集合
  >
>
```

## 五、完整运行流程

```
createApp(App)
    ↓
创建 app 实例
    ↓
app.mount('#app')
    ↓
render(vnode, container)
    ↓
patch(old, new, container)
    ↓
processComponent → processElement
    ↓
创建组件实例 → setupComponent → render()
    ↓
生成子 VNode 树 → patch 子节点
    ↓
mountElement → DOM 操作（runtime-dom）
    ↓
mounted 钩子
```

## 六、核心 API 速查

### 响应式

| API | 用途 |
|-----|------|
| `ref()` | 基本类型响应式 |
| `reactive()` | 对象响应式 |
| `computed()` | 计算属性 |
| `watch()` | 侦听器 |
| `watchEffect()` | 自动追踪依赖 |

### 渲染

| API | 用途 |
|-----|------|
| `h()` | 创建 VNode |
| `render()` | 渲染 VNode 到 DOM |
| `createVNode()` | 底层创建 VNode |

### 组件

| API | 用途 |
|-----|------|
| `defineComponent()` | 类型推断更好的组件定义 |
| `defineProps()` | 声明 props |
| `defineEmits()` | 声明事件 |
| `defineExpose()` | 暴露组件方法 |

## 七、调度系统（Scheduler）

```typescript
// 异步批量更新队列
const queue = []
let isFlushing = false

function queueJob(job) {
  if (!queue.includes(job)) {
    queue.push(job)
  }
  if (!isFlushing) {
    isFlushing = true
    // 微任务执行
    Promise.resolve().then(flushJobs)
  }
}

function flushJobs() {
  // 排序：父组件先于子组件
  queue.sort((a, b) => a.id - b.id)
  
  for (const job of queue) {
    job()
  }
  
  queue.length = 0
  isFlushing = false
}
```

## 八、源码目录结构

```
packages/
├── reactivity/        # 响应式
│   └── src/
│       ├── ref.ts
│       ├── reactive.ts
│       ├── effect.ts
│       └── ...
│
├── runtime-core/      # 核心运行时
│   └── src/
│       ├── component.ts    # 组件
│       ├── vnode.ts        # 虚拟节点
│       ├── renderer.ts     # 渲染器
│       ├── scheduler.ts    # 调度器
│       └── apiLifecycle.ts # 生命周期
│
├── runtime-dom/       # DOM 操作
│   └── src/
│       ├── nodeOps.ts      # DOM API
│       └── patchProp.ts    # 属性处理
│
└── compiler-dom/      # 编译器
    └── src/
        └── ...
```

## 九、完整示例：手动渲染组件

```typescript
import { h, render, ref, defineComponent } from 'vue'

// 定义组件
const Counter = defineComponent({
  props: { initial: { type: Number, default: 0 } },
  setup(props) {
    const count = ref(props.initial)
    return { count }
  },
  render() {
    return h('div', [
      h('span', null, `Count: ${this.count}`),
      h('button', { onClick: () => this.count++ }, '+')
    ])
  }
})

// 手动渲染
const vnode = h(Counter, { initial: 10 })
const container = document.createElement('div')
render(vnode, container)
document.body.appendChild(container)
```

## 十、总结图

```
┌─────────────────────────────────────────────────────────┐
│                    Vue 运行时                            │
│                                                         │
│  ┌────────────────────────────────────────────────────┐ │
│  │         @vue/runtime-core (核心)                  │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │ │
│  │  │ 组件管理  │ │ 渲染器   │ │ 调度器           │  │ │
│  │  │ Component │ │ Renderer │ │ Scheduler        │  │ │
│  │  └──────────┘ └──────────┘ └──────────────────┘  │ │
│  └────────────────────────────────────────────────────┘ │
│                         ↓                               │
│  ┌────────────────────────────────────────────────────┐ │
│  │         @vue/runtime-dom (DOM 操作)               │ │
│  │  ┌──────────────────────────────────────────┐    │ │
│  │  │  nodeOps (createElement, insert, ...)    │    │ │
│  │  └──────────────────────────────────────────┘    │ │
│  └────────────────────────────────────────────────────┘ │
│                         ↓                               │
│  ┌────────────────────────────────────────────────────┐ │
│  │         @vue/reactivity (响应式)                  │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │ │
│  │  │   ref    │ │ reactive │ │ effect/computed   │  │ │
│  │  └──────────┘ └──────────┘ └──────────────────┘  │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## 深入学习

想深入哪一块？比如：
- 响应式原理细节（track/trigger 机制）
- Patch/Diff 算法
- 调度器实现
- 组件生命周期执行时机
