# 依赖数组到底在比什么？

## 先说我踩过的坑

第一次用 `useEffect`，我写了这么一段：

```jsx
useEffect(() => {
  console.log('effect 跑了')
})   // 忘了写依赖
```

结果每改一个 state，它就打印一次；加上 `[]` 之后，它又永远只跑第一次，后面想让它响应 `count` 变化都不行了。

同事还说"`useMemo` 不写依赖等于没缓存"，我心想：它到底缓存了个啥？为什么我明明什么都没改，传给子组件的函数还是被当成新的？

这三个问题指向同一套东西：**一个挂在 hook 节点上的任务单，加一张逐项核对的"施工条件表"。**

把组件渲染想成装修：render 阶段只是设计师画图、填任务单，一锤子都不敲；commit 阶段施工队才进场，先拆旧的、再装新的。`useEffect`、`useMemo` 全是这套工地流程里的不同环节，下面都用这一个场景讲。

## 四个 Hook，其实是两类活儿

| Hook | 任务单里存的东西 | 什么时候重新开工 |
|------|------------------|------------------|
| `useEffect` | effect 对象（create / destroy / deps） | 依赖变了，或首次进场 |
| `useLayoutEffect` | effect 对象（同上） | 依赖变了，或首次进场 |
| `useMemo` | 做好的成品（计算结果） | 依赖变了，或首次进场 |
| `useCallback` | 做好的成品（就是那个函数本身） | 依赖变了，或首次进场 |

前两个是"登记一件 commit 之后要干的活"，后两个是"条件没变就直接从仓库把成品搬出来，别重新生产"。它们共享三样东西：节点上的**缓存值**、一张**依赖数组**、以及用 `Object.is` 逐项比对的**浅比较函数** `areHookInputsEqual`。

## 任务单长什么样

`useEffect` 在 mount 时现场捏一张任务单，`pushEffect` 把它挂到 `fiber.updateQueue` 的**环形链表**上：`updateQueue.lastEffect` 指向最后一张，它的 `next` 又指回第一张，跟串小票一个道理。环形是为了两个方向都能 O(1) 够到——队尾直接拿，队首用 `lastEffect.next`。

```typescript
function pushEffect(tag, create, destroy, deps) {
  const effect = { tag, create, destroy, deps, next: null };
  let updateQueue = currentlyRenderingFiber.updateQueue;
  if (updateQueue === null) {
    // 第一张任务单：自己指向自己，先凑成一个单节点的环
    updateQueue = { lastEffect: null };
    currentlyRenderingFiber.updateQueue = updateQueue;
    updateQueue.lastEffect = effect.next = effect;
  } else {
    // 插到队尾：新单接上队首保证环不断，再把 lastEffect 挪到新单
    const lastEffect = updateQueue.lastEffect;
    const firstEffect = lastEffect.next;
    lastEffect.next = effect;
    effect.next = firstEffect;
    updateQueue.lastEffect = effect;
  }
  return effect;
}
```

任务单上记的字段：

| 字段 | 含义 |
|------|------|
| `tag` | 用二进制位打的章，标明这是哪类活、以及本轮要不要干 |
| `create` | 干活的那个函数，它的返回值会被当成"拆除工具"存起来 |
| `destroy` | 上一轮 create 返回的清理函数 |
| `deps` | 施工条件表（依赖数组） |
| `next` | 环形链表下一项 |

`tag` 是位标记，每位管一件事，用 `|` 拼起来：

```text
HookPassive   （被动活，useEffect 用：等交房之后慢慢整）
HookLayout    （布局活，useLayoutEffect 用：交房前必须干完）
HookHasEffect （本轮要干；不带这个位 = 条件没变，跳过）

示例：pushEffect(HookPassive | HookHasEffect, create, destroy, deps)
```

## 施工条件表怎么核对

update 阶段会把新依赖和旧依赖**逐项 `Object.is`** 比一遍。有一项不等就算"条件变了"，全等才算"照原样"。这个函数是 `useEffect` 和 `useMemo`/`useCallback` 共用的：

```typescript
function areHookInputsEqual(nextDeps, prevDeps) {
  // 两张表一起从头对到尾，短的那张先到头就停
  for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
    if (Object.is(nextDeps[i], prevDeps[i])) continue; // 这一项没变，看下一项
    return false;                                      // 有一项变了，直接判定不等
  }
  return true; // 全部相等（或两边都是空数组）
}
```

`updateEffect` 拿到结果决定要不要在本轮任务单上盖 `HookHasEffect` 这个章：

```typescript
function updateEffectImpl(fiberFlags, hookFlags, create, deps) {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  let destroy;
  if (currentHook !== null) {
    const prevEffect = currentHook.memoizedState;
    destroy = prevEffect.destroy;      // 上一轮的清理函数先带着，后面还要还给施工队
    if (nextDeps !== null) {
      const prevDeps = prevEffect.deps;
      if (areHookInputsEqual(nextDeps, prevDeps)) {
        // 条件没变：任务单照登记，但不盖章 → commit 时一眼看到没章就跳过
        hook.memoizedState = pushEffect(hookFlags, create, destroy, nextDeps);
        return;
      }
    }
  }
  // 条件变了（或首次进场）：给 fiber 打标记，任务单上盖 HookHasEffect
  currentlyRenderingFiber.flags |= fiberFlags;
  hook.memoizedState = pushEffect(hookFlags | HookHasEffect, create, destroy, nextDeps);
}
```

于是三种写法的行为一目了然：

| 依赖数组 | 行为 |
|----------|------|
| 不传（`undefined`） | `nextDeps` 为 null，每次渲染都盖章 → 每次都执行 |
| `[]` | 挂载时 `currentHook` 为空，干一次；之后 `areHookInputsEqual([], [])` 恒为 true → 再也不干 |
| `[a, b]` | 挂载干一次；之后任一项 `Object.is` 不等才干 |

## commit 阶段：先拆，后装

render 阶段只填单子，不动手。真正施工在 commit：遍历任务环，只挑盖了 `HookHasEffect` 的那些，**先执行上一轮的 destroy（拆旧），再执行本轮的 create（装新）**。

```text
commit 阶段
  ↓
遍历 effect 环形链表，挑出带 HookHasEffect 的
  ↓
① 执行上一个 effect 的 destroy   ← 拆旧：clearTimeout、解绑监听、取消订阅
  ↓
② 执行本轮的 create              ← 装新：建立副作用，返回值留作下次的 destroy
  ↓
useEffect 的这对操作先进队列，commit 结束后异步 flush
```

顺序不能反：旧的水管不拆，新的接上去会打架（比如两个同名的全局监听器互相覆盖）。

## useEffect 和 useLayoutEffect 差在哪一刻开工

两者的登记机制一模一样，都是 `pushEffect`，只是章不同：`HookPassive` 还是 `HookLayout`。区别只在**什么时候进场**。

| 对比项 | useEffect | useLayoutEffect |
|--------|-----------|-----------------|
| tag | `HookPassive` | `HookLayout` |
| 执行时机 | commit 完成后被 Scheduler 调度，在浏览器**绘制之后**异步执行 | commit 的 layout 子阶段、**绘制之前**同步执行 |
| 是否阻塞绘制 | 不阻塞，DOM 早已画上屏 | 阻塞，会挡住浏览器绘制 |
| 典型用途 | 数据请求、订阅、日志等不依赖布局的副作用 | 读取 DOM 尺寸/位置、同步改布局防闪屏 |
| 与 ref 的关系 | DOM 已挂载、ref 可用 | DOM 已挂载、ref 可用 |

```text
render → commit
          ├── before mutation（读 DOM 快照，如 getSnapshotBeforeUpdate）
          ├── mutation（真正改 DOM；useEffect 的 destroy 也在此阶段先跑）
          └── layout（useLayoutEffect 的 destroy + create 同步执行）
                 ↓ 浏览器绘制
          passive（useEffect 的 destroy + create 异步执行）
```

用装修说就清楚了：`useLayoutEffect` 是"装灯必须在天黑前通电试亮"，试不亮还能马上返工，但如果试灯试了半小时，业主就一直进不了门；`useEffect` 是"交房之后业主自己慢慢收拾"，绝不耽误交付。所以能异步就别同步，只有"先量尺寸再决定怎么画"这种必须卡在绘制前的事才用 `useLayoutEffect`。

## useMemo 与 useCallback：条件没变就直接搬成品

这两个是同一套实现，`useCallback` 相当于 `useMemo(() => fn, deps)`——差别只是仓库里存的东西：`useMemo` 存"生产出来的结果"，`useCallback` 存"生产过程本身（那个函数）"。

```typescript
function mountMemo(nextCreate, deps) {
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const nextValue = nextCreate();             // 首次进场，无条件生产一次
  hook.memoizedState = [nextValue, nextDeps]; // 把成品和条件表一起塞进仓库
  return nextValue;
}

function updateMemo(nextCreate, deps) {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const prevState = hook.memoizedState;
  if (nextDeps !== null) {
    const prevDeps = prevState[1];
    if (areHookInputsEqual(nextDeps, prevDeps)) {
      return prevState[0]; // 条件表没变，直接把仓库里的成品搬出来，不再生产
    }
  }
  const nextValue = nextCreate();             // 条件变了，才重新生产
  hook.memoizedState = [nextValue, nextDeps]; // 新成品重新入库，条件表也更新
  return nextValue;
}

function updateCallback(callback, deps) {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const prevState = hook.memoizedState;
  if (nextDeps !== null) {
    const prevDeps = prevState[1];
    if (areHookInputsEqual(nextDeps, prevDeps)) {
      return prevState[0]; // 同一个函数引用原样发回，引用稳定
    }
  }
  hook.memoizedState = [callback, nextDeps];
  return callback;
}
```

注意 `useCallback` 的"成品"就是函数本身，所以它缓存的是**引用**；引用稳定，下游的浅比较才通得过。

## 为什么内联函数/对象会让 React.memo 白做

组件每渲染一次，函数体里现写的函数和对象字面量都是**崭新的引用**：

```jsx
function Parent() {
  const [count, setCount] = useState(0);

  // 每次渲染，onClick 是一个新函数，style 是一个新对象，地址都变了
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

`React.memo` 默认用 `Object.is` 对 props 做浅比较。`onClick`、`style` 每次都是新引用，浅比较必然判"不等"，memo 就成了白设的门禁，子组件跟着父组件一起重渲染。用 `useCallback` 固定函数引用、`useMemo` 固定对象引用，让比较通过，门禁才真正拦得住：

```jsx
function Parent({ color }) {
  const [count, setCount] = useState(0);

  const handleClick = useCallback(() => console.log('clicked'), []); // 引用永远不变
  const style = useMemo(() => ({ color }), [color]);                 // 只有 color 变才重新生产

  return <Child onClick={handleClick} style={style} />;
}
```

但也别过头：`useMemo`/`useCallback` 自己也有成本（登记 hook、存依赖、逐项比较）。只有把稳定引用传给 `React.memo` 子组件、或作为其他 Hook 的依赖时才划算，否则只是多干了一道手续。

## 面试答法

`useEffect` 在 mount 时创建一个含 `tag`、`create`、`destroy`、`deps`、`next` 的 effect 对象，通过 `pushEffect` 挂到 `fiber.updateQueue` 的环形链表上，`lastEffect` 指向队尾、`lastEffect.next` 回到队首。`tag` 是位标记，区分布局/被动 effect，以及本轮要不要执行。update 时用 `areHookInputsEqual` 对依赖做逐项 `Object.is` 浅比较，只有某一项变了才盖上 `HookHasEffect`；没变也照样登记，只是 commit 时跳过——这就是 `[]` 只跑一次、不传依赖每次都跑的原因。commit 阶段挑出带 `HookHasEffect` 的 effect，先跑上一轮 destroy 再跑本轮 create。`useEffect` 是 passive，commit 之后异步 flush、不阻塞绘制；`useLayoutEffect` 在 layout 子阶段同步执行、会阻塞绘制，适合读 DOM 布局防闪屏。`useMemo` 缓存计算结果、`useCallback` 缓存函数引用，实现相同，都靠依赖比较决定是否重算。内联函数和对象每次渲染都是新引用，会让 `React.memo` 的浅比较失效，用它们把引用稳定下来才能真正拦截子孙组件的无意义更新，但它们自身也有开销，只在传给 memo 子组件或作为其他 Hook 依赖时才值得。
