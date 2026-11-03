# 连写两次 setState，为什么只加了一次？

## 先说两个让人挠头的现象

刚写 React 的时候，这两个现象几乎是同时撞上的：

```jsx
function Counter() {
  const [count, setCount] = useState(0)

  function handleClick() {
    setCount(count + 1)   // 想加 1
    setCount(count + 1)   // 想再加 1
    console.log(count)    // 打印的却还是 0
  }

  return <button onClick={handleClick}>{count}</button>
}
```

点一次按钮，界面只加了 1；而且 `setCount` 刚调完，紧接着读 `count` 还是旧值。

看起来像 bug，其实是同一个设计的两个侧面：**`setState` 不负责改状态，它只负责"下单"；真正把状态"做出来"，要等渲染的时候。**

想象一家奶茶店：收银台不做奶茶。你点单，收银员只把小票撕下来串在绳子上，等这一波顾客的单全收完了，制作台才按顺序一张张做。`setState` 是收银员，`render` 是制作台。下面所有机制，都发生在"小票"和"制作台"之间。

## useState 其实就是 useReducer 换了身衣服

源码里 `useState` 没有独立实现，它就是 `useReducer` 的一个特例，连 reducer 都是写死的：

```typescript
// 这就是 useState 的全部"业务逻辑"：一张小票怎么变成一杯奶茶
function basicStateReducer(state, action) {
  // 小票上写的是"按现在的做法再加一份"，就调用它算
  // 小票上写的是一个具体口味，就直接用这个值
  return typeof action === 'function' ? action(state) : action;
}

// 对外暴露的 useState，只是把 reducer 固定成上面那个，然后把 dispatch 递给你
const updateState = (initialState) => updateReducer(basicStateReducer, initialState);
```

所以理解 `setState` 的关键不是它本身，而是它背后那个"小票队列"。先把几个名词对号入座：

| 概念 | 在店里对应什么 | 技术含义 |
|------|----------------|----------|
| `hook.queue` | 串小票的那根绳子 | 该 Hook 的更新队列，`pending` 指向环形队尾 |
| update 对象 | 一张小票 | 一次更新的描述，含优先级、动作、预计算状态 |
| `dispatch` | 收银员 | 就是 `setState`，即 `dispatchAction`，负责入队 + 调度 |
| reducer | 制作规则 | 应用 update 得到新 state 的函数 |

要点：调 `setState` 时**状态一个字节都没变**，只是多了张小票、喊了一嗓子"有单"。延迟到渲染阶段统一结算，正是批处理能成立的前提。

## 小票为什么要串成一个圈

队列是一个单向**环形链表**，而且 `queue.pending` 指向的是**最后一张**小票，不是第一张。最后一张的 `next` 回指第一张，首尾就接上了。

这么设计只为一件事：**尾插 O(1)**。不用维护头、尾两个指针，一个 `pending` 就能同时够到队首（`pending.next`）和队尾（`pending` 自己）。

```text
queue.pending ─┐
               ▼
   ┌──────→ [update B] ──next──→ [update C] ──next──→ [update A] ┐
   │  (first)                                                   │
   └────────────────────────── pending.next ────────────────────┘

pending 指向 C（队尾）；C.next 指向 A（队首）；A→B，B→C 串起来
遍历时从 pending.next（A）开始，绕一圈回到 pending（C）为止
```

每张小票上记的东西：

| 字段 | 含义 |
|------|------|
| `lane` | 这张单的优先级，对应 Lane 模型，决定它多急 |
| `action` | 更新动作：函数式写法是回调，普通写法就是目标值 |
| `eagerState` | 收银时提前算出的下一个状态（乐观计算） |
| `hasEagerState` | 是否已经算过 eagerState |
| `next` | 环形链表的下一项 |

入队只有三步：队列空就让节点自己指自己（一个人也是一个圈），否则插到队尾之后，最后把 `pending` 挪到新节点上。

```typescript
function enqueueUpdate(fiber, queue, update) {
  const pending = queue.pending;
  if (pending === null) {
    // 第一位顾客：小票自己指向自己，形成只有一张票的环
    update.next = update;
  } else {
    // 插在队尾之后：新票先接上原来的队首，保证环不断
    update.next = pending.next; // 新节点的 next = 原本的队首
    pending.next = update;      // 原队尾的 next = 新节点
  }
  queue.pending = update;       // pending 永远指向最新入队的那张（新队尾）
}
```

```text
入队前：             入队 update C 后：
pending → B           pending → C
B.next → A            C.next → A  （C 接上原来的队首 A）
A.next → B            A.next → B
                      B.next → C  （原队尾 B 指向新队尾 C，闭环成立）
```

## 结算：渲染时把小票一张张重放

小票攒着不算数，得等制作台开工。渲染阶段 `updateReducer` 从 `queue.pending.next`（队首）出发，顺着 `next` 绕一圈，每张小票依次喂给 reducer，一路累加出最终 state：

```typescript
function updateReducer(reducer, initialState) {
  const hook = updateWorkInProgressHook();
  const queue = hook.queue;
  queue.lastRenderedReducer = reducer; // 记下规则，eagerState 优化时要用

  const pendingQueue = queue.pending;
  let newState = hook.memoizedState; // 从上一轮已经做好的那杯开始算
  if (pendingQueue !== null) {
    queue.pending = null;              // 摘链：这些单已被消费，防止重复制作
    const first = pendingQueue.next;   // 队首是第一张要做的票
    let update = first;
    do {
      // 优先级足够就应用；不够的先挪到 baseQueue，等下一次用 baseState 重放
      newState = reducer(newState, update.action);
      update = update.next;
    } while (update !== null && update !== first); // 绕回队首即结束，不会死循环
  }

  hook.memoizedState = newState; // 结算结果存回节点，下次渲染从这里起步
  return [hook.memoizedState, queue.dispatch];
}
```

小票上的 `lane` 在这里发挥作用：高优先级单（比如用户正在输入）可以先做，低优先级的单先挪进 `baseQueue` 寄存，等空闲时再从 `baseState` 起重放。**这就是时间切片下"半路被高优先级打断，低优先级状态也不会丢"的原因。**

## 收银员顺手瞄一眼：eagerState

有一类单根本不用送到制作台：跟上一杯一模一样。`dispatchAction` 里就有这个优化——如果当前 Fiber 一张待处理单都没有（`lanes === NoLanes`，alternate 也没有），说明手里这个 state 就是最新的，可以当场用 `lastRenderedReducer` 先算一遍：

```typescript
function dispatchAction(fiber, queue, action) {
  const lane = requestUpdateLane(fiber); // 先定这张单有多急
  const update = { lane, action, eagerState: null, hasEagerState: false, next: null };
  // ... enqueueUpdate 入队 ...

  const alternate = fiber.alternate;
  // 只有"店里没积压任何单"时，当前 state 才可信，才能提前算
  if (fiber.lanes === NoLanes && (alternate === null || alternate.lanes === NoLanes)) {
    const lastRenderedReducer = queue.lastRenderedReducer;
    if (lastRenderedReducer !== null) {
      const currentState = queue.lastRenderedState;
      const eagerState = lastRenderedReducer(currentState, action); // 提前算
      update.hasEagerState = true;
      update.eagerState = eagerState;
      if (Object.is(eagerState, currentState)) {
        // 算出来跟现在一样 → 直接走人，不排出单，不触发渲染
        return;
      }
    }
  }
  // ... 进入 scheduleUpdateOnFiber 调度渲染 ...
}
```

效果就是 `setState(同一个值)`、或「算完没变化」的更新会直接 bailout，省掉一次渲染。注意它**只在队列为空时生效**：一旦前面还有几张单没做，最终口味取决于全部单子，提前算没有意义。

## 同一波顾客的单，一起做一次

批处理说的是同一"批次"里的多次 `setState` 被合并，只触发一次渲染。本质原因不神秘：这些更新拿到了**相同的 lane**，在 `ensureRootIsScheduled` 阶段被认成同一优先级，于是只安排了一个渲染任务。

| 场景 | React 17 | React 18（createRoot） |
|------|-----------|------------------------|
| React 事件回调内多次 setState | 批处理 | 批处理 |
| setTimeout / Promise 回调内 | 不批处理（每次 setState 都渲染） | 批处理（自动批处理） |
| 原生 addEventListener 事件内 | 不批处理 | 批处理 |
| 手动控制 API | `unstable_batchedUpdates`：把外部事件里的多次 setState 手动"包"进一批 | `flushSync`：强制同步刷新，"打破"批处理 |

React 17 只在 React 自己的合成事件里批处理，因为那些回调被 `unstable_batchedUpdates` 包着；在 `setTimeout`、Promise、原生事件里更新会"漏出去"，每次 `setState` 都同步渲染一次。React 18 的 `createRoot` 引入**自动批处理**：不管更新从哪来，只要在同一个微任务窗口内，都会被合并。

```typescript
// React 18：下面两次 setState 只触发一次渲染
setTimeout(() => {
  setCount(c => c + 1);
  setFlag(f => !f);
  // 两张单落进同一批、同一个 lane，制作台只开一次工
}, 0);
```

## 手里的菜单是旧的：闭包陷阱

每次渲染，组件函数体里的 state 都是**那一次渲染的常量快照**。函数执行完，这个快照就冻住了；异步回调捕获的永远是它被创建时那一轮的 state。

```typescript
function Counter() {
  const [count, setCount] = useState(0);

  function handleClick() {
    setCount(count + 1); // 读的是本次渲染的 count 快照 = 0 → 下单"做 1 杯"
    setCount(count + 1); // 还是那个 0 → 又下一张"做 1 杯"的单
    // 两张单都写着"目标值 1"，重放两次结果还是 1
    setTimeout(() => {
      // 这里的 count 也是点击那一轮的旧快照，不会变成最新值
      console.log(count);
    }, 1000);
  }

  // 函数式写法：小票上写的是"在当前基础上加一份"，不是"做成第几杯"
  // 入队时不读闭包，渲染时再用当时最新的 state 去算，多步累加才对
  const handleDouble = () => setCount(c => c + 1);
  return <button onClick={handleClick}>{count}</button>;
}
```

根因一句话：**`count` 是值快照，不是引用**。`setCount(c => c + 1)` 把计算推迟到渲染阶段，用最新 state 参与运算，所以连续两次调用会依次累加（0 → 1 → 2），不受闭包快照影响。

## 面试答法

`useState` 底层就是 `useReducer`，`dispatch` 即 `dispatchAction`，reducer 是 `basicStateReducer`——函数式 action 就调用它，普通值就直接返回。每次更新生成一个含 `lane`、`action`、`eagerState`、`hasEagerState`、`next` 的 update 对象，挂到该 Hook 的 `queue` 上；队列是环形链表，`pending` 指向队尾、`pending.next` 回指队首，尾插 O(1)，遍历时从队首绕一圈到队尾。渲染时 `updateReducer` 从队首逐张重放算出新 state，优先级不够的更新进 `baseQueue`，等下次从 `baseState` 重放。入队时有个 eagerState 优化：队列为空就先算一遍，算出来和当前值相同就 bailout，不调度渲染。批处理上，React 18 的 `createRoot` 是自动批处理，同一事件里的多次 setState 因拿到相同 lane 被合并成一次渲染；React 17 只在合成事件里批处理，setTimeout、Promise、原生事件里不会。最后，每次渲染的 state 是常量快照，异步回调读到的是旧值，所以连续更新要写 `setCount(c => c + 1)`，把计算推迟到渲染阶段用最新状态执行。
