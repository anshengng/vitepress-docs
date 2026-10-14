# 为什么要从 Stack Reconciler 改成 Fiber

## Stack Reconciler：从根开始的同步递归

React 15 及以前使用的协调器叫 **Stack Reconciler**。一次 `setState` 或 `ReactDOM.render` 之后，它会从根节点出发，递归遍历整棵虚拟 DOM 树，在每个节点上完成 diff、生成真实 DOM 并提交。

```javascript
// Stack Reconciler 的思路：一次性递归完整棵树
function reconcile(element, node) {
  // 1. 处理当前节点：diff props、复用或创建组件实例
  updateNode(element, node)
  // 2. 递归处理每一个子节点（函数调用不断压栈，中途没有机会让出主线程）
  element.children.forEach(child => reconcile(child, node))
}
```

这段递归一旦进入，就必须沿着调用栈一路执行到叶子节点，再逐层返回。它的行为特征可以概括为四点：

| 特征 | 说明 |
|------|------|
| 同步 | 整棵树的处理占用同一段主线程时间，中途不返回 |
| 不可中断 | 没有把控制权交还给浏览器的机会 |
| 不可恢复 | 没有保存中间进度的地方，被打断就只能重来 |
| 优先级单一 | 所有更新一视同仁，无法让紧急更新插队 |

组件树越大、层级越深，这一次同步递归的耗时就越长。这段时间里浏览器既不能响应点击、输入，也不能刷新下一帧，用户感知到的就是卡顿和掉帧。

## 16.7ms：一帧的预算

浏览器通常以约 60fps 渲染画面，一帧的时间预算大约是 `1000ms ÷ 60 ≈ 16.7ms`。在这一帧里，浏览器还要做很多事：

```text
一帧约 16.7ms 的时间预算
┌────────────────────────────────────────────┐
│ 处理输入事件 │  JS 执行（含 React 同步渲染） │
├────────────────────────────────────────────┤
│ requestAnimationFrame 回调                 │
├────────────────────────────────────────────┤
│ 样式计算 → 布局(layout) → 绘制(paint) → 合成 │
└────────────────────────────────────────────┘
JS 执行一旦超出预算，后面的布局、绘制就被推迟 → 掉帧
```

如果 React 一次同步递归耗时 100ms，就相当于连续约 6 帧被占满，页面直接"卡死"。所以核心诉求很明确：**必须把渲染工作切成一个个小块，每块做完就交还主线程，让浏览器有机会响应交互和绘制**。这项技术后来被称为时间切片（time slicing）。

## Fiber 的本质：可中断的工作单元

Fiber 这个名字包含两层含义：

1. **它是一个工作单元（work unit）**：整棵树的渲染工作被拆散到一个个 Fiber 节点上，每处理完一个 Fiber 就是一个可暂停的切点。
2. **它是一次数据结构改造**：把原本依赖引擎调用栈的递归，改写为用 `child` / `sibling` / `return` 三根指针手动遍历的链表。递归靠 JS 调用栈，Fiber 则用自己维护的链表**模拟调用栈**，因此可以在任意时刻保存当前进度、暂停、稍后从断点继续。

一句话总结：Fiber 把"一口气算完"的递归渲染，拆成了"可中断、可恢复、可跳过、可指定优先级"的增量渲染。

| 核心诉求 | Fiber 的满足方式 |
|---------|-----------------|
| 可中断 | 每个 Fiber 是一个工作单元，处理完可保存现场并让出主线程 |
| 可恢复 | 用 child/sibling/return 指针记录"下一个该处理谁"，随时继续 |
| 可跳过 | 命中 bailout 的子树直接复用旧结果，不再向下遍历 |
| 优先级 | 每个 Fiber 携带 lanes 优先级，高优先级更新可打断低优先级 |
| 不丢状态 | 用 alternate 双缓冲保留前一棵树，切换时界面不闪断 |

## Fiber 节点的关键字段

Fiber 节点就是上面说的"工作单元"的载体，字段可以分成"描述身份""维护结构""记录状态"几类：

| 字段 | 作用 |
|------|------|
| `tag` | 节点类型：FunctionComponent / ClassComponent / HostComponent 等 |
| `type` | 元素类型：函数组件本身、`'div'` 等宿主标签、类组件构造函数 |
| `key` | 协调时的身份标识，决定同层节点能否复用 |
| `child` | 指向第一个子 Fiber |
| `sibling` | 指向下一个兄弟 Fiber |
| `return` | 指向父 Fiber（处理完向上返回） |
| `alternate` | 指向另一棵树上的对应节点（双缓冲） |
| `stateNode` | 宿主节点对应的真实 DOM，或类组件/根节点的实例 |
| `memoizedProps` | 上一次渲染使用的 props |
| `memoizedState` | 上一次渲染的 state（函数组件里指向 Hook 链表头） |
| `updateQueue` | 待处理的更新队列（如 `setState` 产生的更新） |
| `flags` | 副作用标记位，如 Placement、Update、Deletion |
| `lanes` | 当前节点上待处理更新的优先级 |

`memoizedProps` 与 `pendingProps` 配对：前者是"上次渲染用的"，后者是"本次要用新 props 填充的"，两者的比对结果直接决定要不要打 `didReceiveUpdate` 标记。

## child / sibling / return：用链表模拟调用栈

递归遍历天然有"进入子节点（压栈）"和"回到父节点（出栈）"两个动作。Fiber 用三根指针把它们显式表达出来：

```text
                App
                 │
        child ↓  │  ↑ return
              ┌──▼───────────┐
              │              │
           Header ──sibling──► Main ──sibling──► Footer
              │
        child ↓  ↑ return
              │
            Title

向下：child    进入第一个子节点（等价于递归"压栈"）
横向：sibling  移到下一个兄弟节点（同级继续遍历）
向上：return   处理完回到父节点（等价于递归"出栈"）
```

遍历规则（`performUnitOfWork` / `workLoopSync` 的核心）在源码里表现为：

```javascript
// 简化的 workLoop：循环 + 三指针，替换掉递归
function workLoop() {
  while (workInProgress !== null) {
    workInProgress = performUnitOfWork(workInProgress)
  }
}

function performUnitOfWork(fiber) {
  // 1. beginWork：向下处理，创建/复用子 Fiber
  const next = beginWork(fiber)
  if (next !== null) return next            // 有子节点 → 向下 child
  // 2. 没有子节点，走 completeWork 向上收尾
  let completed = fiber
  while (completed !== null) {
    completeWork(completed)
    if (completed.sibling !== null) return completed.sibling  // 向兄弟 sibling
    completed = completed.return                                // 向上 return
  }
  return null
}
```

这段循环每一轮只处理一个 Fiber，因此可以在两轮之间检查是否有更高优先级任务、是否超出时间切片预算，从而决定是否让出主线程。这正是"可中断"的来源。

## 为什么 requestIdleCallback 不够用

一个自然的想法是：既然要利用空闲时间，浏览器不是提供了 `requestIdleCallback` 吗？React 团队最终选择自研 Scheduler，原因有三：

| 问题 | 具体表现 |
|------|---------|
| 兼容性 | 早期 Safari、部分浏览器长期不支持，需要 polyfill |
| 频率不可控 | 空闲回调触发频率不稳定，只有 20ms 级别的颗粒度，难以保证 60fps |
| 无优先级语义 | 只能拿到一个剩余时间，无法表达"用户输入 > 动画 > 数据渲染" |
| 无法抢占 | 多任务间没有让位（yield）与抢占机制，做不到高优任务打断低优任务 |

因为浏览器原生 API 无法同时给出"稳定的调度时机 + 优先级 + 抢占能力"，React 自己实现了一套调度器：用 `MessageChannel` 做宏任务让位，用超时时间片做时间切片，用 lanes 做优先级。这套 Scheduler 是下一篇的主线。

## Stack Reconciler vs Fiber Reconciler

| 对比项 | Stack Reconciler（React 15） | Fiber Reconciler（React 16+） |
|--------|------------------------------|-------------------------------|
| 遍历方式 | 递归调用栈 | child/sibling/return 链表循环 |
| 能否中断 | 不能，必须一次跑完 | 能，每个 Fiber 处理完可暂停 |
| 能否恢复 | 不能，只能重头再来 | 能，指针记录断点继续 |
| 优先级 | 无 | lanes 多级优先级，可插队 |
| 时间切片 | 无 | 有时间片预算，超预算即让出 |
| 副作用收集 | 递归回溯时顺带完成 | 由 completeWork 冒泡收集到根 |
| 界面一致性 | —— | alternate 双缓冲，不显示半成品树 |
| 落地代表 | React 15 | React 16 / 17 / 18 / 19 |

## 面试答法

React15 及之前的 Stack Reconciler 用的是同步递归，从根节点开始一路递归完整棵虚拟 DOM 树，调用栈一旦入栈就必须执行到底，中途没法把主线程让给浏览器，组件树一大就会长时间占满主线程导致掉帧——毕竟浏览器一帧只有约 16.7ms 的预算。所以 React 要解决的核心问题，就是把渲染工作拆成一个个可中断、可恢复、可跳过的单元，也就是时间切片。Fiber 的本质就是这个工作单元：它同时是一种数据结构改造，用 child、sibling、return 三根指针把递归改成循环遍历，用链表模拟调用栈，这样就能在任意时刻保存进度、暂停、稍后从断点继续。每个 Fiber 节点还带 alternate 双缓冲、stateNode、memoizedProps、memoizedState、updateQueue、flags 与 lanes 等字段，分别负责界面一致性、节点身份、状态复用、副作用标记和优先级。至于为什么不用浏览器的 requestIdleCallback，因为它兼容性差、触发时机不可控、也没有优先级和抢占语义，React 只能自研 Scheduler。
