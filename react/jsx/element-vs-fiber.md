# React Element 与 Fiber 的区别

## 核心思路

初学者常把 React Element 和 Fiber 混为一谈，其实二者职责完全不同：

- **Element 是「描述」**：一次 render 产出的、不可变的普通对象，表达「我想要什么 UI」。它是一次性的，下次 render 会重新创建。
- **Fiber 是「可调度的工作单元」**：可变的、在多次 commit 之间被复用的对象节点，挂在 Fiber 树上，承载状态、更新队列与对真实 DOM 的引用。

一句话：Element 回答「UI 长什么样」，Fiber 回答「这次更新要做什么、做到哪了、状态存在哪」。

## Element：一次性的只读描述

Element 由 JSX 编译后的 `createElement` / `_jsx` 产出，形态如下：

```javascript
const element = {
  $$typeof: Symbol(react.element),
  type: "div",             // 字符串或组件函数/类
  key: null,
  ref: null,
  props: { className: "box", children: [] },
  _owner: null,            // 创建它的组件
  _store: { validated: false }
}
```

它的关键特征：

| 特征 | 说明 |
|------|------|
| 不可变 | 没有 setter，创建后不会被修改，只作为输入使用 |
| 一次性 | 父组件每次 render 都会重新创建一批新 Element |
| 无状态 | 不持有 `useState` 之类的状态，状态存在 Fiber 上 |
| 无 DOM 引用 | 不指向真实 DOM，只描述结构 |
| 无更新队列 | 不含 `updateQueue`，不负责调度 |

所以 Element 是**纯数据**，是「我要渲染成什么样」的声明，本身不参与 diff，也不参与 DOM 操作。

## Fiber：可复用的工作单元

Fiber 是 React 16 引入的调和（reconcile）与调度架构节点，本质是一个可读写的对象，关键字段如下：

```javascript
const fiber = {
  tag: FunctionComponent,     // 节点类型标记（HostComponent=5、FunctionComponent=0 等）
  key: null,
  elementType: App,           // 原始类型
  type: App,                  // 解析后的类型
  stateNode: null,            // 真实 DOM（host）或类组件实例（class）
  return: parentFiber,        // 父节点（链表树结构）
  child: firstChildFiber,     // 第一个子节点
  sibling: nextSiblingFiber,  // 下一个兄弟节点
  index: 0,
  ref: null,

  pendingProps: {},           // 本次待处理 props（来自新 Element）
  memoizedProps: {},          // 上次渲染完成后的 props
  updateQueue: null,          // 更新队列（setState / hooks 变更）
  memoizedState: null,        // 函数组件里指向 Hooks 链表
  dependencies: null,         // context 依赖

  flags: 0,                   // 副作用标记（Placement / Update / Deletion）
  lanes: 0,                   // 本节点待处理的优先级（Lane 模型）
  childLanes: 0,              // 子树待处理的优先级

  alternate: null             // 指向 current / workInProgress 的另一半（双缓冲）
}
```

与 Element 相比，Fiber 的特征恰好相反：

| 特征 | 说明 |
|------|------|
| 可变 | 字段在 reconcile 过程中被反复写入 |
| 持久 | 只要结构不变，同一个 Fiber 在多次 commit 之间被复用 |
| 有状态 | `memoizedState` 挂 Hooks 链表，保存组件状态 |
| 有 DOM 引用 | `stateNode` 指向真实 DOM（host）或类实例 |
| 有更新队列 | `updateQueue` / `lanes` 支撑调度与批处理 |

## 双缓冲：current 与 workInProgress

Fiber 树上同时存在两棵由 `alternate` 互指的树：屏幕上的 **current 树**，和正在构建的 **workInProgress 树**。构建完成后整体切换 `root.current`，这就是 React 渲染的「双缓冲」机制。它让新树可以在不破坏旧树的前提下逐步构建（可中断、可恢复），也解释了 Fiber 为什么必须是「持久可复用」的：一次未完成的渲染可以直接丢弃 workInProgress，旧树毫无影响。

## Element 树到 DOM 树的流转

```text
JSX / createElement
      ↓ 父组件 render 每次重新产出
React Element 树（不可变的 UI 描述）
      ↓ reconcile（beginWork：按 type + key 匹配旧 Fiber）
Fiber 树（可变工作单元，current ↔ workInProgress 双缓冲）
      ↓ commit（按 flags 执行 Placement / Update / Deletion）
DOM 树（真实节点，由 stateNode 引用）
```

### 关系：Element 是 Fiber 重建时的输入

reconcile（`beginWork` / `reconcileChildFibers`）拿新旧两边信息做匹配：

```text
新 Element（key="a", type=Item）
        ↓ 与旧 Fiber 的 key / type 对比
命中  → 复用该 Fiber，更新 pendingProps，可中断地细化子树
未命中 → 新建 Fiber（并给旧 Fiber 打 Deletion 标记）
```

匹配依据是 **key + type**：`type` 相同且 `key` 相同（或都为 null）就命中，复用 Fiber 并沿 `alternate` 指向新节点、把新 Element 的 props 写进 `pendingProps`；不命中则创建新 Fiber、旧节点进入删除列表。这解释了列表为什么必须给稳定 `key`：key 就是 Element 与 Fiber 之间的对应关系锚点。

### 匹配逻辑示意（简化）

```typescript
// reconcileSingleElement：单个子节点的匹配
function reconcileSingleElement(returnFiber, currentFiber, element) {
  const key = element.key
  let child = currentFiber

  while (child !== null) {
    // key 与 type 都相同 → 命中，复用旧 Fiber
    if (child.key === key && child.elementType === element.type) {
      const existing = useFiber(child, element.props) // 复用，写入 pendingProps
      existing.return = returnFiber
      return existing
    }
    // key 或 type 不匹配 → 删除旧 Fiber，继续在兄弟里找
    deleteChild(returnFiber, child)
    child = child.sibling
  }

  // 遍历完都没命中 → 新建 Fiber
  return createFiberFromElement(element)
}
```

复用的核心是 `useFiber(current, pendingProps)`：它不新建对象，而是把旧 Fiber 的 `alternate` 指向新节点、更新 `pendingProps`，从而保留 `memoizedState`（状态）与 `stateNode`（DOM）。这正是「状态能跨更新存活」而「Element 不能」的根源。

## 常见追问

- **Element 能持有状态吗？** 不能，它只是描述对象；状态保存在对应 Fiber 的 `memoizedState` 上，靠 `alternate` 在多次更新之间传递。
- **为什么不直接用 Element 树 diff？** Element 每次 render 都是新的、不可变，无法承载「上次做到哪了」的进度，也无法中断恢复；Fiber 把渲染拆成可暂停的工作单元，才实现了时间切片与优先级调度。
- **Fiber 什么时候被销毁？** 当新树里没有 `type` / `key` 对应的 Element 时被打上 Deletion 标记，commit 阶段删除 DOM 后随旧树被 GC。

## Element 与 Fiber 属性对比

| 维度 | React Element | Fiber |
|------|---------------|-------|
| 角色 | 描述 UI（声明） | 工作单元（执行） |
| 数据结构 | 普通对象 | 普通对象 + 链表指针（child/sibling/return） |
| 内存位置 | 每次 render 新分配 | 挂在 Fiber 树上，跨 commit 复用 |
| 可变性 | 不可变 | 可变 |
| 生命周期 | 本次渲染有效 | 跨多次渲染，直到卸载 |
| 状态 | 无 | `memoizedState`（Hooks 链表） |
| DOM 引用 | 无 | `stateNode` |
| 更新队列 | 无 | `updateQueue` / `lanes` |
| 对应关系 | 提供 `type` / `key` 作为匹配依据 | 用 `type` / `key` 与 Element 对应 |
| 双缓冲 | 无 | `alternate` 指向 current / workInProgress |

## 面试答法

React Element 和 Fiber 是两回事：Element 是一次 render 产出的、不可变的普通对象，只是对「UI 长什么样」的描述，每次 render 都会重新创建，本身不持有状态、不持有 DOM 引用、也没有更新队列。Fiber 则是 React 16 引入的可变工作单元，挂在 Fiber 树上、跨多次 commit 复用，承载 `memoizedState`、`updateQueue`、`stateNode` 以及对真实 DOM 的引用，并通过 `alternate` 实现 current 与 workInProgress 的双缓冲，从而支持可中断的调度。二者关系上，Element 是 Fiber 重建时的输入：reconcile 阶段用 `type` 和 `key` 把新 Element 与旧 Fiber 匹配，命中就复用 Fiber 并更新 `pendingProps`，未命中就新建 Fiber，这也正是列表必须给稳定 key 的原因。整条链路是：Element 树经 reconcile 变成 Fiber 树，再经 commit 按 flags 把变化落到真实 DOM 树。
