# Element 和 Fiber 到底是不是同一个东西

## 两个 `console.log` 引出的疑问

在组件里打一行日志：

```jsx
function App() {
  const el = <div className="box">hi</div>
  console.log(el)   // 打印出一个小巧干净的对象：$$typeof、type、props……
  return el
}
```

而在报错栈或 React DevTools 里，那个叫 Fiber 的东西是另一副样子：巨大、带着 `return` / `child` / `sibling` / `alternate` 一堆指针，还有 `memoizedState`、`lanes`、`flags`。

两个对象都指向同一个 `div`，为什么非要存两份？

因为**它们根本不是同一类东西**：一个是"我要做成什么样"，一个是"这件事做到哪一步了"。前者每次重画，后者一直跟着工地。

## 打个比方：图纸与工地台账

- React Element 是**设计图纸**：画一次、定稿、不允许涂改，只表达"应该长成这样"
- Fiber 是**工地台账**：一直挂在工地上的那本册子，记着这堵墙砌到哪了、材料还剩多少、上次用的什么尺寸、下一步该谁上
- DOM 是最后交付的**房子**，由 Fiber 的 `stateNode` 指过去

这个类比往下贯穿：图纸每轮重新画（父组件每次 render 都产一批新的 Element），台账只有一套（结构不变就一直复用）；图纸上没有任何"进度"可言，台账里全是进度。看懂了这两点，两者的所有差异都是自然的。

## 图纸：天生一次性的只读描述

Element 由 JSX 编译后的 `createElement` / `_jsx` 产出，形态如下：

```javascript
const element = {
  $$typeof: Symbol.for('react.element'), // 防伪标记（原文档常省略成 Symbol(react.element)）
  type: "div",             // 字符串表示 host 标签；也可以是一个函数/类（组件）
  key: null,               // 身份编号，reconcile 时用来配对
  ref: null,               // 宿主引用，创建时从 config 里单独抽出
  props: { className: "box", children: [] }, // 图纸上真正写给施工队看的参数
  _owner: null,            // 创建它的那个组件，仅开发期排查用
  _store: { validated: false } // 开发期校验标记
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

所以 Element 是**纯数据**，是"我要渲染成什么样"的声明。它本身不参与 diff，也不碰 DOM——图纸不会自己动手砌墙。

## 台账：能接着干的 Fiber

Fiber 是 React 16 引入的调和（reconcile）与调度架构节点，本质是一个可读写的对象：

```javascript
const fiber = {
  tag: FunctionComponent,     // 节点类型标记（HostComponent=5、FunctionComponent=0 等）
  key: null,                  // 与 Element 的 key 对应，用来配对身份
  elementType: App,           // 原始类型（用户写的那个）
  type: App,                  // 解析后的类型（可能被 memo/forwardRef 包过）
  stateNode: null,            // 真实 DOM（host 节点）或类组件实例
  return: parentFiber,        // 父节点，子做完靠它回上一层
  child: firstChildFiber,     // 只指向第一个子节点
  sibling: nextSiblingFiber,  // 下一个兄弟节点，横向串成链表
  index: 0,                   // 在兄弟里的下标，Diff 判断移动要用
  ref: null,

  pendingProps: {},           // 本次待处理 props（刚来自新 Element，还没处理）
  memoizedProps: {},          // 上次渲染完成后定下来的 props
  updateQueue: null,          // 更新队列（setState / hooks 变更排在这里）
  memoizedState: null,        // 函数组件里指向 Hooks 链表
  dependencies: null,         // context 依赖

  flags: 0,                   // 副作用标记（Placement / Update / Deletion）
  lanes: 0,                   // 本节点待处理的优先级（Lane 模型）
  childLanes: 0,              // 整棵子树待处理的优先级，用于 bailout 判断

  alternate: null             // 指向另一份自己（current ↔ workInProgress 双缓冲）
}
```

和 Element 一比，特征恰好全反过来：

| 特征 | 说明 |
|------|------|
| 可变 | 字段在 reconcile 过程中被反复写入 |
| 持久 | 只要结构不变，同一个 Fiber 在多次 commit 之间被复用 |
| 有状态 | `memoizedState` 挂 Hooks 链表，保存组件状态 |
| 有 DOM 引用 | `stateNode` 指向真实 DOM（host）或类实例 |
| 有更新队列 | `updateQueue` / `lanes` 支撑调度与批处理 |

## 为什么两份都得留着

有人会问：既然 Fiber 里什么都有，Element 是不是多余的？

恰恰相反，两份各有不可替代的位置：

1. **比对需要基准**。diff 比的永远是"这次的新描述"和"上次留下的状态"——Element 提供前者，Fiber 提供后者。只有一份的话，没有东西可比。
2. **构建需要可丢弃**。渲染可能被打断、可能因更高优先级更新而作废。图纸作废重画毫无成本；台账要是被就地涂改坏了，旧状态就找不回来了。

## 顺便说清双缓冲

Fiber 树上同时存在两棵由 `alternate` 互指的树：屏幕上的 **current 树**，和正在构建的 **workInProgress 树**。构建完成后整体切换 `root.current`，这就是 React 渲染的"双缓冲"。

它让新树能在不破坏旧树的前提下逐步搭建（可中断、可恢复），也解释了 Fiber 为什么必须"持久可复用"：一次没搭完的渲染可以直接扔掉 workInProgress，旧树毫无影响。细节在[双缓冲与两阶段](/react/fiber/double-buffer)。

## 图纸怎么变成台账：`key` 与 `type` 是编号

```text
JSX / createElement
      ↓ 父组件 render 每次重新产出
React Element 树（不可变的 UI 描述）
      ↓ reconcile（beginWork：按 type + key 匹配旧 Fiber）
Fiber 树（可变工作单元，current ↔ workInProgress 双缓冲）
      ↓ commit（按 flags 执行 Placement / Update / Deletion）
DOM 树（真实节点，由 stateNode 引用）
```

reconcile（`beginWork` 里的 `reconcileChildFibers`）拿新旧两边做匹配：

```text
新 Element（key="a", type=Item）
        ↓ 与旧 Fiber 的 key / type 对比
命中  → 复用该 Fiber，更新 pendingProps，可中断地细化子树
未命中 → 新建 Fiber（并给旧 Fiber 打 Deletion 标记）
```

匹配依据是 **key + type**：`type` 相同且 `key` 相同（或都为 null）就算命中。命中则复用 Fiber、把新 Element 的 props 写进 `pendingProps`；不命中则创建新 Fiber、旧节点进删除列表。这就是列表必须写稳定 `key` 的原因——key 就是图纸和台账之间的编号锚点，编号一变，React 就认为换人了。

### 匹配逻辑示意（简化）

```typescript
// reconcileSingleElement：只有一个子节点时的匹配
function reconcileSingleElement(returnFiber, currentFiber, element) {
  const key = element.key
  let child = currentFiber

  while (child !== null) {
    // key 和 type 都对得上 → 认定是同一个节点，复用旧台账
    if (child.key === key && child.elementType === element.type) {
      const existing = useFiber(child, element.props) // 复用，把新 props 写进 pendingProps
      existing.return = returnFiber                  // 重新挂回新父节点
      return existing
    }
    // 有一个对不上 → 旧节点没用了，打删除标记，换下一个兄弟继续找
    deleteChild(returnFiber, child)
    child = child.sibling
  }

  // 一圈都没找到 → 这是新来的，按 Element 建一个全新 Fiber
  return createFiberFromElement(element)
}
```

复用的核心是 `useFiber(current, pendingProps)`：它不新建对象，而是复用旧节点、把新 props 写进 `pendingProps`，并让新旧节点通过 `alternate` 互指——于是 `memoizedState`（状态）和 `stateNode`（DOM）都原封不动地留了下来。这正是"状态能跨更新存活、Element 不能"的根源。

## 三个常被追问的问题

- **Element 能持有状态吗？** 不能，它只是描述对象；状态保存在对应 Fiber 的 `memoizedState` 上，靠 `alternate` 在多次更新之间传递。
- **为什么不直接用 Element 树 diff？** Element 每次 render 都是新的、不可变的，无法承载"上次做到哪了"的进度，也无法中断恢复；Fiber 把渲染拆成可暂停的工作单元，才实现了时间切片与优先级调度。
- **Fiber 什么时候被销毁？** 当新树里没有 `type` / `key` 对应的 Element 时，它被打上 Deletion 标记，commit 阶段删除 DOM 后随旧树被 GC。

## 一张表把差异对齐

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

Element 和 Fiber 是两回事。Element 是一次 render 产出的不可变普通对象，只描述 UI 长什么样，每次 render 重新创建，本身没有状态、没有 DOM 引用、也没有更新队列。Fiber 是 React 16 引入的可变工作单元，挂在 Fiber 树上跨 commit 复用，承载 `memoizedState`、`updateQueue`、`stateNode`，靠 `alternate` 实现 current 和 workInProgress 双缓冲，从而支撑可中断调度。关系上，Element 是 Fiber 重建时的输入：reconcile 用 `type` 和 `key` 把新 Element 和旧 Fiber 配对，命中就复用 Fiber、更新 `pendingProps`，同时保留旧的 `memoizedState` 和 `stateNode`，不命中就新建 Fiber，这也是列表必须写稳定 key 的原因。整条链路是 Element 树经 reconcile 变成 Fiber 树，再经 commit 按 flags 落到 DOM 树。
