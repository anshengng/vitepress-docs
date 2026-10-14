# Hooks 为什么存在链表里

## 核心思路

类组件的状态存在实例对象 `this.state` 上，渲染时要先 `new` 出一个实例再调用 `render`。函数组件没有实例——它每次渲染本质上就是重新调用一次那个普通函数，调用完函数栈就销毁了。既然函数没有可以承载状态的容器，状态就只能挂在**函数外部**的某个地方。

React 选择的地方是 Fiber 节点。每个函数组件对应一个 Fiber，Hooks 的所有状态都挂在这个 Fiber 的 `memoizedState` 上，整体结构是一条**单向链表**：一个 hook 节点存一份状态，`next` 指向下一个 hook。

为什么是链表而不是数组？因为 Hooks 的数量和种类在编译期无法确定，运行时会随着代码分支动态增减；链表可以按需追加节点，且增删成本与长度无关，天然适合「边渲染边按顺序消费」的游标模型。

| 对比项 | 类组件 | 函数组件 |
|--------|--------|----------|
| 状态载体 | 实例对象 `this` | Fiber 节点的 `memoizedState` |
| 状态形态 | 单个 state 对象 | Hook 单向链表，每个 hook 存一段逻辑 |
| 定位方式 | 属性名 `this.state.xxx` | 调用顺序（游标逐个取） |
| 复用逻辑 | 高阶组件 / render props | 自定义 Hook（本质是链表被复用） |

## 挂在哪里：Fiber.memoizedState

当前正在渲染的 Fiber（`currentlyRenderingFiber`）就是 Hook 状态的宿主。它的 `memoizedState` 指向链表头：

```text
Fiber（函数组件的节点）
  memoizedState ──→ hook#0 ──next──→ hook#1 ──next──→ hook#2 ──next──→ null
                    (useState)        (useEffect)      (useRef)

每次调用一个 Hook，就往链表尾部追加（mount）或顺着游标取用（update）
```

每个 hook 节点是一个对象，字段含义：

| 字段 | 含义 |
|------|------|
| `memoizedState` | 该 Hook 上一轮渲染后的状态值（useState 存值，useRef 存 `{current}`，useMemo 存结果） |
| `baseState` | 基准状态，处理更新队列时用于从头重放的起点 |
| `baseQueue` | 被跳过的低优先级更新组成的队列，等待后续重放 |
| `queue` | 存放 update 的更新队列（useState/useReducer 用，含 `pending`、`dispatch`、`lastRenderedReducer`） |
| `next` | 指向下一个 hook 节点，构成单向链表 |

注意：不同 Hook 复用同一个对象结构，只是字段用法不同。`useState` 用的是 `memoizedState` + `queue`，`useEffect` 用的是 `memoizedState` 存 effect 对象，`useRef` 的 `memoizedState` 就是 `{ current: xxx }`。

## 两套 Dispatcher：mount 与 update

React 并不为每个 Hook 写两套外部 API，而是**同一套 API 内部切换实现**。全局有一个 `ReactCurrentDispatcher.current`，渲染前根据是挂载还是更新给它装不同的实现对象：

| Dispatcher | 使用时机 | 行为 |
|------------|----------|------|
| `HooksDispatcherOnMount` | 首次挂载（current 为 null，或 memoizedState 为 null） | 创建 hook 节点，挂到链表尾部，初始化状态 |
| `HooksDispatcherOnUpdate` | 更新（current 存在） | 不新建节点，顺着旧链表按顺序复用 hook |
| `HooksDispatcherOnRerender` | 因某些原因需要重渲染 | 复用节点但按更严格的规则 |
| `ContextOnlyDispatcher` | 渲染结束后 | 所有 Hook 都变成抛错函数，防止在非渲染期调用 |

渲染入口的选择逻辑（`renderWithHooks` 简化）：

```typescript
function renderWithHooks(current, workInProgress, Component, props) {
  // 判断是挂载还是更新，装配对应的 dispatcher
  ReactCurrentDispatcher.current =
    current === null || current.memoizedState === null
      ? HooksDispatcherOnMount   // 没有旧链表，走挂载
      : HooksDispatcherOnUpdate; // 有旧链表，走更新

  currentlyRenderingFiber = workInProgress;
  workInProgress.memoizedState = null; // 先清空，由各个 Hook 边调边重建

  const children = Component(props);   // 执行函数组件，Hook 在内部被调用

  // 渲染结束后立刻恢复成「只会抛错」的实现
  ReactCurrentDispatcher.current = ContextOnlyDispatcher;
  currentlyRenderingFiber = null;
  return children;
}
```

渲染结束时把 dispatcher 换成 `ContextOnlyDispatcher` 很关键：只要 Hook 在渲染之外被调用（比如普通事件回调里直接调 `useState`），拿到的就是抛错版本，React 立刻报 "Invalid hook call"，从机制上堵住了违规用法。

## 顺序定位：workInProgressHook 游标

update 阶段不复用 Hook 的名字，而是复用一个**游标**顺着链表往下走。mount 时每调一个 Hook 就追加节点并推进游标；update 时每调一个 Hook 就取当前游标指向的旧节点并用它、再推进游标。

```text
mount 阶段：从零开始逐个 append
  workInProgress（新 Fiber）
    memoizedState → [hook0] → [hook1] → [hook2] → null
                     ↑ 游标每创建一个就右移一位

update 阶段：复用 current 上已有的链表，逐个读取
  current.memoizedState  → [hook0] → [hook1] → [hook2] → null
                                 ↑ currentHook / nextCurrentHook 双指针
  workInProgress（新 Fiber）→ [hook0'] → [hook1'] → [hook2'] → null
                                 ↑ workInProgressHook
```

update 时创建新 hook 节点的核心逻辑（`updateWorkInProgressHook` 简化，体现「复用旧值 + 复制队列」）：

```typescript
function updateWorkInProgressHook() {
  // 1. 先取 current 上对应的旧 hook
  let nextCurrentHook;
  if (currentHook === null) {
    const current = currentlyRenderingFiber.alternate;
    nextCurrentHook = current !== null ? current.memoizedState : null;
  } else {
    nextCurrentHook = currentHook.next; // 顺着旧链表往下
  }
  currentHook = nextCurrentHook;

  // 2. 基于旧 hook 复制出一份新 hook，挂到新 Fiber 的链表上
  const newHook = {
    memoizedState: currentHook.memoizedState, // 沿用上一轮的值
    baseState: currentHook.baseState,
    baseQueue: currentHook.baseQueue,
    queue: currentHook.queue,                 // 队列对象复用，update 都记在这里
    next: null,
  };
  // ...挂到 workInProgress 链表尾部并推进游标
  return newHook;
}
```

关键点全在「按调用顺序逐个取」：链表本身没有名字字段，React 也不知道某个节点属于哪个 `useState`，它只知道「这是本轮渲染的第 2 个 Hook」。所以只要每次渲染的调用顺序完全一致，第 2 个 Hook 每次都能对应到同一个节点。

## 顺序错乱的后果：张冠李戴

一旦某次渲染的调用顺序和上一次不同，游标就会对错位，把 A 的状态当成了 B 的：

```jsx
function Counter({ on }) {
  // 正确：三个 Hook 顺序固定，永远第 0、1、2 个
  const [count, setCount] = useState(0);

  // 错误：条件调用 Hook
  if (on) {
    // 当 on 从 true 变 false，这个 useEffect 消失，
    // 后面的 useRef 就从「第 2 个」变成了「第 1 个」，
    // 于是它读到了本该属于 useEffect 的节点 → 状态错位
    useEffect(() => { /* ... */ }, []);
  }

  const ref = useRef(null);
  return <div ref={ref}>{count}</div>;
}
```

```text
on = true 时（第一次渲染，链表建成）：
  [0] useState   → count 节点
  [1] useEffect  → effect 节点
  [2] useRef     → ref 节点

on 变为 false 时（第二次渲染）：
  [0] useState   → 正常命中第一个节点
  [1] useRef     → 本该是第 2 个节点(useRef)，却命中链表的第 1 个(effect 节点)
                    → ref 拿到了 effect 对象，语义完全错位
```

同理，在 `for` 循环或嵌套函数里调用 Hook 也会导致数量或顺序不稳定，触发 React 报 "Rendered fewer hooks than expected" 或 "Rendered more hooks than during the previous render"。

React 官方用 `eslint-plugin-react-hooks` 的 `rules-of-hooks` 规则，在编译期强制两条约束：

| 规则 | 原因 |
|------|------|
| 只在组件顶层或自定义 Hook 顶层调用 | 保证顺序稳定，不随分支/循环变化 |
| 只在函数组件或自定义 Hook 中调用 | 保证能拿到正确的 dispatcher 与 Fiber |

## 面试答法

函数组件没有实例，所以状态不能放在 `this` 上，React 把 Hook 状态挂在对应 Fiber 节点的 `memoizedState` 上，组织成一条单向链表，每个节点存 `memoizedState`、`baseState`、`queue` 和 `next`。渲染时通过 `ReactCurrentDispatcher.current` 切换两套实现：mount 用 `HooksDispatcherOnMount`，边调用边创建节点追加到链表尾部；update 用 `HooksDispatcherOnUpdate`，不新建节点而是顺着旧链表按顺序复用。因为链表节点没有名字，React 是靠「本次渲染调用的第几个 Hook」这个调用顺序来定位的，update 时用 `workInProgressHook` 游标逐个取，所以只要每次渲染的调用顺序完全一致，同一个位置的 Hook 就一定对应同一个节点。这就直接解释了为什么 Hooks 不能写在条件判断、循环或嵌套函数里——顺序一旦错位，状态就会张冠李戴，这也是 `eslint-plugin-react-hooks` 强制顶层调用规则的根本原因。
