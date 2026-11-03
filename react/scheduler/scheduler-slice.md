# 一个 while 循环，凭什么不卡住页面？

## 先说这个说不通的地方

React 渲染一棵大列表，动辄几十毫秒。浏览器一帧只有 16.6ms，理论上这段时间里主线程被占满，你敲键盘、滚动页面都该是卡的。

可实际用 React 时，输入框并没有被冻住。**唯一的解释是：那个 while 循环中途停下来过。**

停下来这件事，是 Scheduler 干的。把它想成医院门诊：一个医生要看完一屋子病人，但他不是闷头看完再抬头，而是每看 5 分钟就抬头扫一眼分诊台——有急诊就先处理，没有就回来接着看。病人手里的病历不会因为医生离开就消失，回来还能续上。

这一整篇都在讲这个"抬头看时间、随时可以被叫走"的机制。

## Scheduler 是个什么东西

它是 React 抽出来的独立调度器，单独发布成 `scheduler` 包，和 `react` 的版本号解耦，完全可以脱离 React 用：

| 特性 | 说明 |
|------|------|
| 独立发布 | npm 包名就是 `scheduler`，react-dom 内部也内置了一份 |
| 零依赖 | 不依赖 react / react-dom，只用宿主的 `MessageChannel` |
| 职责单一 | 维护任务队列，决定"什么时候跑"、跑多久后交还主线程 |
| 调用方 | react-reconciler（ReactFiberWorkLoop）用它调度 render 工作 |

一句话：**Scheduler 决定"何时跑"，Fiber 决定"跑什么"**。它把一帧里的长任务切成小片，让浏览器有机会喘气去处理输入和绘制——这就是时间切片。

## 现成的"有空再干"为什么不能用

浏览器原生就有 `requestIdleCallback`，思路正是"等空闲了再干活"，看起来跟时间切片完美对口，但 React 没用：

| 问题 | 说明 |
|------|------|
| 兼容性差 | Safari 长期不支持，要 polyfill，而 polyfill 又依赖别的机制 |
| 触发频率不可控 | 只在浏览器判断空闲时才回调，帧率低时可能很久不触发 |
| 无法保证及时性 | 高优先级任务不能被"有空才做"拖着，否则交互就卡了 |
| 时间片粒度模糊 | 各浏览器给的 deadline 实现不一致，很难稳定控制 |

说白了：`requestIdleCallback` 是"等医院真没人了才叫号"，而 React 要的是"我自己定闹钟，每 5 分钟主动抬头"。

## 为什么是 MessageChannel

自己定闹钟就得有个"稍后再来"的机制。React 选的是 `MessageChannel`：往端口 `postMessage` 会投递一个**宏任务**，当前任务干完后，事件循环会回来执行它，等于重新叫一次号。

```javascript
// packages/scheduler/src/forks/Scheduler.js（简化）
const channel = new MessageChannel();
const port = channel.port2; // 只往 port2 发消息，port1 负责收

// 每收到一次消息 = 开始一个新的时间片
channel.port1.onmessage = performWorkUntilDeadline;

function schedulePerformWorkUntilDeadline() {
  port.postMessage(null); // 投递一个宏任务，排队等下一轮
}
```

为什么不用别的：

| 方案 | 问题 |
|------|------|
| `setTimeout(fn, 0)` | 浏览器对嵌套 setTimeout 有约 4ms 的最小延迟，切片被切得太碎 |
| `requestIdleCallback` | 兼容性和可控性都差，见上一节 |
| `MessageChannel` | 是宏任务，没有 4ms 下限，回调时机可控 |

它依然是**宏任务**，所以不会插在当前任务中间，能让出主线程让浏览器先处理输入、布局、绘制。极早期环境若没有 `MessageChannel`，React 会退化到 `setTimeout`。

## 5ms：医生多久抬一次头

闹钟有了，还差一个"看多久抬一次头"的阈值。React 定的是 **5ms**（`frameInterval`），因为多数设备一帧约 16.6ms，干 5ms 就把剩下的时间留给浏览器渲染。

```javascript
// 每个时间片开始时记下时刻（由 performWorkUntilDeadline 重置）
let startTime = -1;
const frameInterval = 5; // 单位 ms，这就是"连续工作多久必须抬头"

function shouldYieldToHost() {
  const timeElapsed = getCurrentTime() - startTime; // 这一片已经干了多久
  if (timeElapsed < frameInterval) {
    return false; // 还没到 5ms，继续看下一个病人
  }
  return true;    // 超了，交还主线程，等下一次 MessageChannel 回调
}
```

`getCurrentTime` 优先用 `performance.now()`（高精度、单调递增，不受系统时间调整影响），降级到 `Date.now()`。

## React 侧：一次只看一个病人

react-reconciler 里，并发渲染的主循环并不复杂，难的是**在每个工作单元之后**都检查一次要不要让出：

```typescript
// ReactFiberWorkLoop（简化）
function workLoopConcurrent() {
  // workInProgress 是当前正在构建的那棵 Fiber 树节点，也是"看到第几个病人"的进度
  while (workInProgress !== null && !shouldYield()) {
    performUnitOfWork(workInProgress); // 处理一个 Fiber，相当于看完一个病人
  }
}
```

- `workInProgress !== null`：还有节点没处理完，接着干。
- `!shouldYield()`：这一片的 5ms 预算还没用完。
- 两个条件任一不满足就跳出：要么干完了，要么该交还主线程了。
- 跳出**不等于白干**：`workInProgress` 这个引用还在，下次调度从它继续往下走。

对比同步渲染用的 `workLoopSync`，条件里根本没有 `shouldYield`，必须一口气把整棵树算完——那时候 React 还没打算"抬头"。

## 两摞号：taskQueue 与 timerQueue

Scheduler 内部有两个用**最小堆**实现的任务队列：

| 队列 | 放什么 | 排序键 | 作用 |
|------|--------|--------|------|
| `taskQueue` | 已到期、可以立刻跑的任务 | `expirationTime` 升序 | 堆顶永远是"最该先跑"的那个 |
| `timerQueue` | 还没到点的延迟任务 | `startTime` 升序 | 时间没到，先挂着不动 |

每次调度都会先调 `advanceTimers`：把 `timerQueue` 里 `startTime <= 当前时间` 的任务搬进 `taskQueue`，再从 `taskQueue` 取堆顶执行。

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

用最小堆而不是普通数组，是为了 `push` / `pop` 都保持 O(log n)，而 `peek` 取堆顶是 O(1)——每次调度都要取堆顶，这个位置的性能最要紧。

## 优先级换算成号码上的"最晚时间"

Scheduler 的五档优先级，最后都换算成一个数：`expirationTime = startTime + timeout`。**这个数越小越紧急**，堆顶永远是最小的那个。

| 优先级 | 常量值 | timeout | 大致含义 |
|--------|--------|---------|----------|
| `ImmediatePriority` | 1 | -1 | 立刻到期，必须马上执行（如离散事件） |
| `UserBlockingPriority` | 2 | 250ms | 用户交互相关，250ms 内必须响应 |
| `NormalPriority` | 3 | 5000ms | 常规更新 |
| `LowPriority` | 4 | 10000ms | 可以慢一点 |
| `IdlePriority` | 5 | `maxSigned31BitInt` | 超时约 1073741823，几乎永不主动过期 |

```typescript
// packages/scheduler/src/SchedulerPriorities.js
export const ImmediatePriority = 1;
export const UserBlockingPriority = 2;
export const NormalPriority = 3;
export const LowPriority = 4;
export const IdlePriority = 5;

// 每档对应的"允许拖多久"
const IMMEDIATE_PRIORITY_TIMEOUT = -1;            // 立即过期，startTime - 1
const USER_BLOCKING_PRIORITY_TIMEOUT = 250;
const NORMAL_PRIORITY_TIMEOUT = 5000;
const LOW_PRIORITY_TIMEOUT = 10000;
const IDLE_PRIORITY_TIMEOUT = maxSigned31BitInt;  // 几乎永不过期，等同于"随便什么时候"
```

到期判断发生在 workLoop 里，注意这里的短路顺序：

```typescript
// workLoop 简化
while (currentTask !== null) {
  // 还没到期，且这一片 5ms 用完了 → 让出，等下一次回调
  if (currentTask.expirationTime > currentTime && shouldYieldToHost()) {
    break;
  }
  // 已经到期的任务：哪怕超了 5ms 也要跑完，不能被"抬头"打断到饿死
  const continuation = currentTask.callback(currentTask.expirationTime <= currentTime);
  // ... 根据 continuation 是否有值决定继续还是收工
}
```

## 一整个切片周期长什么样

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

三个关键点，面试时最好都点到：

1. **切片粒度是"工作单元"**（单个 Fiber），不是任意一行代码；单个 Fiber 自己的 render 一旦开始就不可打断。
2. **让出只是暂停**，`workInProgress` 引用保留，进度和状态都不丢。
3. **到期任务可以突破 5ms**：`expirationTime > currentTime` 这个条件先短路，`shouldYieldToHost` 根本没机会返回 true，保证它不被饿死。

## 它和 Lane 谁管谁

Scheduler 只管"任务级"调度——什么时候执行这个 callback，它压根不知道也不关心这是哪个组件在更新。真正决定"这次更新有多急"的是 React 的 Lane 模型。两者只在 `scheduleCallback(priorityLevel, callback)` 这一个点上衔接：Lane 先定优先级档位，Scheduler 再据此算出 `expirationTime` 并排队。

用医院的话说：Lane 是医生开的"急诊 / 普通 / 体检"单子，Scheduler 是分诊台的排号系统。

## 面试答法

Scheduler 是 React 抽出来的独立调度器，npm 包名就叫 scheduler，不依赖 react 和 react-dom，是并发渲染的底座。它不用 `requestIdleCallback`，因为那个 API 兼容性差、只在浏览器空闲时触发、频率不可控，也保证不了高优先级任务的及时性；所以 React 用 `MessageChannel` 自己实现，因为它是宏任务，又没有 `setTimeout` 约 4ms 的最小延迟，回调时机可控。时间切片的核心是 `shouldYieldToHost`，用 `getCurrentTime` 和每个时间片开始时记录的 `startTime` 做差，超过约 5ms 的 `frameInterval` 就返回 true，让出主线程；React 侧的 `workLoopConcurrent` 就是 `while (workInProgress !== null && !shouldYield())` 逐个 `performUnitOfWork`，跳出后 `workInProgress` 还在，下次接着跑。任务分两个最小堆：`taskQueue` 放已到期的、按 `expirationTime` 升序，`timerQueue` 放没到点的，由 `advanceTimers` 搬过去；五档优先级都换算成 `expirationTime`，越小越紧急，`IdlePriority` 的超时是最大整数几乎永不过期，`UserBlockingPriority` 是 250ms，到期任务即使超了 5ms 也会跑完，避免被饿死。
