# 并发渲染：单线程怎么做到「做一半先让路」

## 先从一个说不通的地方开始

React 18 之后，文档里到处是「并发渲染」。第一反应通常是：React 终于开多线程了？

可 JavaScript 是单线程的，同一时刻只能跑一段代码，哪来的「同时」？更实际的问题是：页面上既有一个必须跟手的输入框，又有一份可以慢半拍的搜索结果，React 凭什么知道先顾哪个？

把这件事想成一家**只有一个厨师的小馆子**。灶台只有一口，菜只能一道一道做，但这个厨师可以做到两件事：炒到一半先把火关小、抬头看看有没有新客人；以及，听到有人催单时立刻放下手里的活，先去应付那桌。后面所有概念，都套在这个厨房里。

## 「并发」不是多线程，是一个厨师会看火候

React 没有开新线程，它做的是两件事：

1. **可中断的渲染**：render 阶段每处理完一个工作单元，都可以停下来把主线程还给浏览器。
2. **优先级调度**：高优先级的更新可以插队，打断正在进行的低优先级渲染。

但厨房有两条铁律，对应两个阶段：

| 阶段 | 能不能停 | 在厨房里是什么 |
|------|---------|---------------|
| Render（协调） | 能 | 备菜、切配：全在案板上，客人看不见，随时可以停 |
| Commit（提交） | 不能 | 端菜上桌：盘子一旦端出去就不能端到一半，必须一口气放好 |

所以「并发」的准确说法是：**备菜过程可以被切碎、被插队，上菜过程必须一次到底。**

## 被打断有两种结局：放回备菜台，还是整盘倒掉

这是面试里最容易被糊弄过去的一点：被中断的 render 并不是都「重来」，它有两种完全不同的去处。

| 中断原因 | 结局 | 打过的比方 |
|---------|------|-----------|
| workerLoop 里 `shouldYield()` 为真 | 记下当前 `workInProgress` 指针，下一帧从断点继续 | 切到一半把案板放回备菜台，回来接着切 |
| 更高优先级的更新到达，抢占本次渲染 | 已构建的部分整体丢弃，稍后用最新状态重新渲染 | 催单来了，这盘半成品直接倒掉重做 |

注意第二种「倒掉」并不浪费得冤枉——render 阶段只写内存（Fiber 树），不产生任何对外可见的副作用，所以整棵半成品树可以安全扔掉。屏幕上那份已经提交的旧 UI 完全不受影响。

## 哪些单子必须立刻做，哪些可以慢半拍

| 对比项 | 紧急更新 | Transition 更新 |
|--------|----------|-----------------|
| 典型场景 | 输入框输入、点击反馈 | 搜索结果列表、切换 Tab 内容 |
| 优先级 | SyncLane / DefaultLane 等 | TransitionLanes（低） |
| 可否被打断 | 不被打断，优先执行 | 可被打断、可被丢弃重来 |
| 用户感知 | 必须立刻响应 | 稍慢一点可以接受 |
| 触发方式 | 普通 setState | startTransition / useTransition |

输入框里每敲一个字，光标和文字必须当帧跟上，这是「催单」；结果列表晚 100 毫秒出来用户根本察觉不到，这是「慢单」。

## startTransition：给这盘菜挂个「慢单」标签

`startTransition` 是把更新标记成 TransitionLane 的最底层 API：

```typescript
import { useState, useTransition, startTransition } from 'react';

function handleChange(e) {
  const value = e.target.value;

  setInput(value); // 紧急单：输入框必须同步跟手
  startTransition(() => {
    setResults(search(value)); // 慢单：结果列表可以晚一点出炉
  });
}
```

关键在于回调**不是异步执行**的：`startTransition` 会立刻同步跑完这个函数，只是把里面那次 `setState` 打上「慢单」标记。之后 `requestUpdateLane` 会给它分配 TransitionLane，`ensureRootIsScheduled` 再据此把它调度成一个可中断的低优先级任务。

## useTransition：多给你一块「正在做」的牌子

`startTransition` 是纯函数式的入口，拿不到进度。`useTransition` 在它基础上多返回一个 `isPending`：

```typescript
function SearchBox() {
  const [input, setInput] = useState('');
  const [results, setResults] = useState([]);
  const [isPending, startTransition] = useTransition();

  function handleChange(e) {
    const value = e.target.value;
    setInput(value); // 紧急
    startTransition(() => setResults(search(value))); // 慢单
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

三个要点：

- 返回值是 `[isPending, startTransition]`，`isPending` 表示这次 Transition 还没提交完，相当于厨房门口挂的「正在做」的牌子。
- `startTransition` 内部同步执行回调，回调里的 setState 被标记为 TransitionLane。
- 回调在 React 18 里必须是同步的；React 19 起允许传 async 函数，此时 `isPending` 会覆盖整个异步过程。

## 值不是自己 set 的，怎么降级？useDeferredValue

有些值不由你 `setState` 产生，而是**从 props 传进来的**，没法用 `startTransition` 包住那段逻辑。这时换 `useDeferredValue`：

```typescript
function SearchResults({ query }) {
  // deferredQuery 是 query 的"延迟版本"：先拿旧值顶着，新值后台补
  const deferredQuery = useDeferredValue(query);
  const results = useMemo(() => search(deferredQuery), [deferredQuery]);
  return <List items={results} />;
}
```

它做的事就一句话：**先拿旧值渲染，再安排一次低优先级渲染把新值补上**。就像新菜还没出锅，先让客人吃着上一盘，后厨慢慢换。

| 时刻 | query | deferredQuery | 用户看到 |
|------|-------|---------------|----------|
| 输入瞬间 | 新值 | 仍是旧值 | 输入框立刻更新，结果列表还是旧结果 |
| 后台渲染后 | 新值 | 新值 | 结果列表更新到最新 |

它的本质是「低优先级重渲染 + 保留旧值」，和 Transition 是同一套底层机制，只是入口不同：一个是包住一段更新逻辑，一个是包住一个值。

## useTransition 和 useDeferredValue 该挑哪个

| 对比项 | useTransition | useDeferredValue |
|--------|---------------|------------------|
| 包裹的对象 | 一段 setState 逻辑 | 一个值 |
| 能否拿到 isPending | 能 | 不能，需自己用 `query !== deferredQuery` 判断 |
| 适用场景 | 你知道哪些更新该降级 | 值来自 props，无法改其来源 |
| 底层机制 | 标记 TransitionLane | 同样标记为低优先级 |

判断标准很简单：**能改到 setState 就用 useTransition，改不到来源就用 useDeferredValue。**

## 食材还没到：Suspense 先挂个牌子

并发模式下还有第三种「等待」：不是等优先级，而是等数据。Suspense 的机制很特别——组件在 render 时如果数据没就绪，不是返回占位，而是**抛出一个 thenable（Promise）**。

```typescript
// 数据没就绪时，把 Promise 抛出去
function readData(cache, key) {
  if (cache.has(key)) {
    return cache.get(key); // 缓存命中，正常返回
  }
  const promise = fetch(key).then(res => {
    cache.set(key, res); // 请求完成，把结果写回缓存
  });
  promise.status = 'pending';
  cache.set(key, promise); // 先写缓存再抛，否则每次渲染都会新建 Promise
  throw promise;           // 抛出 thenable，交给 React 处理
}

// 使用处：
<Suspense fallback={<Spinner />}>
  <Profile userId={id} />
</Suspense>
```

React 接住这个抛出来的 Promise 后：

1. 找到最近的 `<Suspense>` 边界，渲染它的 `fallback`，相当于先给客人上一张「稍等」的牌子。
2. 给这个 Promise 挂上回调，等它 resolve，也就是留个电话，菜好了叫一声。
3. resolve 后重新渲染那个组件；这次缓存命中、不再抛出，正常渲染。

这也是 **`React.lazy` 的原理**：懒加载组件第一次渲染时模块还没到，就抛出一个 Promise，加载完成后再重试渲染。

并发模式下挂起还有个额外好处：**不会丢失已完成的工作和状态**。即使被高优先级更新打断，已提交的 DOM 和组件状态都保留，重试时接着来，不用从头开火。

## 催单真的来了，时间轴长什么样

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

三条要点：

1. **插队**：紧急更新到达时，`ensureRootIsScheduled` 会取消或替换掉低优先级的调度，先跑高优先级那单。
2. **打断与丢弃**：更高优先级抢占时，正在进行的低优先级 render 被整体丢弃、用最新状态重来；而单纯的 `shouldYield` 只是保存 `workInProgress` 指针、下一帧续跑，属于「暂停」，不丢已完成的工作。
3. **重启**：被抢占的低优先级更新之后会重新调度，基于最新 state 从头渲染，保证结果正确。

## 面试答法

并发渲染的本质不是多线程，而是可中断的渲染加优先级调度：render 阶段处理完一个工作单元就能让出主线程，高优先级更新可以插队打断低优先级渲染。被打断要分两种情况：`shouldYield` 只是暂停、保存 workInProgress 指针下一帧续跑；被高优先级抢占才会整棵树丢弃、稍后用最新状态重来，因为 render 阶段没有可见副作用，丢弃是安全的。commit 阶段必须同步、不可中断。startTransition 和 useTransition 用来把非紧急更新标成 TransitionLane，useTransition 还能拿到 isPending 显示过渡态；useDeferredValue 是同一机制的另一入口，接收一个值并返回延迟版本，先拿旧值渲染再低优先级补新值，适合值来自 props 的场景。Suspense 则靠 render 时抛出 thenable：React 捕获后渲染最近边界的 fallback，给 Promise 挂 ping 回调，resolve 后重试，React.lazy 同理，并发挂起不会丢失已提交的 DOM 和状态。
