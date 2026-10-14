# useEffect / useLayoutEffect / useMemo / useCallback 原理

## 核心思路

这四个 Hook 表面用途不同，本质是同一套机制的两类应用：`useEffect` 与 `useLayoutEffect` 是「登记一个需要在 commit 后执行的副作用」，`useMemo` 与 `useCallback` 是「根据依赖数组决定是否重新计算」。后者甚至是同一个实现的两种写法。它们共享的关键是三样东西——存在 hook 节点上的**缓存值**、一个**依赖数组**、以及用 `Object.is` 做逐项比较的**浅比较函数** `areHookInputsEqual`。

| Hook | 缓存内容 | 触发重算条件 |
|------|----------|--------------|
| useEffect | effect 对象（create/destroy/deps） | 依赖变化，或首次挂载 |
| useLayoutEffect | effect 对象（同上） | 依赖变化，或首次挂载 |
| useMemo | 计算结果值 | 依赖变化，或首次挂载 |
| useCallback | 函数引用（值就是函数） | 依赖变化，或首次挂载 |

## useEffect 的数据结构

`useEffect` 在 mount 时创建一个 effect 对象，`pushEffect` 把它挂到 `fiber.updateQueue` 的**环形链表**里（`updateQueue.lastEffect` 指向队尾，`lastEffect.next` 指向队首，闭环）。

```typescript
function pushEffect(tag, create, destroy, deps) {
  const effect = { tag, create, destroy, deps, next: null };
  let updateQueue = currentlyRenderingFiber.updateQueue;
  if (updateQueue === null) {
    // 第一个 effect：自己指向自己，形成单节点环
    updateQueue = { lastEffect: null };
    currentlyRenderingFiber.updateQueue = updateQueue;
    updateQueue.lastEffect = effect.next = effect;
  } else {
    // 插到队尾：新节点接上队首，旧队尾指向新节点
    const lastEffect = updateQueue.lastEffect;
    const firstEffect = lastEffect.next;
    lastEffect.next = effect;
    effect.next = firstEffect;
    updateQueue.lastEffect = effect;
  }
  return effect;
}
```

effect 对象字段：

| 字段 | 含义 |
|------|------|
| `tag` | 位标记，标明 effect 类型（被动/布局）与是否本轮需要执行 |
| `create` | 副作用函数，其返回值被当作清理函数 |
| `destroy` | 上一轮 create 返回的清理函数 |
| `deps` | 依赖数组 |
| `next` | 环形链表下一项 |

`tag` 用二进制位组合（各自独占一个位，用 `|` 组合）：

```text
HookPassive   （被动 effect，useEffect 用）
HookLayout    （布局 effect，useLayoutEffect 用）
HookHasEffect （本轮需要执行；不带这个位表示依赖没变、跳过）

示例：pushEffect(HookPassive | HookHasEffect, create, destroy, deps)
```

## 依赖数组的浅比较：决定要不要执行

update 阶段对依赖数组做**逐项 `Object.is` 比较**，只要有一项不相等就认为「变了」。这个函数是 useEffect 和 useMemo/useCallback 共用的：

```typescript
function areHookInputsEqual(nextDeps, prevDeps) {
  for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
    if (Object.is(nextDeps[i], prevDeps[i])) continue; // 这一项没变，继续
    return false;                                       // 有一项变了，直接判定不等
  }
  return true; // 全部相等（或都为空数组）
}
```

`updateEffect` 依据比较结果决定是否给 effect 打 `HookHasEffect`：

```typescript
function updateEffectImpl(fiberFlags, hookFlags, create, deps) {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  let destroy;
  if (currentHook !== null) {
    const prevEffect = currentHook.memoizedState;
    destroy = prevEffect.destroy;      // 把上一轮的清理函数带过来
    if (nextDeps !== null) {
      const prevDeps = prevEffect.deps;
      if (areHookInputsEqual(nextDeps, prevDeps)) {
        // 依赖没变：仍然登记 effect，但不带 HookHasEffect → commit 时跳过执行
        hook.memoizedState = pushEffect(hookFlags, create, destroy, nextDeps);
        return;
      }
    }
  }
  // 依赖变了（或首次）：给 fiber 打标记，并带上 HookHasEffect
  currentlyRenderingFiber.flags |= fiberFlags;
  hook.memoizedState = pushEffect(hookFlags | HookHasEffect, create, destroy, nextDeps);
}
```

由此可以解释常见行为：

| 依赖数组 | 行为 |
|----------|------|
| 不传（`undefined`） | `nextDeps` 为 null，每次渲染都带 HasEffect → 每次都执行 |
| `[]` | 挂载时 `currentHook` 为空，执行一次；之后 `areHookInputsEqual([], [])` 恒为 true → 再也不执行 |
| `[a, b]` | 挂载执行一次；之后任一项 `Object.is` 不等才执行 |

## commit 阶段：先清理，后执行

render 阶段只是登记 effect，真正的执行发生在 commit 阶段。执行顺序是**先执行上一轮的 destroy（清理），再执行本轮的 create**：

```text
commit 阶段
  ↓
遍历 effect 环形链表，挑出带 HookHasEffect 的
  ↓
① 执行上一个 effect 的 destroy   ← 清理旧副作用（如 clearTimeout、解绑监听）
  ↓
② 执行本轮的 create              ← 建立新副作用，其返回值作为下次的 destroy
  ↓
useEffect 的这对操作被放进队列，commit 结束后异步 flush
```

## useEffect 与 useLayoutEffect 的时机差异

两者的登记机制完全一样（同一个 `pushEffect`，只是 tag 用 `HookPassive` 还是 `HookLayout`），区别只在**执行时机**：

| 对比项 | useEffect | useLayoutEffect |
|--------|-----------|-----------------|
| tag | `HookPassive` | `HookLayout` |
| 执行时机 | commit 完成后，被 Scheduler 调度，在浏览器**绘制之后**异步执行（不阻塞绘制） | commit 的 layout 子阶段**绘制前**同步执行 |
| 是否阻塞绘制 | 不阻塞，DOM 已绘制 | 阻塞，会挡住浏览器绘制 |
| 典型用途 | 数据请求、订阅、日志等不依赖布局的副作用 | 读取 DOM 尺寸/位置、同步修改布局防止闪屏 |
| 与 ref 的关系 | DOM 已挂载、ref 已可用 | DOM 已挂载、ref 已可用 |

```text
render → commit
          ├── before mutation（读 DOM 快照，如 getSnapshotBeforeUpdate）
          ├── mutation（真正改 DOM，useEffect 的 destroy 在此阶段先跑）
          └── layout（useLayoutEffect 的 destroy + create 同步执行）
                 ↓ 浏览器绘制
          passive（useEffect 的 destroy + create 异步执行）
```

`useLayoutEffect` 同步执行会阻塞绘制，若其中做耗时计算会让页面卡顿，所以能用 `useEffect` 就别用 `useLayoutEffect`；但需要「先量 DOM 再画」避免闪屏时必须用它。

## useMemo 与 useCallback：缓存值与缓存函数

两者是同一实现，`useCallback` 相当于 `useMemo(() => fn, deps)`——差别只是 useMemo 存的是「函数执行结果」，useCallback 存的是「函数本身」。

```typescript
function mountMemo(nextCreate, deps) {
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const nextValue = nextCreate();          // 首次直接执行
  hook.memoizedState = [nextValue, nextDeps]; // 缓存 [值, 依赖]
  return nextValue;
}

function updateMemo(nextCreate, deps) {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const prevState = hook.memoizedState;
  if (nextDeps !== null) {
    const prevDeps = prevState[1];
    if (areHookInputsEqual(nextDeps, prevDeps)) {
      return prevState[0]; // 依赖没变，直接复用缓存值，不重新计算
    }
  }
  const nextValue = nextCreate();            // 依赖变了才重新算
  hook.memoizedState = [nextValue, nextDeps];
  return nextValue;
}

function updateCallback(callback, deps) {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const prevState = hook.memoizedState;
  if (nextDeps !== null) {
    const prevDeps = prevState[1];
    if (areHookInputsEqual(nextDeps, prevDeps)) {
      return prevState[0]; // 直接返回缓存的函数引用
    }
  }
  hook.memoizedState = [callback, nextDeps];
  return callback;
}
```

## 为什么内联函数/对象会让 React.memo 失效

组件每次渲染，函数体里写的内联函数和对象字面量都是**重新创建的新引用**：

```jsx
function Parent() {
  const [count, setCount] = useState(0);

  // 每次渲染 onClick 都是一个新函数，style 都是一个新对象
  return (
    <Child
      onClick={() => console.log('clicked')}   // 新引用
      style={{ color: 'red' }}                 // 新引用
    />
  );
}

const Child = React.memo(function Child({ onClick, style }) {
  return <button onClick={onClick} style={style}>按钮</button>;
});
```

`React.memo` 默认用 `Object.is` 对 props 做浅比较，而 `onClick` 和 `style` 每次都是新引用，浅比较必然判定「不等」，于是 memo 白做，子组件跟着父组件无意义重渲染。用 `useCallback` 固定函数引用、用 `useMemo` 固定对象引用，就能让浅比较通过、真正拦截更新：

```jsx
function Parent({ color }) {
  const [count, setCount] = useState(0);

  const handleClick = useCallback(() => console.log('clicked'), []);      // 引用稳定
  const style = useMemo(() => ({ color }), [color]);                       // 仅 color 变才新建

  return <Child onClick={handleClick} style={style} />;
}
```

注意：`useMemo`/`useCallback` 本身也有成本（登记 hook、存依赖、做比较），不是「用了就更快」；只有把稳定引用传给 `React.memo` 子组件、或作为其他 Hook 的依赖时才划算。

## 面试答法

`useEffect` 在 mount 时会创建一个含 `tag`、`create`、`destroy`、`deps`、`next` 的 effect 对象，通过 `pushEffect` 挂到 `fiber.updateQueue` 的环形链表里；`tag` 用位标记区分是布局还是被动 effect、以及本轮是否需要执行。update 时用 `areHookInputsEqual` 对依赖数组做逐项 `Object.is` 浅比较，只有某一项变了才带上 `HookHasEffect` 标记，否则依然登记但 commit 时跳过，这就是依赖数组为空只在挂载执行一次、不传依赖每次渲染都执行的本质。commit 阶段挑出带 `HookHasEffect` 的 effect，先跑上一轮的 destroy 再跑本轮的 create；`useEffect` 是被动 effect，在 commit 之后异步 flush、不阻塞绘制，而 `useLayoutEffect` 在 layout 子阶段同步执行、会阻塞绘制，适合读取 DOM 布局。`useMemo` 缓存计算结果、`useCallback` 缓存函数引用，两者实现相同，`useCallback` 相当于 `useMemo` 返回一个函数，都靠依赖比较决定是否重算；内联函数和对象每次渲染都是新引用，会让 `React.memo` 的浅比较失效，用它们把引用稳定下来才能真正拦截子组件的无意义更新，但它们自身也有开销，只在传给 memo 子组件或作为其他 Hook 依赖时才值得用。
