# 双缓冲与 render/commit 两阶段

## 两棵树：current 与 workInProgress

React 在内存里同时维护两棵 Fiber 树：

| 树 | 名称 | 含义 |
|----|------|------|
| 屏幕上那棵 | **current 树** | 当前真实 DOM 对应的 Fiber 树，用户正在看到的 |
| 内存里那棵 | **workInProgress 树** | 本次更新正在构建的新树，还没提交到界面 |

首次挂载时只有 current 树；一旦发生更新，React 就从 `root.current` 出发，创建一个 workInProgress 节点开始构建新树。

```javascript
// 根节点上保存着两棵树的入口
const root = {
  current: currentFiberTree,          // 屏幕上正在显示的树
  finishedWork: null,                 // 本次 render 完成后待提交的 workInProgress
}
// 从 current 派生出一个 workInProgress 根节点
const workInProgressRoot = createWorkInProgress(root.current, null)
```

## alternate：两棵树的桥

两棵树上的节点不是孤立的，而是**一一对应、互相指向**，靠 `alternate` 指针连接：

```text
        root.current                          root.finishedWork
        （current 树）                         （workInProgress 树）
     ┌──────────────┐                      ┌──────────────┐
     │   App        │── alternate ────────►│   App        │
     │  child ↓     │◄──── alternate ──────│  child ↓     │
     └──────────────┘                      └──────────────┘
        │                                       │
     ┌──▼───┐   alternate   ┌──▼───┐
     │ List │◄─────────────►│ List │
     └──────┘               └──────┘
```

```javascript
// 复用已有节点或创建新 workInProgress 时，都建立 alternate 双向引用
function createWorkInProgress(current, pendingProps) {
  let workInProgress = current.alternate
  if (workInProgress === null) {
    workInProgress = createFiber(current.tag, pendingProps, current.key)
    workInProgress.alternate = current
    current.alternate = workInProgress   // 双向互指
  }
  // ...同步 type / stateNode / updateQueue 等字段
  return workInProgress
}
```

之所以要复用 `current.alternate` 而不是每次新建，是为了减少对象分配：上一次构建后，两棵树角色互换，同一个对象在下一轮又会被反过来用。

## 为什么需要双缓冲

如果直接在屏幕上那棵树上原地改动，会有两个问题：

1. **修改过程一旦被中断，界面就停在"半成品"状态**：新子树只建了一半，旧子树已被破坏，用户看到的就是闪烁或结构残缺。
2. **无法保留旧状态**：diff 需要与"上一次的节点"比对，原地覆盖后就丢失了比较基准。

双缓冲解决方式很干净：**在内存里 Build 一棵全新的 workInProgress 树，构建过程可中断、可丢弃、可重来，完全不触碰屏幕上正在显示的 current 树**；等整棵树构建完成，再在 commit 阶段一次性切换：

```javascript
// commit 的最后一步：原子地交换两棵树
root.current = finishedWork
```

切换之后，原 current 树退居为备用的 alternate，下一轮更新继续复用，两棵树就这样轮流登场。界面上永远只显示完整的树，不存在"半成品"。

## render 阶段：可中断的 DFS

render 阶段也叫协调（reconciliation）阶段，本质是一次对 workInProgress 树的深度优先遍历，由 `beginWork` 和 `completeWork` 两种操作交替完成：

- **beginWork（向下）**：处理当前节点，根据 `type`、`props` 判断能否复用旧子节点，或调用组件函数、创建/克隆子 Fiber，返回第一个子节点。
- **completeWork（向上）**：当前节点没有子节点时执行，为宿主节点创建/更新真实 DOM，收集副作用，把子树上的 effects 冒泡到自己身上，再回到兄弟或父节点。

```text
render 阶段：beginWork 向下 + completeWork 向上
        App
         │ beginWork ↓（创建/复用子 Fiber）
      ┌──┴──┐
    Header  Main
      │       │ beginWork ↓
    Title   List ──┐
      │           ...
   completeWork ↑（创建 DOM、收集 effect，逐层冒泡）

向下：beginWork   自顶向下，构建子节点
向上：completeWork 自底向上，生成 DOM 并汇总副作用到根
```

render 阶段是**可中断**的：遍历本身也是 workLoop 循环，每处理完一个 Fiber 就检查是否超时、是否有更高优先级任务，是则保留断点（模块级变量 `workInProgress` 停在当前位置）让出主线程，稍后从断点继续。注意：这个阶段只是"计算与构建"，不产生任何真实 DOM 变更，所以中断/丢弃是安全的。

## render 阶段的中断与恢复

render 阶段能中断、能恢复，靠的不是 JS 调用栈，而是把当前工作进度存进模块级变量 `workInProgress`：

```text
中断与恢复
  处理完一个 Fiber
        ↓ 检查是否超时 / 是否有更高优先级更新
  超出时间片 or 有更高优任务
        ↓ 让出主线程（保存现场）
  模块级变量 workInProgress 仍停在断点处的 Fiber
        ↓ 浏览器借机响应交互、绘制这一帧
  稍后重新调度
        ↓ 从 workInProgress 指向的 Fiber 继续 workLoop
  继续处理下一个 Fiber
```

| 要点 | 说明 |
|------|------|
| 断点位置 | 模块级变量 `workInProgress` 保存下一个待处理 Fiber；WIP 树的根由 `createWorkInProgress(root.current)` 得到（复用 current 的 alternate），都不依赖引擎调用栈 |
| 优先级依据 | 本轮渲染的 lanes 由 root 上的 pendingLanes 决定，恢复时沿用同一批 |
| DOM 何时进树 | completeWork 只调 createInstance 创建 DOM 节点并缓存，真正插入发生在 commit |
| 中断安全 | render 阶段不改界面上已显示的树，丢弃重建也不影响用户所见 |

也正因如此，render 阶段在源码里对应的是 `workLoopSync`（同步、不可中断）与 `workLoopConcurrent`（可中断、超时让出）两个版本：只有并发更新才走可中断的那条路，同步更新仍然一口气跑完。

## commit 阶段：不可中断的三子阶段

workInProgress 树构建完成后进入 commit 阶段。这一步要真正修改界面上已经显示的 DOM，**必须同步、一次性执行完，不能被打断**，否则用户会看到渲染不完整的界面。commit 内部按顺序分三个子阶段：

| 子阶段 | 英文 | 做什么 |
|--------|------|--------|
| DOM 变更前 | before mutation | 变更前的准备，如调用 `getSnapshotBeforeUpdate`、调度 passive effects |
| DOM 变更 | mutation | 真正执行插入/更新/删除 DOM（Placement / Update / Deletion） |
| DOM 变更后 | layout | 变更后收尾，同步执行 `useLayoutEffect`、绑定/清理 ref、切换 `root.current` |

```text
commit 阶段：三个子阶段顺序执行（全程不可中断）
  ┌──────────────────┐
  │ 1. before mutation│  DOM 变更前的准备（getSnapshotBeforeUpdate）
  └────────┬─────────┘
           ↓
  ┌──────────────────┐
  │ 2. mutation       │  真正修改 DOM：插入 / 更新 / 删除
  └────────┬─────────┘
           ↓
  ┌──────────────────┐
  │ 3. layout         │  同步执行 useLayoutEffect、ref，root.current = finishedWork
  └──────────────────┘
           ↓
  (不可中断，整个过程在主线程一次性跑完)

遍历方式：commitMutationEffects / commitLayoutEffects 会沿着 effects 链表（firstEffect → nextEffect）线性推进，不再 DFS
```

副作用为什么能线性遍历？因为在 render 阶段的 `completeWork` 里，各节点的 flags 已经被逐层冒泡收集，并通过 `firstEffect` / `lastEffect` / `nextEffect` 串成了一条从根出发的单向链表，commit 只需沿这条链表从头走到尾，无需再递归树。

## passive effects：commit 之后异步执行

`useEffect`（passive effect）并不在 layout 阶段同步跑，而是**在 commit 完成之后由调度器异步执行**：commit 尾声会用普通优先级调度一次 `flushPassiveEffects`，通常在下一帧的宏任务里执行。

| 副作用 | 执行时机 | 是否阻塞绘制 |
|--------|---------|-------------|
| `useLayoutEffect` | layout 子阶段，同步 | 会阻塞（在绘制前执行） |
| `useEffect` | commit 之后异步调度 | 不阻塞（通常在绘制后执行） |

这也是为什么"需要在画面更新前同步测量 DOM 尺寸"要用 `useLayoutEffect`，而普通副作用用 `useEffect` 即可。

## 面试答法

React 用双缓冲维护两棵 Fiber 树：屏幕上正在显示的是 current 树，本次更新在内存里构建的是 workInProgress 树，两者通过 alternate 指针一一互指，构建完成的节点会复用上一轮的 alternate 以减少对象分配。双缓冲的意义在于构建过程可以中断、可以丢弃，绝不污染界面上已经显示的树，等整棵树建好后在 commit 最后一步用 `root.current = finishedWork` 原子切换。一次更新因此分成两个阶段：render 阶段是 beginWork 向下创建/复用子节点、completeWork 向上生成 DOM 并冒泡收集副作用的深度优先遍历，它可打断、可恢复；commit 阶段要真正改动 DOM，不可中断，内部依次是 before mutation、mutation、layout 三个子阶段，分别负责变更前准备、真正增删改 DOM、以及同步执行 useLayoutEffect 和 ref 绑定，最后切换 current。而 useEffect 这种 passive effect 不在 layout 里同步执行，而是在 commit 结束后由调度器异步调度，所以它不会阻塞绘制。
