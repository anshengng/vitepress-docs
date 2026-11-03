# 列表重排之后，输入框的字为什么跑到别人家

## 先看一个真的会发生的 bug

两个待办事项，每个 `<li>` 里放一个输入框，你已经分别填了"买菜"和"取快递"：

```jsx
<ul>
  {items.map(item => <li><input defaultValue={item.done ? "已完成" : ""} /></li>)}
</ul>
```

把这两条对调顺序，再刷新——文字没跟着走。第 0 个输入框里依然是"买菜"，可它对应的数据已经是"取快递"了。

第一反应通常是"React 更新 text 没更新 input"。其实不是。React 认为第 0 个位置**还是原来那个节点**，只是里面的内容变了，于是更新文本、保留 DOM，DOM 里已经输入的东西自然就留在原地。数组里换个位置它认不出来，因为它**没给节点发工牌**。

## 打个比方：进厂打卡，认牌不认脸

React 的 diff 像一家只在自己车间里点名的工厂：

- 每个节点戴着**工牌**，工牌号就是 `key`，工种就是 `type`
- 点名只看**同一个车间**（同一层级），绝不会跑到楼上楼下找人
- 有牌的人换到队伍另一个位置，照样认得出来；没牌的人只能按"你站第几个位置"认，一换位就认错
- 工牌号一样但工种变了，算换人，整个工位推倒重来

这一篇要讲的三条假设、`key` 的必要性、两个指针的点名过程，都能套进这个比方。

## 工厂只在自己车间点名：三条假设

React 把虚拟 DOM 转成真实 DOM 的过程叫协调（Reconciliation），其中节点比对就是 diff。它建立在三条假设上：

| 假设 | 含义 |
|------|------|
| 同层比较 | 只比较同一层级的节点，跨层级不复用 |
| 类型不同即重建 | 元素 `type` 不同（如 `div` → `span`）就销毁重建整棵子树 |
| key 标识身份 | 同层列表中用 `key` 判断"还是不是同一个节点" |

为什么不跨层比？为了把复杂度压到 O(n)。如果允许任意跨层移动，就得在整棵树范围内找最短编辑距离，退化成 O(n³) 级别。代价是**同层顺序变化、跨层结构变化时无法复用**——这正是 `key` 必须写的原因。

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

## 有牌和没牌，差在哪

同一层里，如果只是列表顺序变化：

```jsx
// 没有 key：React 只能按位置认人，同层重排会被当成"内容变了"
<ul>
  <li>甲</li>
  <li>乙</li>
</ul>

// 有 key：按下标对比失败后，会拿 key 去旧链表里查，命中就复用
<ul>
  {items.map(item => <li key={item.id}>{item.name}</li>)}
</ul>
```

没 key 时，把"甲、乙"对调，React 认为第 0 个位置的**内容**从"甲"变成了"乙"，于是更新文本、保留 DOM。DOM 本身没重建，但节点上带的 state（比如输入框里已经输入的内容）就会错位。有了 key，React 能认出"还是原来那个人，只是站到了别的队伍位置"。

## 点名开始：两个指针的线性扫描

处理同层的一组子节点时，React 用 `reconcileChildFibers`（数组场景走 `reconcileChildrenArray`）。核心是**两个指针**：

- 指针一：遍历旧的 Fiber 链表 `oldFiber`，每次 `oldFiber = oldFiber.sibling` 右移
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
  let oldFiber = currentFirstChild   // 旧链表的游标
  let lastPlacedIndex = 0            // 已经就位的人里，旧位置最靠右的那个（下一节细讲）
  let newIdx = 0                     // 新数组的游标

  // 第一轮：新旧两份同步往前走，能复用就复用
  for (; oldFiber !== null && newIdx < newChildren.length; newIdx++) {
    const newChild = newChildren[newIdx]

    if (newChild.key === oldFiber.key && newChild.type === oldFiber.type) {
      // 工牌号一样、工种也一样 → 认定是同一个人，复用
      const newFiber = updateSlot(returnFiber, oldFiber, newChild)
      lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx)
    } else {
      // 有一项对不上 → 这个旧节点不要了，打删除标记
      deleteChild(returnFiber, oldFiber)
    }
    oldFiber = oldFiber.sibling   // 旧链表继续右移
  }
  // 后续轮：处理剩余（见下一节）
}
```

`updateSlot` 内部也是先比 key：key 不同直接返回 null（不复用）；key 相同但 type 不同，同样走重建路径。只有 key 与 type 同时相同，才算真正复用同一个节点——工牌对上了，工种还得对。

## 谁要挪位置：`lastPlacedIndex`

复用节点的位置由 `lastPlacedIndex` 控制。它是"**已经放好的旧节点里，在旧序列中位置最靠后的那个下标**"。

```javascript
function placeChild(newFiber, lastPlacedIndex, newIndex) {
  newFiber.index = newIndex               // 先记下在新序列里的位置

  const current = newFiber.alternate      // 指回复用的那个旧节点
  if (current !== null) {
    const oldIndex = current.index
    if (oldIndex < lastPlacedIndex) {
      // 这个人的旧位置比"已就位最靠右"还靠左 → 说明他必须往后挪
      newFiber.flags |= Placement
      return lastPlacedIndex              // 参照点不更新
    }
    // 否则原地不动，同时刷新参照点（他就是目前最靠右的那个）
    return oldIndex
  }
  // 全新创建的节点，没有旧位置，一定需要插入
  newFiber.flags |= Placement
  return lastPlacedIndex
}
```

一句话记法：**本节点的旧位置小于 lastPlacedIndex，就要移动；否则原地不动，并刷新 lastPlacedIndex**。新建节点一律打 `Placement`。

## 一轮点完，剩下的人怎么处理

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

## 没变化的地方，能不能整个跳过

每次 render 都从根往下走，但大多数子树的 props 压根没变。为了不做无用功，`beginWork` 开头有一段 bailout 判断，满足条件就跳过整棵子树：

```javascript
function beginWork(current, workInProgress, renderLanes) {
  if (current !== null) {                       // 有旧节点，才谈得上"跳过"
    const oldProps = current.memoizedProps      // 上一轮的参数
    const newProps = workInProgress.pendingProps // 这一轮的参数

    if (oldProps !== newProps || hasContextChanged()) {
      // 参数或 context 变了 → 老老实实重新算
      didReceiveUpdate = true
    } else if (!includesSomeLane(renderLanes, workInProgress.lanes)) {
      // 参数没变、context 没变，且本节点没有本次要处理的更新
      didReceiveUpdate = false
      return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes)
    } else {
      didReceiveUpdate = false
    }
  }
  // ...否则进入正常更新流程
}
```

`bailoutOnAlreadyFinishedWork` 还会再看一眼子孙是否真的有事：

```javascript
function bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes) {
  if (!includesSomeLane(renderLanes, workInProgress.childLanes)) {
    return null          // 连子孙都没有本次更新 → 整棵子树跳过，直接复用旧结果
  }
  cloneChildFibers(current, workInProgress)  // 子孙有事 → 只克隆一层子节点，继续往下
  return workInProgress.child
}
```

于是"复用旧子树"有两个粒度：**本节点无更新且子孙无更新（childLanes 不含 renderLanes）→ 整棵子树直接跳；只有子孙有更新 → 克隆一层子 Fiber 继续往下**。命中 bailout 的路径不会重新 diff，这是 React 性能的关键优化之一。

`didReceiveUpdate` 的作用是把"props 是否变化、context 是否命中"的结论传递给下层：为 false 时，即使走到 `updateFunctionComponent` 之类的分支，也能省掉一些工作。

## 三种比对结果摆在一起

| 场景 | 判定条件 | 结果 |
|------|---------|------|
| 复用 | key 相同 && type 相同 | `updateSlot` 复用旧 Fiber，只更新 props/state |
| 重建（同 key 变 type） | key 相同但 type 变化 | 视为不同类型，删除旧节点、新建新节点 |
| 重建（type 相同但 key 不同） | 同层列表 key 不匹配 | 当成两个不同节点，旧的删除、新的新建 |

## 和 Vue 的点名方式不一样

| 维度 | React | Vue3 |
|------|-------|------|
| 同层列表算法 | 单链表 + 双指针线性扫描，从前往后匹配 | 双端比较（头头、尾尾、头尾、尾头）+ 乱序时最长递增子序列 |
| 是否需要 key | 强烈建议，无 key 时同层重排会错位 | 同样建议，但双端比较对首尾移动更友好 |
| 复用判定 | key + type 完全一致才复用 | 同类节点 + key（或 patchFlag）匹配 |
| 优势场景 | 单向推进逻辑简单、可随时 bailout | 列表首尾增删、中间乱序移动的移动次数更少 |

React 选"单链表线性扫描 + lastPlacedIndex"，是为了配合可中断渲染：遍历过程简单、状态好保存，随时能暂停恢复；Vue 的双端比较在纯列表 diff 上更精细。两者是不同权衡下的选择。

## 面试答法

React 的 diff 只在同一层进行，跨层不复用，type 不同就销毁重建整棵子树，同层用 key 判断是不是同一个节点，复杂度控制在 O(n)，代价是必须写 key。具体在 `reconcileChildFibers` 里，两个指针在旧 Fiber 单链表和新 children 数组上同步推进，逐一比对 key 与 type：都相同就 `updateSlot` 复用旧节点，任一不同就 `deleteChild` 打删除标记再新建。复用节点用 `lastPlacedIndex` 判断位置：旧位置小于它就说明要往后移动、打 `Placement`，否则原地保留并刷新它，新建节点一律打 `Placement`。一轮扫完，旧链表有剩就删除、新数组有剩就新建。`beginWork` 开头还有 bailout：props 和 context 都没变、且本节点 lanes 不含本次 renderLanes 时，`didReceiveUpdate` 置 false，直接调 `bailoutOnAlreadyFinishedWork`，子孙的 childLanes 也不含 renderLanes 就整棵子树复用，否则只克隆一层子节点继续向下。这也是 React 和 Vue 的差别：React 是单链表线性扫描，Vue 是双端比较加最长递增子序列。
