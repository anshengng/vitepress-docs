# Diff 算法与 key

## key 的作用

key 是 VNode 的**身份标识**。判断两个节点能否复用，Vue3 的判断条件是：

```typescript
// runtime-core/src/vnode.ts（简化）
export function isSameVNodeType(n1: VNode, n2: VNode): boolean {
  return n1.type === n2.type && n1.key === n2.key
}
```

| key 策略 | 结果 |
|---------|------|
| 稳定唯一 id | 复用正确，移动次数最少 |
| index | 复用错位，性能退化，状态错绑 |
| 随机数 | 每次都是新身份，永不复用 |
| 不写 key | 同步阶段仍按位置复用（key 都是 undefined），乱序阶段退化为按 type 匹配 |

## index 作 key 的问题

### 场景一：头部插入，性能退化

```
旧列表：A  B  C  D          （key=index：0 1 2 3）
头部插入 X，新列表：X  A  B  C  D   （key=index：0 1 2 3 4）

key 全部错位：
  旧 key=0 (A) vs 新 key=0 (X) → type 相同 → 复用 A 的 DOM，patch 成 X
  旧 key=1 (B) vs 新 key=1 (A) → patch
  旧 key=2 (C) vs 新 key=2 (B) → patch
  旧 key=3 (D) vs 新 key=3 (C) → patch
  新 key=4 (D) → 新建

本该"只插入 1 个节点"，实际做了 4 次 patch + 1 次 mount
```

若用稳定 id：diff 命中"头部新增"预处理，A B C D 全部原位复用，只 mount 一个 X。

### 场景二：DOM 状态与数据错位绑定

```vue
<template>
  <div v-for="(item, index) in list" :key="index">
    <input placeholder="输入的内容是 DOM 自身状态" />
    <span>{{ item.label }}</span>
  </div>
</template>
```

在第一个输入框输入"甲"后头部插入新项：

```
key=0 位置的旧 DOM（input 值为"甲"）被复用给新的第一项
→ span 被 patch 成新项的 label
→ 但 input 的值不在 VNode 里，patch 不会动它，仍然是"甲"
→ 用户看到：输入框内容与所在行数据彻底错位
```

根因：index 身份绑定的是"位置"，而插入/删除后位置与身份不再对应；input 的值、焦点、滚动位置这类 DOM 自身状态会留在被复用的 DOM 上。

## 随机数 key 为什么不行

```typescript
const list = computed(() =>
  source.value.map(item => ({ ...item, key: Math.random() })))  // 每次计算 key 都变
```

每次重渲染 key 全变 → `isSameVNodeType` 永远为 false → 全部 unmount + 重新 mount。列表越大越卡，且输入值、焦点等 DOM 状态全部丢失。

## Vue3 完整 diff 流程（patchKeyedChildren）

记号：旧子节点 `c1[i..e1]`，新子节点 `c2[i..e2]`。整体流程：

```
第 1 步 头头同步          第 2 步 尾尾同步
(a b) c d                 c d (a b)
(a b) e f                 e f (a b)
第 3 步 长度差异预处理      第 4 步 中间乱序部分
(a b)                      keyToNewIndexMap → 遍历旧中间节点
(c d) e                    → newIndexToOldIndexMap → LIS 最少移动
纯尾部追加：只 mount e
```

### 第 1 步：头头同步比较

```typescript
let i = 0
const e1 = c1.length - 1
const e2 = c2.length - 1
while (i <= e1 && i <= e2 && isSameVNodeType(c1[i], c2[i])) {
  patch(c1[i], c2[i], container)   // 复用 + 深入 patch；type/key 不匹配就停
  i++
}
```

### 第 2 步：尾尾同步比较

```typescript
while (i <= e1 && i <= e2 && isSameVNodeType(c1[e1], c2[e2])) {
  patch(c1[e1], c2[e2], container)
  e1--
  e2--
}
```

### 第 3 步：新旧长度差异的预处理

```typescript
if (i > e1) {
  // 旧的先遍历完，剩下的全是新节点 → 挂载
  while (i <= e2) {
    patch(null, c2[i], container, anchor)
    i++
  }
} else if (i > e2) {
  // 新的先遍历完，旧的多余 → 卸载
  while (i <= e1) {
    unmount(c1[i])
    i++
  }
}
```

### 第 4 步：中间乱序部分

```typescript
else {
  const s1 = i, s2 = i             // 旧/新中间部分的起点

  // 4.1 新中间节点建索引：key → 新索引
  const keyToNewIndexMap = new Map()
  for (i = s2; i <= e2; i++) {
    keyToNewIndexMap.set(c2[i].key, i)
  }
  const toBePatched = e2 - s2 + 1
  let patched = 0
  let moved = false
  let maxNewIndexSoFar = 0
  // 新中间索引 → 旧索引 + 1；0 表示"新列表里没有对应旧节点"
  const newIndexToOldIndexMap = new Array(toBePatched).fill(0)

  // 4.2 遍历旧中间节点
  for (i = s1; i <= e1; i++) {
    const prevChild = c1[i]
    if (patched >= toBePatched) { unmount(prevChild); continue }   // 复用名额已用完
    const newIndex = keyToNewIndexMap.get(prevChild.key)
    if (newIndex === undefined) {
      unmount(prevChild)                   // 新列表中不存在 → 删除
    } else {
      newIndexToOldIndexMap[newIndex - s2] = i + 1
      if (newIndex < maxNewIndexSoFar) moved = true   // 相对顺序被打乱 → 需要移动
      else maxNewIndexSoFar = newIndex
      patch(prevChild, c2[newIndex], container)   // 命中 → patch 复用
      patched++
    }
  }

  // 4.3 倒序遍历新中间节点：新建 / 移动
  const increasingNewIndexSequence = moved ? getSequence(newIndexToOldIndexMap) : []  // LIS
  let j = increasingNewIndexSequence.length - 1
  for (i = e2; i >= s2; i--) {
    const nextIndex = i + 1
    const anchor = nextIndex < c2.length ? c2[nextIndex].el : null
    if (newIndexToOldIndexMap[i - s2] === 0) {
      patch(null, c2[i], container, anchor)          // 0 → 新建
    } else if (moved) {
      if (j < 0 || i - s2 !== increasingNewIndexSequence[j]) {
        hostInsert(c2[i].el, container, anchor)      // 不在 LIS → 移动
      } else {
        j--                                          // 在 LIS 中 → 不动
      }
    }
  }
}
```

倒序遍历的原因：insert 以"右侧下一个节点的 el"为锚点，倒序能保证锚点已就位，一遍完成所有插入。

## 最长递增子序列（LIS）

### 为什么 LIS 能最小化 DOM 移动

`newIndexToOldIndexMap` 按**新顺序**记录每个新节点对应的**旧索引**。某段子序列递增，说明这些节点在新旧两个列表中相对顺序一致——它们彼此之间不需要动。

```
LIS = 已保持相对顺序的最大复用集合
移动次数 = 复用节点数 - LIS 长度
不在 LIS 中的节点 → 倒序逐个 insert 到正确位置
```

### getSequence 源码级讲解

Vue 的实现是"贪心 + 二分查找 + 前驱回溯"的变体，**返回索引数组**而不是值：

```typescript
function getSequence(arr: number[]): number[] {
  const p = arr.slice()      // p[i]：记录 result 中位置 i 的前驱索引，用于回溯
  const result = [0]         // result[k]：长度为 k+1 的递增子序列的"最小末尾"的索引
  for (let i = 1; i < arr.length; i++) {
    const arrI = arr[i]
    if (arrI === 0) continue               // 0 = 新建节点，不参与
    const j = result.length - 1
    if (arr[result[j]] < arrI) {
      p[i] = result[j]                     // 记录前驱
      result.push(i)                       // 比末尾大 → LIS 变长
      continue
    }
    // 二分：找 result 中第一个 >= arrI 的位置替换（末尾更小，更容易接长）
    let u = 0, v = j
    while (u < v) {
      const c = (u + v) >> 1
      if (arr[result[c]] < arrI) u = c + 1
      else v = c
    }
    if (arrI < arr[result[u]]) {
      if (u > 0) p[i] = result[u - 1]
      result[u] = i                        // 替换后索引不连续，靠 p 回溯真实序列
    }
  }
  // 回溯前驱，还原真实 LIS 索引序列
  let u = result.length
  let v = result[u - 1]
  while (u-- > 0) {
    result[u] = v
    v = p[v]
  }
  return result
}
```

### 用 [2, 4, 5, 1, 6, 8] 逐步演示

| i | arrI | 动作 | result（存索引） | 对应值 | 前驱记录 |
|---|------|------|----------------|--------|---------|
| 0 | 2 | 初始化 | [0] | [2] | - |
| 1 | 4 | 2 < 4，追加 | [0, 1] | [2, 4] | p[1] = 0 |
| 2 | 5 | 4 < 5，追加 | [0, 1, 2] | [2, 4, 5] | p[2] = 1 |
| 3 | 1 | 二分替换首位 | [3, 1, 2] | [1, 4, 5] | - |
| 4 | 6 | 5 < 6，追加 | [3, 1, 2, 4] | [1, 4, 5, 6] | p[4] = 2 |
| 5 | 8 | 6 < 8，追加 | [3, 1, 2, 4, 5] | [1, 4, 5, 6, 8] | p[5] = 4 |

注意 i=3 替换后 result 对应值 `[1, 4, 5]` 并不是真实子序列，result 只维护"各长度递增子序列的最小末尾"。最后回溯 p：末位 5 → p[5]=4 → p[4]=2 → p[2]=1 → p[1]=0，得到最终结果 `[0, 1, 2, 4, 5]`，对应值 `[2, 4, 5, 6, 8]`——正是原数组的 LIS；diff 中 LIS 索引对应的新节点保持不动，其余复用节点倒序 insert。

## Vue2 双端 vs Vue3 对比

| 维度 | Vue2 双端对比 | Vue3 同步 + 预处理 + LIS |
|------|--------------|--------------------------|
| 比较端点 | 四端交叉：头头 / 尾尾 / 旧头 vs 新尾 / 旧尾 vs 新头 | 两端同步：头头 / 尾尾 |
| 中间乱序 | 建 key → index map 逐个处理，非顺序节点直接移动，无 LIS，移动次数非最优 | keyToNewIndexMap + newIndexToOldIndexMap + LIS，移动次数最少 |
| 新增/删除 | 混在主循环中处理 | 独立预处理，常见场景（头部插入、尾部追加）只走同步 + 预处理即可结束 |
| 复杂度 | O(n)，但 DOM 操作可能多余 | O(n log n)，DOM 移动最优 |

## 面试答法

key 是 VNode 的身份标识，isSameVNodeType 要求 type 和 key 都相同才复用。Vue3 的 diff 分五步：先头头同步比较，再尾尾同步比较；然后做长度差异预处理——旧的多余节点 unmount、新的多余节点 mount；剩下的中间乱序部分，先建 keyToNewIndexMap，遍历旧中间节点，能命中的 patch 复用、命不中的 unmount，同时按新顺序记录 newIndexToOldIndexMap（0 表示新建）；最后倒序遍历新中间节点，值为 0 的新建，其余节点求最长递增子序列——LIS 代表在新旧列表中相对顺序一致的节点，保持不动，不在 LIS 中的倒序 insert，使 DOM 移动次数最少。所以用 index 作 key 会在头部插入时导致大量错误复用和不必要的 patch，甚至出现输入框状态与数据错位；用随机数 key 则永远无法复用，每次全部重建。
