# useState 与 useReducer 的更新队列

## 核心思路

`useState` 本身没有独立的实现，它在源码里就是 `useReducer` 的一个特例：`dispatch` 对应 `dispatchAction`，而 reducer 固定为 `basicStateReducer`。理解了 useReducer 的更新队列，就理解了 useState 的全部机制。

```typescript
// useState 本质：reducer 被写死成「函数式更新」的形式
function basicStateReducer(state, action) {
  // action 是函数（setState(c => c + 1)）就用旧值算出新值
  // 否则 action 就是新值本身（setState(1)）
  return typeof action === 'function' ? action(state) : action;
}

// 对外暴露的 useState 就绑定这个 reducer
const updateState = (initialState) => updateReducer(basicStateReducer, initialState);
```

每次调用 `setState` 都不会立即改状态，而是往该 hook 的 `queue` 里**塞一个 update 对象**，然后调度一次渲染。渲染时再把队列里的 update 依次重放、算出新的 state。延迟到渲染阶段统一计算，是批处理能成立的基础。

| 概念 | 含义 |
|------|------|
| hook.queue | 该 Hook 的更新队列，`pending` 指向环形队尾 |
| update 对象 | 一次更新的描述，含优先级、动作、预计算状态 |
| dispatch | `setState`，即 `dispatchAction`，负责入队 + 调度 |
| reducer | 应用 update 得到新 state 的函数 |

## 更新队列是环形链表

`queue.pending` 指向**最后一个** update（不是第一个），并且 `pending.next` 回指第一个 update，形成**闭环**。这样设计的好处是「尾插 O(1)」：不用维护头尾两个指针，一个 `pending` 就能同时拿到首尾。

```text
queue.pending ─┐
               ▼
   ┌──────→ [update B] ──next──→ [update C] ──next──→ [update A] ┐
   │  (first)                                                   │
   └────────────────────────── pending.next ────────────────────┘

pending 指向 C（队尾）；C.next 指向 A（队首）；A→B，B→C 串起来
遍历时从 pending.next（A）开始，绕一圈回到 pending（C）为止
```

每个 update 对象的字段：

| 字段 | 含义 |
|------|------|
| `lane` | 这次更新的优先级（Lane 模型，用于并发/优先级调度） |
| `action` | 更新动作，函数式写法是回调，普通写法是目标值 |
| `eagerState` | 入队时提前算出的下一个 state（乐观计算） |
| `hasEagerState` | 是否已经算过 eagerState |
| `next` | 环形链表的下一项 |

入队逻辑（`enqueueUpdate`）就三步，第一次入队让节点自闭环，否则插在队尾之后：

```typescript
function enqueueUpdate(fiber, queue, update) {
  const pending = queue.pending;
  if (pending === null) {
    // 队列为空：自己指向自己，形成只有一个节点的环
    update.next = update;
  } else {
    // 插到队尾：新节点接上队首，原队尾接上新节点
    update.next = pending.next; // 新节点的 next = 原本的队首
    pending.next = update;      // 原队尾的 next = 新节点
  }
  queue.pending = update;       // pending 永远指向最新入队的节点（新队尾）
}
```

```text
入队前：             入队 update C 后：
pending → B           pending → C
B.next → A            C.next → A  （C 想插到 A 之前）
A.next → B            A.next → B
                      B.next → C  （原队尾指向新队尾，闭环成立）
```

## 处理队列：渲染时重放 update

渲染阶段 `updateReducer` 会从 `queue.pending.next`（队首）开始，绕环形走一圈，对每个满足优先级的 update 依次调用 reducer，累加出最终 state：

```typescript
function updateReducer(reducer, initialState) {
  const hook = updateWorkInProgressHook();
  const queue = hook.queue;
  queue.lastRenderedReducer = reducer;

  const pendingQueue = queue.pending;
  let newState = hook.memoizedState; // 从上一轮的状态出发
  if (pendingQueue !== null) {
    queue.pending = null;              // 摘链，表示这些更新已被消费
    const first = pendingQueue.next;   // 队首
    let update = first;
    do {
      // 优先级足够就应用，不够则挪到 baseQueue 等下次重放
      newState = reducer(newState, update.action);
      update = update.next;
    } while (update !== null && update !== first); // 绕回队首即结束
  }

  hook.memoizedState = newState;
  return [hook.memoizedState, queue.dispatch];
}
```

因为带着 `lane`，高优先级更新（如用户输入）可以先被应用，低优先级更新被丢进 `baseQueue` 暂存，等空闲时再从 `baseState` 重放，这就是「时间切片下状态不丢」的保证。

## eagerState：能不算就跳过的优化

`dispatchAction` 入队时有一个优化：如果当前 Fiber 没有任何待处理更新（`lanes === NoLanes`，且 alternate 也没有），说明当前 state 就是最新的，React 可以直接用 `lastRenderedReducer` 把新状态算出来。

```typescript
function dispatchAction(fiber, queue, action) {
  const lane = requestUpdateLane(fiber); // 取优先级
  const update = { lane, action, eagerState: null, hasEagerState: false, next: null };
  // ... enqueueUpdate 入队 ...

  const alternate = fiber.alternate;
  if (fiber.lanes === NoLanes && (alternate === null || alternate.lanes === NoLanes)) {
    const lastRenderedReducer = queue.lastRenderedReducer;
    if (lastRenderedReducer !== null) {
      const currentState = queue.lastRenderedState;
      const eagerState = lastRenderedReducer(currentState, action); // 提前算
      update.hasEagerState = true;
      update.eagerState = eagerState;
      if (Object.is(eagerState, currentState)) {
        // 新状态与当前状态相同 → 无需渲染，直接返回
        return;
      }
    }
  }
  // ... 进入 scheduleUpdateOnFiber 调度渲染 ...
}
```

效果：`setState(同一个值)` 或「算完没变化」的更新会直接 bailout，省掉一次渲染。注意它只在队列为空时生效，一旦有多个更新排队，就无法可靠地提前算出最终值。

## 批处理：为什么多次 setState 只渲染一次

批处理指的是同一「批次」内的多次 `setState` 被合并，只触发一次渲染。本质原因是这些更新拿到了**相同的 lane**，在 `ensureRootIsScheduled` 阶段被识别为同一优先级，统一安排一次渲染任务。

| 场景 | React 17 | React 18（createRoot） |
|------|-----------|------------------------|
| React 事件回调内多次 setState | 批处理 | 批处理 |
| setTimeout / Promise 回调内 | 不批处理（每次 setState 都渲染） | 批处理（自动批处理） |
| 原生 addEventListener 事件内 | 不批处理 | 批处理 |
| 批处理控制 API | 用 `unstable_batchedUpdates` 手动"进入"批处理，把外部事件里的多次 setState 合并成一次渲染 | 用 `flushSync` 强制同步刷新、"打破"批处理 |

React 17 只在 React 自己的合成事件里批处理，因为那些回调被 `unstable_batchedUpdates` 包住；在 `setTimeout` 或原生事件里更新会「漏出去」，每次 `setState` 都同步渲染一次。React 18 的 `createRoot` 引入了**自动批处理**：无论更新来自哪里，只要在同一个微任务窗口内，都会被合并。

```typescript
// React 18：下面两次 setState 只触发一次渲染
setTimeout(() => {
  setCount(c => c + 1);
  setFlag(f => !f);
  // 两次更新进入同一批次，渲染一次即可
}, 0);
```

## 闭包陷阱：为什么需要函数式更新

每次渲染时，组件函数体里的 state 都是那一次渲染的**常量快照**，函数执行完这个快照就固定了。异步回调捕获的是它创建时那一轮渲染的 state，而不是最新的 state：

```typescript
function Counter() {
  const [count, setCount] = useState(0);

  function handleClick() {
    setCount(count + 1); // 读的是本次渲染的 count 快照
    setCount(count + 1); // 同一个快照，还是旧值 → 最终只加了 1
    setTimeout(() => {
      // 这里读到的 count 也是点击那一轮的旧快照
      console.log(count);
    }, 1000);
  }

  // 函数式写法：action 是回调，入队时不读闭包里的值，
  // 而是在渲染阶段用「当时最新的 state」去执行，多步累加才正确
  const handleDouble = () => setCount(c => c + 1);
  return <button onClick={handleClick}>{count}</button>;
}
```

根因是「`count` 是值快照，不是引用」。`setCount(c => c + 1)` 把计算推迟到渲染阶段，用最新的 state 参与运算，因此连续多次调用会依次累加（1 → 2），不受闭包快照影响。

## 面试答法

`useState` 的底层就是 `useReducer`，`dispatch` 即 `dispatchAction`，reducer 是 `basicStateReducer`，它对函数式 action 调用函数、对普通值直接返回。每次更新会生成一个 update 对象（含 `lane`、`action`、`eagerState`、`hasEagerState`、`next`）挂到该 hook 的 `queue` 上，队列是环形链表，`pending` 指向队尾且 `pending.next` 回指队首，尾插 O(1)，遍历时从队首绕一圈到队尾。渲染阶段 `updateReducer` 从队首依次重放 update 算出新 state，优先级不够的更新进 `baseQueue` 等重放。入队时有 eagerState 优化：当队列为空时提前算出下一个状态，若与当前状态相同就 bailout，不再调度渲染。批处理方面，React 18 的 `createRoot` 起是自动批处理，同一事件里的多次 `setState` 因拿到相同 lane 被合并成一次渲染，而 React 17 只在合成事件里批处理，`setTimeout`、Promise、原生事件里不会。最后，因为每次渲染的 state 是常量快照，异步回调读到的是旧值，所以连续更新要用 `setCount(c => c + 1)` 这种函数式写法，把计算推迟到渲染阶段用最新状态执行。
