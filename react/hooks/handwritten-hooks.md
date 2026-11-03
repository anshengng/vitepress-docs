# 手写 useState 时，为什么每次渲染都要把 index 清零？

## 从一段抄来的代码说起

我在网上抄了个简化版 `myUseState`，一开始跑得好好的。后来嫌那行 `hookIndex = 0` 多余，随手删了：

```jsx
function Counter() {
  const [count, setCount] = myUseState(0)
  const [flag, setFlag] = myUseState(false)
  // setCount(1) 之后，第二次渲染 count 又变回了 0
  // 状态像是失忆了，明明改过却又读回初始值
}
```

把归零加回去，一切正常。我又手贱把一个 Hook 挪进了 `if` 里，这回不失忆了，换成**串门**：本该是 count 的位置，拿到了 flag 的值。

两个现象看着不一样，根因是同一个：**Hook 只认顺序，不认名字**。所以手写版必须有两样东西——一排带编号的寄存柜，和一只按编号依次开柜的手。全文就用这一排柜子讲完。

## 三个零件：柜子、手、叫号器

| 零件 | 代码里是什么 | 干什么 |
|------|--------------|--------|
| 柜子 | `hooks` 数组 | 跨渲染持久保存每个 Hook 的数据，下标就是柜号 |
| 手 | `hookIndex` 游标 | 每次渲染从 0 号柜开始，开一个往下走一格 |
| 叫号器 | `rerender` 回调 | setter 改完缓存后喊一声"再来一遍"，对应真实 React 的 `scheduleUpdateOnFiber` |

```text
渲染一次组件：
  hookIndex 归零（手回到 0 号柜）
      ↓
  执行组件函数 Component()
      ↓
  每个 Hook 内部：index = hookIndex++ → 用 index 去开 hooks[index]
      ↓                     柜子空 → 新建（mount）  柜里有东西 → 复用（update）
  返回状态 / 登记副作用
      ↓
  setter 被触发 → 改柜子里的东西 → 调 rerender → 回到「hookIndex 归零」重跑
```

## 柜子和手：数据结构

```typescript
// 一个柜子里能放的东西，不同 Hook 只用其中一部分
type Hook = {
  memoizedState: any;                 // 缓存的状态（useState 存值）
  deps?: unknown[];                   // useEffect 的依赖数组
  cleanup?: void | (() => void);      // useEffect 上一轮返回的清理函数
  effect?: () => void | (() => void); // useEffect 的副作用函数
};

// 一排柜子：跨渲染保留，柜号 = Hook 的调用顺序
const hooks: Hook[] = [];

// 那只手：本次渲染已经开到第几号柜，渲染开始前必须回到 0
let hookIndex = 0;

// 叫号器，由渲染入口注入（对应 scheduleUpdateOnFiber）
let rerender: (() => void) | null = null;
```

手和柜子配合起来，就是"顺序定位"的全部秘密：

```text
第一次渲染（mount）：
  hooks = []
  手到 0 号柜 ──→ 柜子是空的 ──→ 新建 hooks[0]
  手到 1 号柜 ──→ 柜子是空的 ──→ 新建 hooks[1]

第二次渲染（update）：
  hooks = [ {state:1}, {deps:[], cleanup:...} ]   ← 上一轮放进去的，还在
  手到 0 号柜 ──→ 命中 hooks[0] ──→ 直接取 memoizedState
  手到 1 号柜 ──→ 命中 hooks[1] ──→ 直接取 deps / cleanup
```

所以只要两次渲染的调用顺序一致，手每次开到的是同一批柜子；顺序一变，就会开到别人的柜子——这也是真实 React 里 Hook 不能写在条件、循环、嵌套函数里的根本原因。

## 核对依赖：逐项浅比较

和真实 React 一样，逐项 `Object.is`：

```typescript
function areHookInputsEqual(nextDeps: unknown[], prevDeps?: unknown[]) {
  if (prevDeps === undefined) return false; // 上次没记条件，一律当作"变了"
  if (prevDeps.length !== nextDeps.length) return false; // 张数不同，直接判不等
  for (let i = 0; i < prevDeps.length; i++) {
    if (Object.is(nextDeps[i], prevDeps[i])) continue; // 这一项没变，看下一项
    return false;                                       // 有一项变了就收工
  }
  return true; // 全部相等
}
```

真实 React 里这个函数不会先比长度（循环条件是 `i < prevDeps.length && i < nextDeps.length`，短的先到头），这里多一行长度判断，是为了让"张数变了"更早短路。

## 手写 myUseState

```typescript
function myUseState(initialState: unknown) {
  const index = hookIndex++;            // 先占住这个柜号，再让手往前走一格
  let hook = hooks[index];

  if (hook === undefined) {
    // 柜子是空的 = 首次挂载：新建柜子并放下初始值（支持惰性初始化函数）
    hook = hooks[index] = {
      memoizedState: typeof initialState === 'function'
        ? (initialState as () => unknown)()
        : initialState,
    };
  }
  // 柜子已经存在 = 更新：此时 memoizedState 就是上一轮存下的值
  // 注意入参 initialState 在更新阶段被彻底忽略，状态来自柜子，不来自参数

  const current = hook;                 // 把柜子固定住，供 setter 闭包长久引用
  const setState = (action: unknown) => {
    // 函数式更新：action 是回调就用柜里的旧值算新值；否则 action 就是目标值
    const nextState = typeof action === 'function'
      ? (action as (prev: unknown) => unknown)(current.memoizedState)
      : action;

    if (Object.is(nextState, current.memoizedState)) return; // 值没变 → 连叫号都省了
    current.memoizedState = nextState;  // 先改柜子
    if (rerender) rerender();           // 再喊一声，重跑组件
  };

  return [hook.memoizedState, setState] as const;
}
```

三个要点：`hookIndex++` 完成了"逐位消费"；`hook === undefined` 就是 mount / update 的分界线；返回的 state 直接取自 `hook.memoizedState`，所以更新阶段读到的是柜里的最新值，而不是又传进来的初始值。

## 手写 myUseEffect

```typescript
function myUseEffect(effect: () => void | (() => void), deps: unknown[]) {
  const index = hookIndex++;            // 同样先占号
  let hook = hooks[index];

  if (hook === undefined) {
    // 首次挂载：建一个空柜子，首轮一定会干活
    hook = hooks[index] = { memoizedState: null };
  }

  const prevDeps = hook.deps;
  if (areHookInputsEqual(deps, prevDeps)) {
    return; // 条件没变 → 本轮跳过，既不拆旧的，也不装新的
  }

  // 条件变了（含首次）：
  // ① 先执行上一轮返回的清理函数（拆旧）
  if (typeof hook.cleanup === 'function') hook.cleanup();
  // ② 再执行本轮 effect，把返回值记成新的清理函数（装新）
  hook.deps = deps;                     // 条件表更新，供下一轮比对
  const cleanup = effect();
  hook.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
}
```

顺序和真实 React 一致：**先 cleanup（旧），再 effect（新）**。依赖是 `[]` 时，`areHookInputsEqual([], [])` 恒为 true，于是只在挂载那次执行。想在"不传依赖"的情况下每次都跑，就让 `prevDeps` 恒为 `undefined`（每次判 `false`）——这正是真实 React 里 `deps === undefined` 时 `nextDeps` 为 null 的效果。

## 渲染入口：手回 0 号柜

```typescript
function render(Component: () => unknown) {
  rerender = () => {
    hookIndex = 0;      // 关键：每次重渲染前，手必须先回到 0 号柜
    Component();        // 重跑组件，Hook 依次开 hooks[0..n]
  };

  hookIndex = 0;        // 首次渲染同样要从头开始
  Component();          // 执行组件
}
```

`hookIndex = 0` 是整份代码里最不能漏的一行。忘了归零，第二次渲染会从上次停下的位置继续往后开柜，`hooks[index]` 全部对不上：要么开空的柜子、状态读回初始值（我开头说的"失忆"），要么开到别人的柜子、值串门。真实 React 里对应的是"每次渲染都从链表头重新走一遍"，同样一步都不能错。

## 跑一遍：状态怎么跨两次渲染活下来

```text
组件定义：
  function Counter() {
    const [count, setCount] = myUseState(0)
    myUseEffect(() => { console.log('effect', count); return () => {} }, [])
    ...
  }

挂载（第一次 render）：
  hookIndex = 0
  myUseState(0)        → 0 号柜空 → 新建，memoizedState = 0
  myUseEffect(fn, [])  → 1 号柜空 → 新建，执行 fn，记下 cleanup

点击按钮 → setCount(1)：
  0 号柜里的 memoizedState 由 0 变成 1
  rerender() 被调用

更新（第二次 render）：
  hookIndex = 0
  myUseState(0)        → 0 号柜已有 → 复用，返回 memoizedState = 1
                         （入参 0 被忽略，返回的是柜里的 1）
  myUseEffect(fn, [])  → 1 号柜已有，[] 与上次的 [] 相等 → 跳过，effect 不重跑
```

这段走下来就验证了两个结论：更新阶段的状态来自**柜子**而不是入参；effect 要不要执行由**依赖浅比较**说了算。

## 和真实 React 差在哪

| 维度 | 简化版 | 真实 React |
|------|--------|------------|
| 状态载体 | 模块级数组 | Fiber 节点 `memoizedState` 上的单/双向结构 |
| 定位方式 | 数组下标 | 链表游标 `workInProgressHook` |
| 分支切换 | `undefined` 判断 | `ReactCurrentDispatcher` 切两套 dispatcher |
| 更新队列 | setter 里直接改值 | update 对象 + 环形 queue + Lane 优先级 |
| 重渲染调度 | 同步重跑组件 | `scheduleUpdateOnFiber` + 并发 / 时间切片 |
| 清理时机 | 同步立即执行 | `useEffect` commit 后异步、`useLayoutEffect` 同步 |
| 多组件 | 只支持一个组件 | 每个 Fiber 各有一份 hook 链 |

简化版只够把**顺序定位**和**依赖比较**两条主线跑通；真实 React 还要扛 Fiber 树、Lane 优先级、时间切片、并发渲染、错误边界，复杂度不在一个量级。

## 面试答法

手写简化版大概是这样：用一个数组持久化各 Hook 的节点，用游标 `hookIndex` 表示本次渲染开到第几个柜子，再加一个重渲染回调。`myUseState` 里先 `hookIndex++` 拿到下标，如果数组该位置没有节点就是挂载，新建并写入初始值（支持惰性初始值函数）；否则就是更新，直接读缓存的 `memoizedState`，所以更新阶段入参会被忽略，返回的是缓存值。返回的 setter 支持函数式更新，算出新值后先 `Object.is` 和旧值比，相同就跳过渲染，不同就写回缓存并调用重渲染回调，对应真实的 `scheduleUpdateOnFiber`。`myUseEffect` 用 `areHookInputsEqual` 对依赖做逐项浅比较，相等就跳过，不等就先执行上一轮的 cleanup、再执行本轮 effect 并把返回值记成新 cleanup，所以空依赖数组只在挂载跑一次。最关键的一点是每次渲染前必须把游标归零，让 Hook 按相同顺序重新定位，否则下标记错位，状态就会张冠李戴。当然这只是帮助理解顺序定位和依赖比较，真实 React 还要处理 Fiber、Lane、时间切片和并发。
