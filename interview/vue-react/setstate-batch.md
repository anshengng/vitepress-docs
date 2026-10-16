# setState 是同步还是异步

## 题目

> setState 是同步还是异步的？为什么 setState 之后立刻读 this.state 是旧值？React17 和 React18 的批处理有什么区别？flushSync 是干什么的？

## 先纠正问题本身

**"同步还是异步"是个伪命题**——setState 既不是同步更新，也不是异步更新，真正的答案是：

```
setState 的更新会【进入队列】，React 决定什么时候"批处理"触发一次渲染。
你观察到的"读不到新值"，是【批处理】造成的，不是异步回调造成的。

面试第一句话就给结论：
  "它不是同步/异步的问题，是批处理时机的问题"——直接和背题的人拉开差距
```

- state 对象本身没有被"异步赋值"：更新先攒进 update queue，等渲染时统一计算
- 所以"立刻读 this.state 是旧值"≠"异步"，而是"还没渲染，新值还没算出来"

## 核心要点

### 1. React17 批处理范围：合成事件内 batch，之外立即更新

```
场景A：合成事件（React 的 onClick）—— 批处理 ✅
onClick(e) {
  this.setState({a: 1});   →  更新入队，不渲染
  this.setState({b: 2});   →  更新入队，不渲染
  console.log(this.state); // ❌ 旧值 {a:0,b:0}
}                          // 事件处理函数执行完 → 统一触发 1 次渲染 → a=1,b=2 一起生效

场景B：setTimeout / Promise / 原生 DOM 事件 —— 不批处理 ❌
setTimeout(() => {
  this.setState({a: 1});   →  立即同步走一遍"入队+渲染+提交"
  this.setState({b: 2});   →  再来一遍（两次完整渲染！）
  console.log(this.state); // ✅ 已经是新值（因为第一次渲染已同步完成）
}, 0);

时间线对比（同一份代码，不同上下文）：

合成事件:  set → set → log(旧) → [事件结束] → ▓渲染1次▓ → DOM更新
原生/setTimeout: set → ▓渲染1次▓ → set → ▓渲染2次▓ → log(新)

React17 的"异步"假象来自场景A：不是回调排队，而是渲染被推迟到事件结束后统一做
```

- React17 判断是否 batch 靠 `executionContext` 标志位：处于合成事件/生命周期（如 componentDidMount）中才 batch
- 生命周期里 setState 也是 batch 的（首次 mount 除外，那是初始渲染）

### 2. React18：createRoot + Automatic Batching 全场景统一

```jsx
// React18 必须用 createRoot 才有自动批处理
import { createRoot } from 'react-dom/client';
createRoot(document.getElementById('root')).render(<App />);
// 若还用旧 ReactDOM.render，批处理行为退回 React17
```

```
React18 任意上下文：
setTimeout(() => {
  setA(1);  → 入队
  setB(2);  → 入队
  setC(3);  → 入队   ← 原生事件、Promise.then、循环里，统统入队
});                    // 微任务结束后 → 只触发 1 次渲染 ✅ 全场景 batch

对比图：
  场景            React17        React18
  合成事件         batch          batch
  生命周期         batch          batch
  setTimeout/Promise  立即更新 ❌  batch ✅
  原生 DOM 事件       立即更新 ❌  batch ✅
```

### 3. 原理：更新进 queue → 调度一次渲染

```
setState(1) ─┐
setState(2) ─┼──► update 链表（每个组件的 queue）──► 调度调度器(scheduleCallback)
setState(3) ─┘                                          │
                                          当前同步执行栈跑完（微任务边界）
                                                        ▼
                              一次 render：按顺序把 3 个 update 依次算出新 state
                              → diff → commit 更新 DOM → 调 setState 回调

要点：
  ① 多次 setState 只产生 1 次渲染 → 性能收益（这是批处理存在的意义）
  ② 同一批里读 this.state/依赖旧值的 setState 拿到的都是批开始前的值
     setCount(count+1) ×3 只加 1；setCount(c=>c+1) ×3 加 3（函数式基于队列前一项计算）
```

### 4. 为什么 setState 回调 / useEffect 里能拿到新值

```
setState(updater, callback)
              └── callback 在【这次渲染提交完成后】执行
                  此时 fiber 上的 memoizedState 已更新 → 读到新值 ✅

useEffect / useLayoutEffect：在 commit 阶段之后执行 → 天然读到最新 state
"能读到新值的时机" = "渲染已经发生之后"，和同步/异步无关
```

### 5. flushSync 逃生舱 + Vue 对照

```jsx
import { flushSync } from 'react-dom';

flushSync(() => setCount(c => c + 1)); // 强制【同步】完成这次渲染
inputRef.current.select();              // 才能立刻基于新 DOM 操作
// 代价：放弃批处理，flushSync 内的更新单独渲染；别滥用
```

- 典型需求：setState 后马上 `focus()/select()` 依赖新 DOM 的场景
- Vue 对照：Vue 的响应式更新也是异步批处理（nextTick 队列），`await nextTick()` 才能看到更新后的 DOM——思想完全一致，只是触发方式不同（setter 拦截 vs setState）

## 面试答法

### 30 秒版

> 准确说这不是同步异步问题，而是批处理时机问题。setState 的更新先进入组件的 update 队列，React 在当前执行栈结束后统一渲染一次，所以立刻读 this.state 是旧值。React17 只在合成事件和生命周期里批处理，setTimeout、Promise、原生事件里是立即渲染、能读到新值；React18 用 createRoot 后自动批处理覆盖所有场景，任意位置多次 setState 都合并成一次渲染。想立刻拿到新值可以用 setState 回调或 useEffect，因为它们都在渲染提交后执行；想让 DOM 同步更新出来就用 flushSync 强制刷新。Vue 的 nextTick 是同样的异步批处理思想。

### 深入版（被追问时按这条线展开）

1. **先破题**：不是同步/异步，是 batch 时机——给结论再展开
2. **React17 两条时间线**：合成事件内"入队→事件结束统一渲染"，setTimeout 内"每次 setState 各自完整渲染"，解释"读旧值/读新值"的表象差异
3. **React18**：createRoot 启用 automatic batching，全场景合并一次渲染；旧 ReactDOM.render 不享受
4. **原理层**：update 链表 + 调度器 + 微任务边界统一 render；顺带讲 `setCount(count+1)` 三次的坑与函数式更新
5. **新值时机**：setState 回调、useLayoutEffect/useEffect 都在 commit 后执行
6. **逃生舱**：flushSync 强制同步渲染及其代价；收尾对照 Vue nextTick

### 常见追问

- **连续三次 setState 渲染几次？** → React18 同一批内 1 次；React17 若在 setTimeout 里则 3 次
- **为什么同一批里 setState 多次只加一次值？** → 都基于批开始前的 state 计算；用函数式 `c => c+1` 让每次基于队列前一项
- **createRoot 和 render 的区别对批处理的影响？** → 只有 createRoot 走新并发调度，才有 automatic batching
- **flushSync 原理？** → 临时退出批处理模式，同步走完 render+commit，把队列里的更新立刻刷到 DOM
- **Vue 为什么 nextTick 后才能拿 DOM？** → Vue 数据变更也是入队异步批处理（微任务），nextTick 就是等队列 flush 完的回调
