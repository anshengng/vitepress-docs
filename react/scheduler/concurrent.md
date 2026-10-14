# 并发特性

## 核心思路

并发渲染的本质**不是多线程**。JavaScript 仍然单线程，React 没有开辟新线程去渲染。它做的是两件事：

1. **可中断的渲染**：render 阶段可以在工作单元之间让出主线程，把控制权交还给浏览器。
2. **优先级调度**：高优先级更新可以插队，打断正在进行的低优先级渲染。

| 阶段 | 可中断 | 说明 |
|------|--------|------|
| Render（协调） | 是 | 构建 Fiber 树，逐个处理工作单元，`shouldYield` 时暂停续跑、被高优抢占时整体丢弃 |
| Commit（提交） | 否 | 一次性把变更写进 DOM，必须同步完成，不可中断 |

被中断的 render 有两种截然不同的去向，面试里常被混淆：如果是 workerLoop 里 `shouldYield` 为真而**让出主线程**，React 会记住当前 workInProgress 指针，下一帧从断点继续，这属于"暂停续跑"而非重来；只有当**更高优先级的更新到达**、抢占这次低优先级 render 时，已构建的部分才会被整体**丢弃**，稍后用最新状态重新渲染。之所以能安全丢弃，是因为 render 阶段不产生任何对外可见的副作用。

## 紧急更新 vs Transition 更新

| 对比项 | 紧急更新 | Transition 更新 |
|--------|----------|-----------------|
| 典型场景 | 输入框输入、点击反馈 | 搜索结果列表、切换 Tab 内容 |
| 优先级 | SyncLane / DefaultLane 等 | TransitionLanes（低） |
| 可否被打断 | 不被打断，优先执行 | 可被打断、可被丢弃重来 |
| 用户感知 | 必须立刻响应 | 稍慢一点可以接受 |
| 触发方式 | 普通 setState | startTransition / useTransition |

## useTransition 与 startTransition

`startTransition` 是把更新标记为 TransitionLane 的最底层 API：

```typescript
import { useState, useTransition, startTransition } from 'react';

function handleChange(e) {
  const value = e.target.value;

  setInput(value); // 紧急：输入框必须同步跟手
  startTransition(() => {
    setResults(search(value)); // 非紧急：结果列表可以慢半拍
  });
}
```

`useTransition` 在它的基础上多给你一个 `isPending`，用来显示"正在处理中"：

```typescript
function SearchBox() {
  const [input, setInput] = useState('');
  const [results, setResults] = useState([]);
  const [isPending, startTransition] = useTransition();

  function handleChange(e) {
    const value = e.target.value;
    setInput(value);
    startTransition(() => setResults(search(value)));
  }

  return (
    <>
      <input value={input} onChange={handleChange} />
      {isPending && <span>加载中...</span>}
      <List items={results} />
    </>
  );
}
```

要点：

- 返回 `[isPending, startTransition]`，`isPending` 表示这次 Transition 还没提交完。
- `startTransition` 内部同步执行回调，回调里的 setState 会被标记为 TransitionLane。
- 回调必须是同步的（React 18）；React 19 起支持传入 async 函数，`isPending` 会覆盖整个异步过程。

标记之后，`requestUpdateLane` 会给这次更新分配 TransitionLane，`ensureRootIsScheduled` 据此把它调度成可中断的低优先级任务。

## useDeferredValue

有些值不是你自己 setState 产生的，而是**从 props 传进来的**，没法用 `startTransition` 包。这时用 `useDeferredValue`。

```typescript
function SearchResults({ query }) {
  // deferredQuery 是 query 的"延迟版本"
  const deferredQuery = useDeferredValue(query);
  const results = useMemo(() => search(deferredQuery), [deferredQuery]);
  return <List items={results} />;
}
```

它做的事：**先拿旧值渲染，再安排一次低优先级渲染把新值补上**。

| 时刻 | query | deferredQuery | 用户看到 |
|------|-------|---------------|----------|
| 输入瞬间 | 新值 | 仍是旧值 | 输入框立刻更新，结果列表还是旧结果 |
| 后台渲染后 | 新值 | 新值 | 结果列表更新到最新 |

本质是"低优先级重渲染 + 保留旧值"，和 Transition 是同一套底层机制，只是入口不同。

### useTransition vs useDeferredValue

| 对比项 | useTransition | useDeferredValue |
|--------|---------------|------------------|
| 包裹的对象 | 一段 setState 逻辑 | 一个值 |
| 能否拿到 isPending | 能 | 不能，需自己用 `query !== deferredQuery` 判断 |
| 适用场景 | 你知道哪些更新该降级 | 值来自 props，无法改其来源 |
| 底层机制 | 标记 TransitionLane | 同样标记为低优先级 |

## Suspense：抛出 thenable

Suspense 的机制很特别：组件在 render 时如果数据没就绪，就**抛出一个 thenable（Promise）**。

```typescript
// 数据没就绪时，把 Promise 抛出去
function readData(cache, key) {
  if (cache.has(key)) {
    return cache.get(key);
  }
  const promise = fetch(key).then(res => {
    cache.set(key, res);
  });
  promise.status = 'pending';
  cache.set(key, promise);
  throw promise; // 抛出 thenable，交给 React 处理
}
```

React 捕获这个抛出的 Promise 后：

1. 找到最近的 `<Suspense>` 边界，渲染它的 `fallback`。
2. 给这个 Promise 挂上回调，等它 resolve。
3. resolve 后重新渲染那个组件；这次数据已在缓存里，不再抛出，正常渲染。

```typescript
<Suspense fallback={<Spinner />}>
  <Profile userId={id} />
</Suspense>
```

这也是 **`React.lazy` 的原理**：懒加载组件第一次渲染时模块还没到，就抛出一个 Promise，加载完成后再重试渲染。

并发模式下挂起还有个额外好处：**不会丢失已完成的工作和状态**。即使被高优先级更新打断，已提交的 DOM 和组件状态都保留，重试时接着来。

## 高优先级更新如何插队

```text
时间轴 →

低优先级 render（TransitionLane）：
[处理单元 A] → [处理单元 B] → [让出主线程] → ...
                                  │
                                  │  此刻用户输入了字 → 产生 SyncLane 紧急更新
                                  ↓
高优先级 render（SyncLane）：       [立即同步渲染，抢占主线程]
                                  │  完成后提交，输入框立刻更新
                                  ↓
低优先级 render：                   发现已被打断 → 整棵树丢弃 → 用最新状态重新开始
```

要点：

1. **插队**：紧急更新到达时，`ensureRootIsScheduled` 会取消 / 替换掉低优先级的调度，先跑高优先级。
2. **打断与丢弃**：当更高优先级更新抢占时，正在进行的低优先级 render 被整体丢弃、用最新状态重来；而单纯的 `shouldYield` 只是保存 workInProgress 指针、下一帧续跑，等同于"暂停"，并不丢弃已完成的工作。
3. **重启**：被抢占的低优先级更新在之后重新调度，基于最新 state 从头渲染，保证结果正确。

## 面试答法

并发渲染的本质不是多线程，而是可中断的渲染加优先级调度：render 阶段可以在工作单元之间让出主线程，高优先级更新能插队打断正在进行的低优先级渲染，被打断的 render 会被整体丢弃并稍后用最新状态重来，而 commit 阶段必须同步完成、不可中断。startTransition 和 useTransition 用来把非紧急更新标记为 TransitionLane 低优先级，比如搜索结果列表，而输入框这类紧急更新仍然保持高优先级，useTransition 返回 [isPending, startTransition] 方便显示过渡状态；useDeferredValue 是同一套机制的另一入口，它接收一个值并返回延迟版本，先保留旧值渲染、再低优先级补上新值，适合值来自 props、无法用 startTransition 包裹的场景。Suspense 则是靠组件在 render 时抛出 thenable 实现的：React 捕获 Promise 后渲染最近的 fallback，等 resolve 后再重试渲染，React.lazy 就是同一原理，并发模式下挂起不会丢失已完成的 DOM 和组件状态。
