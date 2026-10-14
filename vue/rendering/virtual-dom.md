# 虚拟 DOM

## 核心概念

| 概念 | 说明 |
|------|------|
| `VNode` | 虚拟节点对象，描述真实 DOM 的结构 |
| `h()` | 创建 VNode 的工具函数 |
| `render()` | 把 VNode 渲染/更新到真实 DOM |

## VNode 结构

```typescript
interface VNode {
  type: string | Component   // 标签名或组件
  props: Record<string, any> // 属性
  children: VNode[] | string // 子节点
  el: Element | null         // 对应的真实 DOM
  // ...其他内部属性
}

// h('div', { class: 'box' }, 'hello') 会创建
{
  type: 'div',
  props: { class: 'box' },
  children: 'hello',
  el: null
}
```

## 渲染流程

```typescript
import { h, render } from 'vue'

// 1. 创建 VNode
const vnode = h('div', { class: 'box' }, [
  h('span', null, 'hello'),
  h('span', null, 'world')
])

// 2. 渲染到 DOM
const container = document.getElementById('app')
render(vnode, container)

// 3. 更新（创建新 VNode 对比 diff）
const newVnode = h('div', { class: 'box updated' }, 'changed')
render(newVnode, container)

// 4. 卸载
render(null, container)
```

## Diff 算法

### 核心思想

```
1. 同层级比较（不跨层级）
2. 不同类型直接替换
3. 相同类型对比属性
4. 子节点：双端对比 + 最长递增子序列
```

### Patch 流程

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

### 同层级比较

```typescript
// Vue 不会跨层级比较
// 旧树         新树
//  div          div
//  ├── span     ├── p
//  └── p        └── span

// Vue 会：同位置比较
// 旧 span vs 新 p → 类型不同，直接替换
// 旧 p vs 新 span → 类型不同，直接替换
```

### 子节点 Diff

```typescript
// 双端对比算法
function patchChildren(oldChildren, newChildren, container) {
  // 1. 头部比较
  while (oldStart <= oldEnd && newStart <= newEnd) {
    if (isSameVNodeType(oldChildren[oldStart], newChildren[newStart])) {
      patch(oldChildren[oldStart], newChildren[newStart])
      oldStart++
      newStart++
    } else {
      break
    }
  }
  
  // 2. 尾部比较
  while (oldStart <= oldEnd && newStart <= newEnd) {
    if (isSameVNodeType(oldChildren[oldEnd], newChildren[newEnd])) {
      patch(oldChildren[oldEnd], newChildren[newEnd])
      oldEnd--
      newEnd--
    } else {
      break
    }
  }
  
  // 3. 中间乱序部分
  if (oldStart > oldEnd) {
    // 旧节点先遍历完，新增节点
    while (newStart <= newEnd) {
      mount(newChildren[newStart], container)
      newStart++
    }
  } else if (newStart > newEnd) {
    // 新节点先遍历完，删除多余节点
    while (oldStart <= oldEnd) {
      unmount(oldChildren[oldStart])
      oldStart++
    }
  } else {
    // 中间乱序，使用最长递增子序列优化
    const increasingNewIndexSequence = getSequence(newChildren.map(n => n.key))
    // ...
  }
}
```

## 调度系统（Scheduler）

Vue 不是立即更新 DOM，而是**异步批量更新**。

```typescript
// 同步修改多次，只触发一次更新
state.count++
state.name = 'new'
state.age = 20

// → 一次 DOM 更新（微任务队列）
```

### 调度流程

```
状态改变
    ↓
将 effect 加入队列（去重）
    ↓
queueFlush() → Promise.resolve().then(flushJobs)
    ↓
微任务执行：按顺序执行队列中的 effect
    ↓
一次性更新 DOM
```

### 实现

```typescript
const queue: Function[] = []
let isFlushing = false

function queueJob(job: Function) {
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

## 源码目录结构

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
