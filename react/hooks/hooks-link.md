# Hooks 为什么存在链表里

## 先说一个每个人都困惑过的点

写函数组件时，第一反应往往是：

```jsx
function Counter() {
  const [count, setCount] = useState(0)
  // 这个函数每次渲染都会重新执行一遍
  // 那 count 为什么不会变回 0？
  return <div>{count}</div>
}
```

`useState(0)` 每次都被调用，按理说每次都该返回 0。但它没有。原因是：**值根本不是"存在函数里"的，函数只是去某个地方"取"了一下。**

那个地方，就是这一篇要讲清楚的东西。

## 状态必须寄存在函数外面

对比一下两种组件的差别：

| | 类组件 | 函数组件 |
|---|---|---|
| 有没有实例 | 有，`new` 出来一个对象一直活着 | 没有，就是普通函数 |
| state 放哪 | `this.state`，实例活着状态就在 | 函数一执行完，栈帧销毁，局部变量全部消失 |
| 每次渲染 | 调 `instance.render()`，实例还是那个实例 | 重新调用函数，等于从头再来一遍 |

所以函数组件必须找一个"活得比函数调用久、而且会跨渲染复用"的容器。React 选的是 **Fiber 节点**——每个函数组件在 React 内部都有一个对应的 Fiber，它在多次渲染之间是复用的。状态就存在 Fiber 的 `memoizedState` 字段上。

一句话：**Fiber 是寄存处，`useState` 是取件码。**

## 一个字段怎么装下多个 Hook？用链表

一个组件往往不止一个 Hook：

```jsx
function Profile() {
  const [name, setName] = useState('')      // 第 1 个 Hook
  const [age, setAge] = useState(18)        // 第 2 个
  const ref = useRef(null)                  // 第 3 个
  useEffect(() => { /* ... */ }, [])        // 第 4 个
  return <div ref={ref}>{name} {age}</div>
}
```

四个 Hook，四份状态，显然不能全塞进一个字段。React 的做法是把 `memoizedState` 变成一个**链表头**，每个 Hook 对应其中一个节点：

```text
Fiber（Profile 组件对应的节点）
  │
  memoizedState
  │
  ▼
[hook#1 useState] ──next──▶ [hook#2 useState] ──next──▶ [hook#3 useRef] ──next──▶ [hook#4 useEffect] ──next──▶ null
```

**关键点：这些节点没有名字。** 只有先后顺序。第 1 个节点属于第一个被调用的 Hook，第 2 个属于第二个……React 完全不认识 `name`、`age` 这些变量名。

### 每个节点里存了什么

节点是一个普通对象，不同 Hook 共用同一个结构，只是用法不同：

```js
{
  memoizedState: ...,   // 这个 Hook 自己的数据
  baseState: ...,       // 更新队列重放时的基准值，先不用管
  baseQueue: ...,       // 被跳过没处理完的低优先级更新
  queue: ...,           // 更新队列（存 setState 推过来的变更 + dispatch 函数）
  next: ...             // 指向下一个 Hook
}
```

`memoizedState` 存什么，取决于 Hook 种类：

| Hook 类型 | `memoizedState` 里放的是 |
|---|---|
| `useState` / `useReducer` | 上一轮渲染后的**状态值** |
| `useRef` | `{ current: xxx }` 这个对象（所以 ref 改值不触发重渲染） |
| `useMemo` | `[计算结果, 依赖数组]` |
| `useEffect` | effect 对象（含回调、依赖、清理函数），并且多用 `next` 串成环形链表 |

> 记住一句话就够了：**每个 Hook 需要的"记忆"，都存在它自己那个节点里。**

## 为什么要用链表，而不是数组？

这是面试常问的追问。理由有两条：

1. **Hook 的数量在编译期根本不知道**。可能有分支、可能有自定义 Hook 内部又套了好几个 Hook，只能边跑边加。链表天然支持"走一步加一个"，不需要预先分配。
2. **和"顺序消费"的模式天然契合**。React 取状态的逻辑就是"从链表头开始，来一个 Hook 就往下走一格"，链表指针干这个事最直观。

数组当然也能做（下标访问），但每次新增要维护长度，且语义上"按顺序流式消费"不如链表自然。真正的原因没那么玄乎：**当初选择了这种数据结构的形态来匹配"按调用顺序取用"的模型**。

## 最关键的一步：靠"游标"取件

React 内部有个变量叫 `workInProgressHook`，可以理解成一个**游标**，渲染开始指向链表头：

```text
渲染开始：游标 = null（还没有 Hook）

调用第 1 个 useState → 游标走到 hook#1，取里面的值
调用第 2 个 useState → 游标走到 hook#2，取里面的值
调用 useRef        → 游标走到 hook#3
...
```

所以 `useState` 内部干的事可以极简化成这样：

```js
function useState(initial) {
  const hook = 取游标指向的那个节点   // 没有就新建
  推进游标到下一个
  return [hook.memoizedState, hook.queue.dispatch]
}
```

`setCount(1)` 调用的那个 `dispatch` 函数，其实就是这段代码时「顺手塞给你的、绑定了这个节点 queue 的回调」。你调它 → 往 `queue` 里推一条 update → 排队一次重渲染 → 下次渲染游标再走到同一个节点时，把队列重放，算出新值。

> 到这里，`useState` 神秘感应该消失了大半：它不过是"按顺序找到自己的柜子，把值读出来，再把更新函数递给你"。

## 首次渲染与后续渲染：两套实现

同一行 `useState` 代码，挂载和更新时的内部逻辑不一样。React 用一个全局变量 `ReactCurrentDispatcher.current` 来决定这次走哪套：

| 模式 | 什么时候用 | 内部行为 |
|---|---|---|
| **mount**（`HooksDispatcherOnMount`） | 第一次渲染，链表还不存在 | 新建节点，追加到链表尾部，初始化状态 |
| **update**（`HooksDispatcherOnUpdate`） | 后续渲染，已有旧链表 | 不新建节点，**顺着旧链表按顺序复用**，把旧值搬过来 |
| **报错版**（`ContextOnlyDispatcher`） | 组件函数执行完之后 | 所有 Hook API 都变成"调用就抛错" |

入口大致是：

```js
function renderWithHooks(current, workInProgress, Component, props) {
  // 有没有旧链表，决定装哪套实现
  ReactCurrentDispatcher.current = (current === null || current.memoizedState === null)
    ? HooksDispatcherOnMount
    : HooksDispatcherOnUpdate;

  currentlyRenderingFiber = workInProgress;
  workInProgress.memoizedState = null;   // 清空后由各个 Hook 边调边重建

  const children = Component(props);     // ← 你的组件函数在这里执行

  // 执行完立刻换成"只会抛错"的实现
  ReactCurrentDispatcher.current = ContextOnlyDispatcher;
  currentlyRenderingFiber = null;
  return children;
}
```

为什么要换成"只会抛错"的版本？因为这样一来，任何在**渲染之外**调用 Hook 的地方（普通事件回调里、`setTimeout` 里、普通函数里）拿到的都是抛错版——React 会立刻报 `Invalid hook call`。这是从机制上堵住误用，而不是靠文档提醒。

更新时的复用逻辑，本质就是"照着旧柜子复制一份新的"：

```js
function updateWorkInProgressHook() {
  // 1. 旧链表上取对应位置的节点（游标上次停在哪，就取它的 next）
  const currentHook = currentHook === null
    ? currentlyRenderingFiber.alternate.memoizedState
    : currentHook.next;

  // 2. 复制一份，值、队列都沿用旧的
  const newHook = {
    memoizedState: currentHook.memoizedState,   // 沿用上一轮的值
    baseState: currentHook.baseState,
    baseQueue: currentHook.baseQueue,
    queue: currentHook.queue,                   // 队列对象直接复用
    next: null,
  };
  // 3. 挂到新 Fiber 的链表尾部，游标推进
  return newHook;
}
```

## 顺序一变，全盘错位

因为节点没有名字、只靠顺序对应，一旦某次渲染的 Hook 调用顺序和上次不同，游标就会"对错柜子"：

```jsx
function Counter({ on }) {
  const [count, setCount] = useState(0)

  if (on) {
    useEffect(() => { /* ... */ }, [])   // ❌ 条件调用，时有时无
  }

  const ref = useRef(null)               // 它的位置会随上面飘
  return <div ref={ref}>{count}</div>
}
```

```text
第一次（on = true），链表建成：
  [0] useState  → count
  [1] useEffect → effect 对象
  [2] useRef    → { current: null }

第二次（on = false）：
  [0] useState  → 正常，还是第 0 个
  [1] useRef    → 游标走到的却是【上次的 useEffect 节点】
                  于是 ref.current 拿到了一个 effect 对象……
```

而且数量变化还会直接报错：Hook 变少是 `Rendered fewer hooks than expected`，变多是 `Rendered more hooks than during the previous render`。

所以官方规则只有两条，本质都是为了保住顺序：

| 规则 | 真正的原因 |
|---|---|
| 只能在组件顶层 / 自定义 Hook 顶层调用 | 条件、循环、嵌套函数会让调用次数不稳定，顺序就对不上 |
| 只能在函数组件或自定义 Hook 内调用 | 否则拿不到正确的 dispatcher 和 Fiber，取不到件 |

`eslint-plugin-react-hooks` 的 `rules-of-hooks` 就是把这套机制约束翻译成编译期检查。

## 自定义 Hook 为什么能复用状态？

搞懂链表后，这个问题自动就通了：

```jsx
function useCounter() {          // 自定义 Hook 只是普通函数
  const [n, setN] = useState(0)  // 它内部的 useState 也是往调用者的链表上追加节点
  return [n, setN]
}

function A() { const [a, setA] = useCounter() }  // 在 A 的链表上占 1 个节点
function B() { const [b, setB] = useCounter() }  // 在 B 的链表上另占 1 个节点
```

自定义 Hook 并没有"自己的状态容器"，它只是**帮你把几个节点有序地插进当前组件的链表**。所以 A 和 B 的状态互不干扰，各自在各自的 Fiber 上。

## 一图收尾

```text
组件函数执行 ──▶ 每遇到一个 Hook 调用
                    │
                    ├─ mount 阶段：往 Fiber.memoizedState 链表尾部【新建】节点
                    └─ update 阶段：游标顺旧链表【复用】节点（值 + queue 沿用）
                                    │
                                    ▼
                        返回 [memoizedState, dispatch]
                                    │
                    setXxx() ──▶ 往该节点的 queue 推 update ──▶ 排队重渲染
                                    │
                                    ▼
                        下次渲染，游标再次走到同一节点，重放队列算出新值
```

## 面试答法

函数组件没有实例，函数执行完局部变量就销毁，所以状态必须外置。React 把它挂在对应 Fiber 的 `memoizedState` 上，多个 Hook 的状态组成一条单向链表，每个节点用 `memoizedState` 存该 Hook 的数据、`queue` 存更新队列、`next` 指向下一个。节点没有名字，React 只能靠**调用顺序**对应，内部用 `workInProgressHook` 游标逐个取：首次渲染由 `HooksDispatcherOnMount` 边调用边新建节点，后续渲染由 `HooksDispatcherOnUpdate` 顺着旧链表复用节点并沿用值和队列；组件函数执行完 dispatcher 会切成只抛错的版本，防止在渲染外调用。正因为定位依赖顺序，Hook 才不能写在条件、循环或嵌套函数里，否则游标错位会让状态张冠李戴，这就是 rules-of-hooks 的根本原因。
