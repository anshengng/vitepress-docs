# nextTick 与异步更新

## 为什么更新是异步的：批量合并

如果同步更新：每改一次数据立刻 patch DOM，一次事件里改 N 次就有 N 次渲染，中间结果全是浪费。

```typescript
const state = reactive({ count: 0, name: 'a' })

function onClick() {
  state.count++      // 触发依赖组件的更新 job 入队
  state.name = 'b'   // 同一个组件 → queueJob 内部去重，不重复入队
  state.count++      // 再改，job 已在队列里
}

// 3 次修改 → 组件更新 job 只入队一次 → DOM 只更新一次
```

代价：修改状态之后，**同步代码里读到的 DOM 还是旧的**。nextTick 就是用来把逻辑排到"本轮更新完成之后"执行。

## 事件循环基础

```
┌──────────────────────────────┐
│           调用栈              │
│   执行同步代码（含修改状态）    │
└──────────────┬───────────────┘
               ↓ 栈清空
┌──────────────────────────────┐
│          微任务队列           │
│   Promise.then / nextTick    │
│   （全部清空后才轮到宏任务）    │
└──────────────┬───────────────┘
               ↓
┌──────────────────────────────┐
│          宏任务队列           │
│   setTimeout / UI 渲染等      │
│   （取一个执行 → 再清微任务）  │
└──────────────────────────────┘
```

| 类别 | 常见任务 |
|------|---------|
| 宏任务 | setTimeout / setInterval / setImmediate / I/O / UI 渲染 |
| 微任务 | Promise.then / queueMicrotask / MutationObserver |

Vue 选微任务 flush：更新必须发生在"本轮事件循环结束前、下一个宏任务（包括渲染）之前"，才能保证状态与 DOM 一致。

## nextTick 原理

核心：**组件更新 job 本身就在微任务里 flush，nextTick 把回调链在这个 flush 后面**。

```typescript
// runtime-core/src/scheduler.ts + apiNextTick.ts（简化）
const resolvedPromise = Promise.resolve()
let currentFlushPromise: Promise<void> | null = null
const queue: SchedulerJob[] = []
let isFlushPending = false

function queueJob(job: SchedulerJob) {
  if (!queue.includes(job)) queue.push(job)   // 去重入队
  queueFlush()
}

function queueFlush() {
  if (!isFlushPending) {
    isFlushPending = true
    currentFlushPromise = resolvedPromise.then(flushJobs)   // 微任务
  }
}

function flushJobs() {
  isFlushPending = false
  queue.sort((a, b) => a.id - b.id)   // 按组件 uid：父组件先于子组件
  for (const job of queue) job()      // 执行组件更新 → DOM 已更新
  queue.length = 0
  currentFlushPromise = null
}

export function nextTick(fn?: () => void): Promise<void> {
  const p = currentFlushPromise || resolvedPromise
  return fn ? p.then(fn) : p          // 回调排在 flushJobs 之后
}
```

## 执行顺序

```
同步代码：state.count++        → queueJob 入队 + queueFlush（创建 currentFlushPromise）
同步代码：nextTick(callback)   → callback 链在 currentFlushPromise 之后
调用栈清空
    ↓
微任务队列按入队顺序执行：
  1. flushJobs                 → 组件更新完成，DOM 已是新值
  2. 用户 nextTick 回调          → 读到新 DOM
```

组件更新 job 与 nextTick 回调都在微任务里，但 flushJobs 先执行（它是先挂上 then 的那个），nextTick 回调排在它后面，所以回调里拿到的必然是更新后的 DOM。这里有个前提：nextTick 必须在修改数据之后调用。若在改数据之前就调用 nextTick，此时 currentFlushPromise 还是 null，回调会挂在 resolvedPromise 上，反而先于稍后调度的 flushJobs 执行，读到的仍是旧 DOM。所以正确姿势永远是先改数据、再 `await nextTick()`。

## Vue2 降级链 vs Vue3 直接 Promise

Vue2 用 callbacks 数组 + timerFunc 一次性 flush，timerFunc 需逐级探测：

```typescript
// Vue2 简化实现
const callbacks: Function[] = []
let pending = false

function nextTick(cb: Function) {
  callbacks.push(cb)
  if (!pending) {
    pending = true
    timerFunc()                  // 只安排一次异步任务
  }
}

function flushCallbacks() {
  pending = false
  const copies = callbacks.slice()
  callbacks.length = 0
  copies.forEach(fn => fn())
}

// timerFunc 探测顺序（微任务优先，逐级降级）：
// 1. 原生 Promise.then
// 2. MutationObserver
// 3. setImmediate（IE 专属宏任务）
// 4. setTimeout(0)（兜底宏任务）
```

| | Vue2 | Vue3 |
|--|------|------|
| 实现 | callbacks 数组 + timerFunc 批量 flush | 直接链在 currentFlushPromise 上 |
| 兼容 | 降级到 MutationObserver / setImmediate / setTimeout | 直接原生 Promise，不再支持 IE |
| 返回值 | 早期无返回值，2.1+ 返回 Promise | 始终返回 Promise |
| 与更新的关系 | 更新 watcher 回调也进同一个 callbacks 队列，排在前 | 更新在 flushJobs，nextTick 回调排在其后 |

降级原因：Vue2 需兼容不支持原生 Promise 的环境（如 IE9），只能逐级探测"最接近微任务"的可用 API。

## 使用场景

```typescript
// 场景：改数据后操作新渲染的 DOM
const show = ref(false)

async function toggle() {
  show.value = true
  await nextTick()
  document.getElementById('input')?.focus()   // 新挂载的 DOM 已存在
}
```

nextTick 与 updated 钩子的区别：

| | nextTick | updated 钩子 |
|--|----------|--------------|
| 粒度 | 一次性回调，精确跟在某次更新后 | 组件级：该组件任何重渲染后都会触发 |
| 可用范围 | 任意位置 | 仅组件内 |
| 典型场景 | 改数据后量 DOM、聚焦、初始化第三方库 | 依赖 DOM 的渲染后逻辑（少用，容易连环触发） |

## 经典面试题演示

```vue
<template>
  <div>
    <p ref="text">{{ count }}</p>
    <button @click="onClick">+1</button>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
const count = ref(0)
const text = ref<HTMLParagraphElement>()

async function onClick() {
  count.value++
  console.log(text.value?.textContent)   // '0'：同步阶段 DOM 还没更新
  await nextTick()
  console.log(text.value?.textContent)   // '1'：flushJobs 已执行完
}
</script>
```

输出依次为 `0`、`1`：同步读是旧值，nextTick 之后是新值。

## 面试答法

Vue 的 DOM 更新是异步的：修改响应式数据只是把组件的更新 job 去重后放入队列，通过 Promise.then 在微任务里批量执行，所以一次事件里改多次数据只触发一次 DOM 更新，但这也意味着同步代码里读到的 DOM 是旧的，nextTick 用来把逻辑排到本轮更新之后。Vue3 的 nextTick 实现是返回 currentFlushPromise 的 then 链：组件更新 job 在 flushJobs 中先执行完，用户的 nextTick 回调链在其后，因此回调里拿到的必然是更新后的 DOM。Vue2 因为要兼容 IE，使用 callbacks 数组加 timerFunc 降级链（Promise → MutationObserver → setImmediate → setTimeout），Vue3 不再支持 IE，直接使用原生 Promise。使用上 nextTick 是一次性回调，粒度比 updated 钩子更细，适合改数据后立即读取或操作新 DOM 的场景。
