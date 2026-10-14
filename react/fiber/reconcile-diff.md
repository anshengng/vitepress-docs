# Reconciliation 协调算法与 Diff 策略

## diff 的基本假设：只做同层比较

React 把虚拟 DOM 转成真实 DOM 的过程叫协调（Reconciliation），其中节点比对就是 diff。它建立在三条假设上：

| 假设 | 含义 |
|------|------|
| 同层比较 | 只比较同一层级的节点，跨层级不复用 |
| 类型不同即重建 | 元素 `type` 不同（如 `div` → `span`）就销毁重建整棵子树 |
| key 标识身份 | 同层列表中用 `key` 判断"还是不是同一个节点" |

之所以不再跨层比较，是为了把复杂度压到 O(n)：如果允许任意跨层移动，就需要在整棵树范围内找最短编辑距离，退化成 O(n³) 级别。代价是**同层顺序变化、跨层结构变化时无法复用**——这正是 `key` 必须写的原因。

```text
跨层移动不复用：整棵子树销毁重建
更新前                     更新后
div                        div
├── A                      └── span
│   └── B                        └── A
└── C                                └── B
                                     └── C

A 从 div 的子树挪到 span 下：React 不做跨层复用，
而是删除旧的 A 子树，在 span 下重新创建 A、B、C
```

## key 为什么重要

同一层里，如果只是列表顺序变化：

```jsx
// 没有 key：React 只能按位置比对，同层重排会被当成"内容变了"
<ul>
  <li>甲</li>
  <li>乙</li>
</ul>

// 有 key：按下标对比失败后会用 key 去旧链表里查，命中则复用
<ul>
  {items.map(item => <li key={item.id}>{item.name}</li>)}
</ul>
```

没有 key 时，如果只是把"甲、乙"对调，React 会认为第 0 个位置的内容从"甲"变成了"乙"，于是更新文本、保留 DOM——DOM 虽然没重建，但若节点带 state（如输入框内容）就会错位。有了 key，React 能认出"还是原来那个节点，只是位置变了"。

## reconcileChildFibers：两个指针的线性扫描

处理同层的一组子节点时，React 使用 `reconcileChildFibers`（数组场景走 `reconcileChildrenArray`）。它的核心是**两个指针**：

- 指针一：遍历旧的 Fiber 链表 `oldFiber`，每次 `oldFiber = oldFiber.sibling`
- 指针二：遍历新的 children 数组，用下标 `i` 推进

```text
旧 Fiber 单链表        A → B → C → D        （指针沿 sibling 右移）
新 children 数组       A'  C'  B'  E         （指针用下标 i 右移）
                       ↑ i

逐一比对 key 与 type：
  key 相同 && type 相同 → updateSlot 复用旧 Fiber（在旧节点上更新 props）
  否则                  → deleteChild 标记删除旧节点，再 createChild 新建
```

对应的简化源码流程：

```javascript
function reconcileChildrenArray(returnFiber, currentFirstChild, newChildren) {
  let oldFiber = currentFirstChild
  let lastPlacedIndex = 0
  let newIdx = 0

  // 第一轮：同步遍历新旧两份，能复用就复用
  for (; oldFiber !== null && newIdx < newChildren.length; newIdx++) {
    const newChild = newChildren[newIdx]
    if (newChild.key === oldFiber.key && newChild.type === oldFiber.type) {
      // key 与 type 都一致 → 复用，生成 newFiber
      const newFiber = updateSlot(returnFiber, oldFiber, newChild)
      lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx)
    } else {
      deleteChild(returnFiber, oldFiber)   // 不复用 → 打删除标记
    }
    oldFiber = oldFiber.sibling
  }
  // 后续轮：处理剩余（见下一节）
}
```

`updateSlot` 内部先比 key：key 不同直接返回 null（不复用）；key 相同但 type 不同，也走重建路径。只有 key 与 type 同时相同，才算真正复用同一个节点。

## placeChild / lastPlacedIndex：判断是否需要移动

复用节点的位置用 `lastPlacedIndex` 控制。它是"已经放置好的旧节点里，在旧序列中位置最靠后的那个下标"。

```javascript
function placeChild(newFiber, lastPlacedIndex, newIndex) {
  newFiber.index = newIndex

  const current = newFiber.alternate        // 指向复用的旧节点
  if (current !== null) {
    const oldIndex = current.index
    if (oldIndex < lastPlacedIndex) {
      // 该节点在旧序列中位置更靠前，说明它需要往后移动
      newFiber.flags |= Placement
      return lastPlacedIndex
    }
    // 否则原地保留，并把 lastPlacedIndex 更新为本节点位置
    return oldIndex
  }
  // 全新创建的节点，一定需要插入
  newFiber.flags |= Placement
  return lastPlacedIndex
}
```

一句话记法：**本节点的旧位置小于 lastPlacedIndex，就要移动；否则原地不动，并刷新 lastPlacedIndex**。新建节点一律打 `Placement`。

## 剩余节点的收尾处理

第一轮同步遍历结束后，两边都可能还有剩：

| 情况 | 处理 |
|------|------|
| 旧链表还有剩（`oldFiber !== null`） | 说明这些旧节点新列表里没有了 → 全部 `deleteChild` |
| 新数组还有剩（`newIdx < newChildren.length`） | 这些是新节点 → 逐个创建并 `placeChild` 打 Placement 插入 |
| 用尽旧链表后新数组仍有剩 | 通常用 `existingChildren` 这个 Map 按 key 快速匹配，减少遍历 |

```text
收尾阶段示意
旧: A → B → C → [D → E]        新: A' → C' → [F → G]
     └ 已配对 ┘    └ 剩余删除      └ 已配对 ┘   └ 剩余新建
最后：D、E 打删除标记；F、G 打插入标记
```

## bailout：整棵子树直接复用

每次 render 都会从根往下走，但大多数子树的 props 没变。为了不做无用功，`beginWork` 开头有一段 bailout 判断，满足条件就跳过整棵子树：

```javascript
function beginWork(current, workInProgress, renderLanes) {
  if (current !== null) {
    const oldProps = current.memoizedProps
    const newProps = workInProgress.pendingProps

    if (oldProps !== newProps || hasContextChanged()) {
      // props 变了或 context 变了 → 需要更新
      didReceiveUpdate = true
    } else if (!includesSomeLane(renderLanes, workInProgress.lanes)) {
      // props 没变、context 没变，且本节点没有本次要处理的更新
      didReceiveUpdate = false
      return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes)
    } else {
      didReceiveUpdate = false
    }
  }
  // ...否则进入正常更新流程
}
```

`bailoutOnAlreadyFinishedWork` 还会再看一次子孙是否真的有更新：

```javascript
function bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes) {
  if (!includesSomeLane(renderLanes, workInProgress.childLanes)) {
    return null          // 连子孙都没有本次更新 → 整棵子树跳过，直接复用
  }
  cloneChildFibers(current, workInProgress)  // 子孙有更新 → 克隆子节点继续向下
  return workInProgress.child
}
```

于是"复用旧子树"有两条粒度：**本节点无更新且子孙无更新（childLanes 不含 renderLanes）→ 整棵子树直接跳；只有子孙有更新 → 克隆一层子 Fiber 继续往下**。命中 bailout 的路径不会重新 diff，这是 React 性能的关键优化之一。

`didReceiveUpdate` 的作用是把"props 是否变化、context 是否命中"的结论传递给下层：为 false 时，即使走到 `updateFunctionComponent` 之类的分支，也可以省掉一些工作。

## 三种比对结果对照

| 场景 | 判定条件 | 结果 |
|------|---------|------|
| 复用 | key 相同 && type 相同 | `updateSlot` 复用旧 Fiber，只更新 props/state |
| 重建（同 key 变 type） | key 相同但 type 变化 | 视为不同类型，删除旧节点、新建新节点 |
| 重建（type 相同但 key 不同） | 同层列表 key 不匹配 | 当成两个不同节点，旧的删除、新的新建 |

## 与 Vue diff 的差异（对照）

| 维度 | React | Vue3 |
|------|-------|------|
| 同层列表算法 | 单链表 + 双指针线性扫描，从前往后匹配 | 双端比较（头头、尾尾、头尾、尾头）+ 乱序时最长递增子序列 |
| 是否需要 key | 强烈建议，无 key 时同层重排会错位 | 同样建议，但双端比较对首尾移动更友好 |
| 复用判定 | key + type 完全一致才复用 | 同类节点 + key（或 patchFlag）匹配 |
| 优势场景 | 单向推进逻辑简单、可随时 bailout | 列表首尾增删、中间乱序移动的移动次数更少 |

React 选择"单链表线性扫描 + lastPlacedIndex"是为了配合可中断渲染：遍历过程简单、状态好保存，随时能暂停恢复；Vue 的双端比较则在纯列表 diff 上更精细，两者是不同权衡下的选择。

## 面试答法

React 的 diff 只在同一层级进行，跨层级不复用，元素 type 不同就整棵子树销毁重建，同层列表靠 key 判断是不是同一个节点，这样把复杂度控制在 O(n)，代价是必须写 key。具体在 reconcileChildFibers 里，它用两个指针在旧 Fiber 单链表和新 children 数组上同步推进，逐一比对 key 与 type：都相同就 updateSlot 复用旧节点，任一不同就 deleteChild 打删除标记再新建；复用节点的位置由 placeChild 和 lastPlacedIndex 决定，如果该节点在旧序列里的位置小于 lastPlacedIndex，说明它要往后移动，否则原地保留并刷新 lastPlacedIndex，新建节点一律打 Placement。遍历结束后旧链表有剩就删除、新数组有剩就新建插入。此外 beginWork 开头还有 bailout 优化：当 oldProps 与 newProps 相同或 context 未变，并且本节点 lanes 不含本次 renderLanes 时，didReceiveUpdate 置为 false，直接调 bailoutOnAlreadyFinishedWork，若子孙也没更新（childLanes 不含 renderLanes）就整棵子树复用，否则克隆一层子节点继续向下。这也是 React 和 Vue 的差别：React 是单链表线性扫描，Vue 是双端比较加最长递增子序列。
