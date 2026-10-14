# 手写简化版 useState 与 useEffect

## 核心思路

前面的原理篇讲清了 Hooks 存链表、按调用顺序定位、靠依赖比较决定是否执行。这里用一个简化实现把这些机制「落地」，帮助把抽象讲具体。简化版抓住三个关键点即可跑通：

1. **一份持久化的 hook 存储**：这里用一个数组 `hooks` 代替 Fiber 上的链表，下标即 Hook 的调用顺序位置。
2. **一个游标 `hookIndex`**：每次渲染开始前归零，每调用一个 Hook 就 `+1`，用下标去取/存对应的 hook——这就是「按顺序定位」。
3. **两套分支（mount / update）**：下标处没有 hook 就是挂载（新建并初始化），已有 hook 就是更新（复用缓存值）。
4. **一个重渲染回调**：setter 改完状态后调用它重跑组件，对应真实 React 的 `scheduleUpdateOnFiber`。

```text
渲染一次组件：
  hookIndex 归零
      ↓
  执行组件函数 Component()
      ↓
  每个 Hook 内部：index = hookIndex++ → 用 index 取 hooks[index]
      ↓                     没有 → 新建（mount）  有 → 复用（update）
  返回状态/副作用
      ↓
  setter 被触发 → 改缓存 → 调用 rerender → 回到「hookIndex 归零」重跑
```

## 数据结构与游标

```typescript
// 每个 Hook 在下标位置存一份自己的节点
type Hook = {
  memoizedState: any;               // 缓存的状态（useState 存值）
  deps?: unknown[];                 // useEffect 的依赖数组
  cleanup?: void | (() => void);    // useEffect 上一轮返回的清理函数
  effect?: () => void | (() => void); // useEffect 的副作用函数
};

// 持久化存储：跨渲染保留，下标 = Hook 的调用顺序
const hooks: Hook[] = [];

// 游标：本次渲染消费到第几个 Hook，渲染开始前必须归零
let hookIndex = 0;

// 触发重渲染的回调，由渲染入口注入（对应 scheduleUpdateOnFiber）
let rerender: (() => void) | null = null;
```

游标与数组的配合方式，正是「顺序定位」的简化版：

```text
第一次渲染（mount）：
  hooks = []
  index 0 ──→ 无 hook ──→ 新建 hooks[0]
  index 1 ──→ 无 hook ──→ 新建 hooks[1]

第二次渲染（update）：
  hooks = [ {state:1}, {deps:[], cleanup:...} ]   ← 上一轮建的，保留着
  index 0 ──→ 命中 hooks[0] ──→ 复用其 memoizedState
  index 1 ──→ 命中 hooks[1] ──→ 复用其 deps / cleanup
```

## 依赖比较：浅比较

和真实 React 一样，用逐项 `Object.is` 比较依赖数组：

```typescript
function areHookInputsEqual(nextDeps: unknown[], prevDeps?: unknown[]) {
  if (prevDeps === undefined) return false; // 上次没有依赖记录，视为「变化」
  if (prevDeps.length !== nextDeps.length) return false; // 长度不同直接判不等
  for (let i = 0; i < prevDeps.length; i++) {
    if (Object.is(nextDeps[i], prevDeps[i])) continue; // 这一项没变
    return false;                                       // 有一项变了
  }
  return true; // 全部相等
}
```

## 手写 myUseState

```typescript
function myUseState(initialState: unknown) {
  const index = hookIndex++;            // 先占位，再让游标前进
  let hook = hooks[index];

  if (hook === undefined) {
    // 挂载：首次创建 hook 并存入初始 state（支持惰性初始值函数）
    hook = hooks[index] = {
      memoizedState: typeof initialState === 'function'
        ? (initialState as () => unknown)()
        : initialState,
    };
  }
  // 更新：hook 已存在，此时的 hook.memoizedState 就是上一轮缓存的值
  // 注意参数 initialState 在更新阶段被完全忽略，状态来自缓存而非参数

  const current = hook;                 // 固定引用，供 setter 闭包使用
  const setState = (action: unknown) => {
    // 函数式更新：action 是回调时用旧值算新值，否则 action 就是目标值
    const nextState = typeof action === 'function'
      ? (action as (prev: unknown) => unknown)(current.memoizedState)
      : action;

    if (Object.is(nextState, current.memoizedState)) return; // 值没变 → 跳过渲染
    current.memoizedState = nextState;  // 更新缓存
    if (rerender) rerender();           // 触发重渲染
  };

  return [hook.memoizedState, setState] as const;
}
```

三个要点：`hookIndex++` 完成逐位消费；`hook === undefined` 区分 mount/update；返回的 state 直接取自 `hook.memoizedState`，所以更新阶段读到的是缓存的最新值，而不是传入的初始值。

## 手写 myUseEffect

```typescript
function myUseEffect(effect: () => void | (() => void), deps: unknown[]) {
  const index = hookIndex++;
  let hook = hooks[index];

  if (hook === undefined) {
    // 挂载：创建 hook 节点（首轮一定会执行 effect）
    hook = hooks[index] = { memoizedState: null };
  }

  const prevDeps = hook.deps;
  if (areHookInputsEqual(deps, prevDeps)) {
    return; // 依赖没变 → 本轮跳过，不清理也不重跑
  }

  // 依赖变了（含首次）：
  // ① 先执行上一轮返回的清理函数
  if (typeof hook.cleanup === 'function') hook.cleanup();
  // ② 再执行本轮 effect，把返回值记为新清理函数
  hook.deps = deps;
  const cleanup = effect();
  hook.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
}
```

执行顺序遵循真实 React：**先 cleanup（旧），再 effect（新）**。依赖数组为空数组 `[]` 时，`areHookInputsEqual([], [])` 恒为 true，因此只在挂载那次执行；不传 deps 的场景可让 `prevDeps` 恒为 undefined，令每次渲染都判为「变化」。

## 渲染入口：游标归零 + 注入重渲染

```typescript
function render(Component: () => unknown) {
  rerender = () => {
    hookIndex = 0;      // 关键：每次重渲染前游标必须归零
    Component();        // 重新执行组件函数，Hook 依次消费 hooks[0..n]
  };

  hookIndex = 0;        // 首次渲染同样归零
  Component();          // 执行组件
}
```

`hookIndex = 0` 是重中之重：如果忘了归零，第二次渲染会从上次的位置继续消费，`hooks[index]` 全部对不上，状态彻底错乱——这与真实 React 里「每次渲染都要从头按顺序遍历链表」是同一个道理。

## 跑一遍：状态如何在两次渲染间流转

```text
组件定义：
  function Counter() {
    const [count, setCount] = myUseState(0)
    myUseEffect(() => { console.log('effect', count); return () => {} }, [])
    ...
  }

挂载（第一次 render）：
  hookIndex = 0
  myUseState(0)        → index 0，hooks[0] 不存在 → 新建，memoizedState = 0
  myUseEffect(fn, [])  → index 1，hooks[1] 不存在 → 新建，执行 fn，记下 cleanup

点击按钮 → setCount(1)：
  current.memoizedState 由 0 变 1
  rerender() 被调用

更新（第二次 render）：
  hookIndex = 0
  myUseState(0)        → index 0，hooks[0] 已存在 → 复用，返回 memoizedState = 1
                         （注意：参数 0 被忽略，返回的是缓存里的 1）
  myUseEffect(fn, [])  → index 1，[] 与上次 [] 相等 → 跳过，effect 不重跑
```

这段流程同时演示了两个核心结论：更新阶段状态来自**缓存**而非入参；effect 是否执行由**依赖浅比较**决定。

## 与真实 React 的差距

| 维度 | 简化版 | 真实 React |
|------|--------|------------|
| 状态载体 | 模块级数组 | Fiber 节点 `memoizedState` 上的单/双向结构 |
| 定位方式 | 数组下标 | 链表游标 `workInProgressHook` |
| 分支切换 | `undefined` 判断 | `ReactCurrentDispatcher` 切两套 dispatcher |
| 更新队列 | 直接改值 | update 对象 + 环形 queue + Lane 优先级 |
| 重渲染调度 | 同步重跑组件 | `scheduleUpdateOnFiber` + 并发/时间切片 |
| 清理时机 | 同步立即执行 | `useEffect` commit 后异步、`useLayoutEffect` 同步 |
| 多组件 | 只支持一个组件 | 每个 Fiber 各有一份 hook 链 |

简化版只够理解**顺序定位**与**依赖比较**这两条主线，真实 React 还要处理 Fiber 树、Lane 优先级、时间切片、并发渲染、错误边界等，复杂度高得多。

## 面试答法

如果让我手写简化版，我会用一个数组持久化保存各个 Hook 的节点、一个游标 `hookIndex` 表示当前渲染消费到第几个 Hook，再加一个重渲染回调。`myUseState` 里先 `hookIndex++` 拿到下标，如果数组该位置没有节点就是挂载、新建并写入初始值，否则就是更新、直接读缓存的 `memoizedState`——所以更新阶段参数会被忽略，返回的是缓存值；返回的 setter 支持函数式更新，算出新值后用 `Object.is` 和旧值比较，相同就跳过渲染，不同就更新缓存并调用重渲染回调，对应真实的 `scheduleUpdateOnFiber`。`myUseEffect` 则用 `areHookInputsEqual` 对依赖数组做逐项 `Object.is` 浅比较，相等就跳过，不等就先执行上一轮返回的 cleanup、再执行本轮 effect 并把返回值记为新 cleanup，空依赖数组因此只在挂载执行一次。最关键的一点是每次渲染前必须把游标归零，保证 Hook 按相同顺序被重新定位，否则下标错位、状态就会张冠李戴。当然这只是帮助理解顺序定位和依赖比较，真实 React 还要处理 Fiber、Lane 优先级、时间切片和并发，机制复杂得多。
