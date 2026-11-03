# 为什么 React 15 那套递归非换掉不可

## 一次点击，为什么半秒没反应

长列表里点一下"加载更多"，`setState` 一执行，页面就定住半秒。这半秒里输入框敲字不回显、按钮点不动、滚动也卡住。问题很自然就出来了：我只加了一行数据，凭什么整个页面陪着我卡？

因为 React 15 的更新是**从根节点一路同步递归到叶子**的。它开始之后就没打算中途把主线程还给你。

## 打个比方：一个不肯被打断的厨师

Stack Reconciler 像一位闷头做菜的厨师：接到单子就从第一道做到最后一道，中间来了新订单、客人催菜，一概不理，因为手上这道菜没做完，锅就腾不出来。

Fiber 做的事，就是把"一桌菜"拆成一道一道工序：每做完一道就抬头看一眼——有没有加急单？要不要先插进去？时间不够了就先歇手，等会儿接着做。

后面几个概念都能套进这个比方：

| 概念 | 在"后厨"里是什么 |
|------|-----------------|
| Fiber 节点 | 一张工序卡，一道菜的最小单位 |
| `child` / `sibling` / `return` | 工序流转的三根线：下一步做子工序、做完做兄弟工序、都做完交回上道工序 |
| `workInProgress` | 手上正在做、或下一张要做的那张工序卡 |
| `alternate` | 旁边的半成品台面，新菜在上面拼，拼好才端出去 |
| `lanes` | 加急等级，VIP 的单可以插队 |

## Stack Reconciler 是怎么写的

React 15 及以前用的协调器叫 **Stack Reconciler**。一次 `setState` 或 `ReactDOM.render` 之后，它从根节点出发，递归遍历整棵虚拟 DOM 树，在每个节点上完成 diff、生成真实 DOM 并提交。

```javascript
// Stack Reconciler 的思路：一口气递归完整棵树
function reconcile(element, node) {
  // 1. 处理当前节点：diff props、复用或创建组件实例
  updateNode(element, node)
  // 2. 递归处理每一个子节点
  //    函数调用不断压栈，这中间没有任何"让出主线程"的机会
  element.children.forEach(child => reconcile(child, node))
}
```

这段递归一旦进入，就必须沿调用栈执行到叶子节点，再逐层返回。行为特征可以概括成四条：

| 特征 | 说明 |
|------|------|
| 同步 | 整棵树的处理占用同一段主线程时间，中途不返回 |
| 不可中断 | 没有把控制权交还给浏览器的机会 |
| 不可恢复 | 没有保存中间进度的地方，被打断就只能重来 |
| 优先级单一 | 所有更新一视同仁，无法让紧急更新插队 |

组件树越大、层级越深，这一次同步递归耗时就越长。这段时间浏览器既不能响应点击、输入，也不能刷新下一帧，用户感知到的就是卡顿和掉帧。

## 一帧只有 16.7ms

浏览器通常以约 60fps 渲染画面，一帧的时间预算大约是 `1000ms ÷ 60 ≈ 16.7ms`。这一帧里还要干很多事：

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

如果 React 一次同步递归耗时 100ms，相当于连续约 6 帧被占满，页面看起来就是"卡死"了。诉求因此很明确：**必须把渲染工作切成小块，每块做完就交还主线程，让浏览器有机会响应交互和绘制**。这项技术后来叫时间切片（time slicing）。

## Fiber 这个名字的两层意思

1. **它是一个工作单元（work unit）**：整棵树的渲染工作被拆散到一个个 Fiber 节点上，每处理完一个 Fiber 就是一个可暂停的切点——一道工序做完，可以抬头看单。
2. **它是一次数据结构改造**：把原本依赖引擎调用栈的递归，改成用 `child` / `sibling` / `return` 三根指针手动遍历。递归靠 JS 调用栈，Fiber 则用自己维护的链表**模拟调用栈**，所以能在任意时刻保存当前进度、暂停、稍后从断点继续。

一句话：Fiber 把"一口气算完"的递归渲染，拆成了"可中断、可恢复、可跳过、可指定优先级"的增量渲染。

| 核心诉求 | Fiber 的满足方式 |
|---------|-----------------|
| 可中断 | 每个 Fiber 是一个工作单元，处理完可保存现场并让出主线程 |
| 可恢复 | 用 child/sibling/return 指针记录"下一个该处理谁"，随时继续 |
| 可跳过 | 命中 bailout 的子树直接复用旧结果，不再向下遍历 |
| 优先级 | 每个 Fiber 携带 lanes 优先级，高优先级更新可打断低优先级 |
| 不丢状态 | 用 alternate 双缓冲保留前一棵树，切换时界面不闪断 |

## 工序卡上记了什么

Fiber 节点就是"工作单元"的载体，字段大致可以分成"描述身份""维护结构""记录状态"三类：

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

`memoizedProps` 和 `pendingProps` 是一对：前者是"上一轮用过的参数"，后者是"这一轮刚拿到、还没处理的新参数"。两者比对的结果，直接决定要不要打 `didReceiveUpdate` 标记——没变就不用重新算，变了才往下走。

## 为什么非得自己维护链表

递归遍历天然只有两个动作：进入第一个子节点（压栈）、处理完回到父节点（出栈）。Fiber 把这两个动作显式化成三根指针：

| 指针 | 指向 | 对应递归里的动作 |
|------|------|-----------------|
| `child` | **第一个**子 Fiber | 进入子节点（压栈） |
| `sibling` | 同层的**下一个**兄弟 Fiber | 同级继续遍历 |
| `return` | **父** Fiber | 子节点处理完返回（出栈） |

关键在于：**`child` 只指向长子，兄弟节点靠 `sibling` 串成一条横向单向链表挂在父节点下**。所以"子节点"不是数组，而是一条链表；`return` 再把每个节点连回它的父节点。

以 `<App><Header><Title/></Header><Main/><Footer/></App>` 为例：

```text
   App .child ──► Header ──.sibling──► Main ──.sibling──► Footer
                    │ .child                              │ .sibling
                    ▼                                     ▼
                  Title                                  null
                    │ .sibling = null

   纵向：每个节点的 .return 都指回父节点（Title.return = Header；Header / Main / Footer.return = App）
   横向：父节点的 .child 只连长子，其余兄弟由 .sibling 顺着串起来
   终止：没有兄弟时 sibling = null，没有子节点时 child = null
```

把每次指向具体化（`null` 表示没有）：

| 节点 | child | sibling | return |
|------|-------|---------|--------|
| App | Header | null | null |
| Header | Title | Main | App |
| Main | null | Footer | App |
| Footer | null | null | App |
| Title | null | null | Header |

## 一次遍历只需要一个游标

整个渲染只用一个游标 `workInProgress` 加一个 `while` 循环，规则就两条：

1. **能往下就往下**：`beginWork(fiber)` 处理当前节点、创建或复用它的子 Fiber，并返回第一个子节点；有子节点就推进游标。
2. **下不去就向上收尾**：`beginWork` 返回 null 时执行 `completeWork`（生成 DOM、冒泡收集 flags）；然后有兄弟走兄弟，没兄弟就沿 `return` 回到父节点继续收尾，直到回到根。

```javascript
// 简化的 workLoop：一个游标 + 三指针，替换掉递归
while (workInProgress !== null) {
  workInProgress = performUnitOfWork(workInProgress)
}

function performUnitOfWork(fiber) {
  // ① 向下：处理当前节点，拿回它的第一个子节点
  const next = beginWork(fiber)
  if (next !== null) return next                // 有子节点 → 走 child

  // ② 向上：没有子节点，从自己开始逐层收尾
  let completed = fiber
  while (completed !== null) {
    completeWork(completed)                      // 生成 DOM、冒泡收集 flags
    if (completed.sibling !== null) {
      return completed.sibling                   // 有兄弟 → 走 sibling
    }
    completed = completed.return                 // 没兄弟 → 沿 return 回父节点
  }
  return null                                    // 回到根 → 遍历结束
}
```

上面那棵树对应的真实执行顺序：

| 步 | 当前节点 | 做什么 | 游标去向 |
|----|---------|--------|---------|
| 1 | App | beginWork | child → Header |
| 2 | Header | beginWork | child → Title |
| 3 | Title | 无子节点 → completeWork | 无兄弟 → return → Header |
| 4 | Header | completeWork | sibling → Main |
| 5 | Main | 无子节点 → completeWork | sibling → Footer |
| 6 | Footer | 无子节点 → completeWork | 无兄弟 → return → App |
| 7 | App | completeWork | 根、无 return → 结束 |

注意第 3 步：Title 先被 `completeWork` 收尾，之后才轮到父节点 Header——**先子后父**。这正是"用链表模拟调用栈出栈"的效果（在递归里，这一步等价于函数返回）。

## 断点存在哪儿

递归停不下来，是因为进度只存在于 JS 调用栈里，一让出就丢；Fiber 能中断，是因为进度被显式存进 `workInProgress` 这个变量，让出后它原地不动，下次从它继续。

```javascript
// 并发模式：处理每个工作单元之前，先问一次要不要让出主线程
while (workInProgress !== null && !shouldYield()) {
  performUnitOfWork(workInProgress)
}
// 超时（时间片默认 5ms）→ 循环直接结束，workInProgress 停在断点处
```

```text
处理第 N 个 Fiber ──► shouldYield() ?
                       │ 否 → 继续处理第 N+1 个
                       └ 是 → 本轮 workLoop 立即结束
                              workInProgress 仍指向第 N+1 个（断点）
                                   ↓ 主线程还给浏览器：响应点击、绘制这一帧
                              Scheduler 稍后再次调度
                                   ↓
                              从 workInProgress 指向的第 N+1 个继续
```

几个容易混淆的点：

| 问题 | 答案 |
|------|------|
| 断点存在哪 | 模块级变量 `workInProgress`（指向下一个待处理 Fiber）；WIP 树根由 `root.current` 派生（复用其 alternate） |
| 为什么中断安全 | render 阶段只在内存里构建 WIP 树，不触碰屏幕上显示的 current 树 |
| 什么情况直接丢弃重来 | 有更高优先级更新需要抢占时，整棵 WIP 树作废，从根按新优先级重跑 |
| 同步模式呢 | `workLoopSync` 的循环条件里没有 `shouldYield()`，一口气跑完、不会中断 |

## 那 requestIdleCallback 为什么不用

一个很自然的想法是：既然要利用空闲时间，浏览器不是提供了 `requestIdleCallback` 吗？React 团队最终选择自研 Scheduler，原因有四点：

| 问题 | 具体表现 |
|------|---------|
| 兼容性 | 早期 Safari、部分浏览器长期不支持，需要 polyfill |
| 频率不可控 | 空闲回调触发频率不稳定，只有 20ms 级别的颗粒度，难以保证 60fps |
| 无优先级语义 | 只能拿到一个剩余时间，无法表达"用户输入 > 动画 > 数据渲染" |
| 无法抢占 | 多任务间没有让位（yield）与抢占机制，做不到高优任务打断低优任务 |

浏览器原生 API 没法同时给出"稳定的调度时机 + 优先级 + 抢占能力"，所以 React 自己铺了一套：用 `MessageChannel` 做宏任务让位，用超时时间片做时间切片，用 lanes 做优先级。

## 两代协调器对比

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

React 15 的 Stack Reconciler 是同步递归：从根一路递归完整棵虚拟 DOM 树，调用栈一进去就必须执行到底，中途没法把主线程让给浏览器，组件树一大就长时间占满主线程导致掉帧，毕竟一帧只有约 16.7ms 的预算。所以要解决的问题，是把渲染拆成一个个可中断、可恢复、可跳过的单元，也就是时间切片。Fiber 就是那个工作单元，同时是一次数据结构改造：用 `child`、`sibling`、`return` 三根指针把递归换成循环遍历，用链表模拟调用栈，于是进度能存在 `workInProgress` 变量里，随时暂停、稍后从断点继续。每个 Fiber 还带 `alternate` 双缓冲、`stateNode`、`memoizedProps`、`memoizedState`、`updateQueue`、`flags`、`lanes`，分别负责界面一致性、节点身份、状态复用、副作用和优先级。不用 `requestIdleCallback`，是因为它兼容性差、触发时机不可控、也没有优先级和抢占语义。
