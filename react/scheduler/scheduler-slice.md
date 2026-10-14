# Scheduler 与时间切片

## 核心思路

React 并发渲染的底座是 **Scheduler**——一个可中断、可排序的任务调度器。它被抽成独立包 `packages/scheduler`，在 npm 上单独发布，与 `react` 的版本号解耦，可以脱离 React 单独使用。

| 特性 | 说明 |
|------|------|
| 独立发布 | npm 包名就是 `scheduler`，react-dom 内部也内置了一份 |
| 零依赖 | 不依赖 react / react-dom，只用宿主的 `MessageChannel` |
| 职责单一 | 维护任务队列，决定"什么时候跑"、跑多久后交还主线程 |
| 调用方 | react-reconciler（ReactFiberWorkLoop）用它调度 render 工作 |

一句话：**Scheduler 决定"何时跑"，Fiber 决定"跑什么"**。它把一帧里的长任务切成小片，让浏览器有机会处理用户交互，这就是"时间切片"。

## 为什么不用 requestIdleCallback

浏览器原生就有 `requestIdleCallback`，思路正是"有空闲就干活"，但 React 没有采用，原因有几条：

| 问题 | 说明 |
|------|------|
| 兼容性差 | Safari 长期不支持，需要 polyfill，而 polyfill 又依赖别的机制 |
| 触发频率不可控 | 只在浏览器判断空闲时才回调，帧率低时可能长时间不触发 |
| 无法保证及时性 | 高优先级任务不能被"有空才做"拖延，否则交互会卡顿 |
| 时间片粒度模糊 | 回调里给的 deadline 各浏览器实现不一致，难以稳定控制 |

## 基于 MessageChannel 的实现

React 自己实现调度，核心是 `MessageChannel`：向端口 `postMessage` 会投递一个**宏任务**，从而在当前任务结束后回到事件循环继续干活。

```javascript
// packages/scheduler/src/forks/Scheduler.js（简化）
const channel = new MessageChannel();
const port = channel.port2;

// 每收到一次消息，就是一个新的时间片
channel.port1.onmessage = performWorkUntilDeadline;

function schedulePerformWorkUntilDeadline() {
  port.postMessage(null);
}
```

为什么选 `MessageChannel`，对比几个方案：

| 方案 | 问题 |
|------|------|
| setTimeout(fn, 0) | 浏览器对嵌套 setTimeout 有约 4ms 的最小延迟，切片过于零碎 |
| requestIdleCallback | 兼容性与可控性都差，见上一节 |
| MessageChannel | 宏任务，没有 4ms 下限，回调时机可控 |

注意它依然是**宏任务**，所以不会阻塞当前任务，还能让出主线程让浏览器先处理输入、布局、绘制。早期环境若没有 `MessageChannel`，React 会退化到 `setTimeout`。

## 时间切片：shouldYieldToHost

切片的关键是"跑多久"这个阈值。React 把它定为 **5ms**（`frameInterval`），因为大多数设备的帧预算是 16.6ms，留出足够时间给浏览器做渲染。

```javascript
// 每个时间片开始时记录时刻
let startTime = -1;
const frameInterval = 5; // 单位 ms

function shouldYieldToHost() {
  const timeElapsed = getCurrentTime() - startTime;
  if (timeElapsed < frameInterval) {
    return false; // 还没超过 5ms，继续处理下一个工作单元
  }
  return true;    // 超过 5ms，让出主线程，等下一次 MessageChannel 回调
}
```

`getCurrentTime` 优先用 `performance.now()`（高精度、单调递增），降级到 `Date.now()`。

### React 侧的核心循环

react-reconciler 里，并发渲染的循环会在**每个工作单元之后**检查是否该让出：

```typescript
// ReactFiberWorkLoop（简化）
function workLoopConcurrent() {
  // workInProgress 是当前正在构建的 Fiber 树节点
  while (workInProgress !== null && !shouldYield()) {
    performUnitOfWork(workInProgress);
  }
}
```

- `workInProgress !== null`：还有节点没处理完，循环继续。
- `!shouldYield()`：这一片的 5ms 预算还没用完。
- 两个条件任一不满足就跳出循环：要么干完了，要么该交还主线程了。
- 跳出后不会丢工作，`workInProgress` 引用还在，下次调度继续从它往下走。

对比同步渲染用的 `workLoopSync`，条件里根本没有 `shouldYield`，必须一口气把整棵树算完。

## 两个队列：taskQueue 与 timerQueue

Scheduler 内部维护两个用**最小堆**实现的任务队列：

| 队列 | 存放 | 排序键 | 作用 |
|------|------|--------|------|
| taskQueue | 已到期、可立即执行的任务 | `expirationTime` 升序 | 堆顶永远是"最该先跑"的任务 |
| timerQueue | 尚未到期的延迟任务 | `startTime` 升序 | 时间没到，先挂着 |

每次调度都会调用 `advanceTimers`：把 `timerQueue` 里 `startTime <= 当前时间` 的任务搬进 `taskQueue`，再从 `taskQueue` 取堆顶执行。

```text
timerQueue（按 startTime 排序）
   ┌───────────────┬───────────────┬───────────────┐
   │ startTime=100 │ startTime=200 │ startTime=500 │
   └───────────────┴───────────────┴───────────────┘
                   │  advanceTimers：startTime <= now 的搬走
                   ↓
taskQueue（按 expirationTime 排序，最小堆）
   ┌───────────────────────────────────────────────┐
   │ 堆顶 = expirationTime 最小的任务 → 最先执行    │
   └───────────────────────────────────────────────┘
                   │  每执行完一个任务
                   ↓
   弹出堆顶 → 执行 callback → 若还有工作则 postMessage 再排下一片
```

用最小堆而不是普通数组，是为了 `push` / `pop` 都保持 O(log n)，而 `peek` 取堆顶是 O(1)。

## 优先级换算成 expirationTime

Scheduler 的五档优先级最终都换算成 `expirationTime = startTime + timeout`。**expirationTime 越小越紧急**，堆顶优先执行。

| 优先级 | 常量值 | timeout | 大致含义 |
|--------|--------|---------|----------|
| ImmediatePriority | 1 | -1 | 立刻到期，必须马上执行（如离散事件） |
| UserBlockingPriority | 2 | 250ms | 用户交互相关，250ms 内必须响应 |
| NormalPriority | 3 | 5000ms | 常规更新 |
| LowPriority | 4 | 10000ms | 可以慢一点 |
| IdlePriority | 5 | maxSigned31BitInt | 超时被设成约 1073741823，几乎永不主动过期 |

```typescript
// packages/scheduler/src/SchedulerPriorities.js
export const ImmediatePriority = 1;
export const UserBlockingPriority = 2;
export const NormalPriority = 3;
export const LowPriority = 4;
export const IdlePriority = 5;

// 对应的超时时长
const IMMEDIATE_PRIORITY_TIMEOUT = -1;               // 立即过期
const USER_BLOCKING_PRIORITY_TIMEOUT = 250;
const NORMAL_PRIORITY_TIMEOUT = 5000;
const LOW_PRIORITY_TIMEOUT = 10000;
const IDLE_PRIORITY_TIMEOUT = maxSigned31BitInt;     // 几乎永不过期
```

到期判断发生在 workLoop 里：

```typescript
// workLoop 简化
while (currentTask !== null) {
  // 任务没到期，且时间片用完 → 让出，等下一次回调
  if (currentTask.expirationTime > currentTime && shouldYieldToHost()) {
    break;
  }
  // 到期任务即便超了 5ms 也要跑完，避免被饿死
  const continuation = currentTask.callback(currentTask.expirationTime <= currentTime);
  // ...根据 continuation 决定是否继续
}
```

## workLoop 与切片让出的完整过程

```text
主线程时间轴 →

[Task A 开始]  处理单元1 → 处理单元2 → 处理单元3
                                        │ 累计已超 5ms
                                        ↓ shouldYieldToHost() 返回 true
              跳出 while，结束当前消息回调
                                        ↓
              port.postMessage(null) 投递下一个宏任务
                                        ↓
              主线程解放 → 浏览器有机会处理 输入 / 布局 / 绘制
                                        ↓
[下一个时间片] 从 workInProgress 续上 → 处理单元4 → 处理单元5 → ...
                                        ↓ 干完
              workInProgress === null，循环自然退出，渲染完成
```

三个关键点：

1. **切片粒度是"工作单元"**（单个 Fiber），不是任意代码行；单个单元的 render 是不可打断的。
2. **让出只是暂停**，`workInProgress` 引用保留，状态不丢。
3. **到期任务可以突破 5ms**：如果任务已到期还没跑完，`shouldYieldToHost` 的判断会被 `expirationTime > currentTime` 短路，保证它不被饿死。

## Scheduler 与 Lane 的关系

Scheduler 只管"任务级别"的调度（何时执行 callback），它不知道也不关心这是哪个组件的更新。真正决定"这次更新是什么优先级"的是 React 的 Lane 模型，二者通过 `scheduleCallback(priorityLevel, callback)` 这一点衔接：Lane 先决定优先级档位，Scheduler 再据此算出 `expirationTime` 并排队。

## 面试答法

Scheduler 是 React 从 react 包里抽出来的独立调度器，npm 包名就是 scheduler，它不依赖 react 和 react-dom，可以单独使用，是并发渲染的底座。之所以不用浏览器的 requestIdleCallback，是因为它兼容性差、只在浏览器空闲时触发、触发频率不可控，也没法保证高优先级任务的及时性，所以 React 用 MessageChannel 自己实现调度，因为 MessageChannel 是宏任务，没有 setTimeout 大约 4ms 的最小延迟，回调时机也更可控。时间切片的核心是 shouldYieldToHost，它用 getCurrentTime 和每个时间片开始时记录的 startTime 做差，一旦超过约 5ms 的 frameInterval 就返回 true 让出主线程，React 侧的 workLoopConcurrent 就是 while (workInProgress !== null && !shouldYield()) 逐个 performUnitOfWork。任务分成两个最小堆：taskQueue 放已到期的任务按 expirationTime 升序，timerQueue 放还没到期的任务，到期后由 advanceTimers 搬进 taskQueue；五档优先级最终都换算成 expirationTime，越小越紧急，IdlePriority 的超时被设成最大整数几乎永不过期，UserBlockingPriority 则是 250ms。
