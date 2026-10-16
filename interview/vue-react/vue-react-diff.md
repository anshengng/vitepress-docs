# Vue3 与 React Diff 对比

## 题目

> Vue3 的 diff 算法和 React 的 diff 有什么区别？听说 Vue3 用了最长递增子序列，具体怎么工作？React 为什么是单链表遍历、不做双向对比？两者复杂度差在哪？

## 为什么需要对比

两个框架要解同一道题：**新旧两棵虚拟树，用最少的 DOM 操作把旧树变成新树**。

```
Vue ：编译期知道"这里一定是同类型"（静态提升/Block），运行时 diff 做得更精细
React：纯运行时，靠 type+key 单遍判断，粗粒度但配合 Fiber 可中断

共同前提（两家都遵守，先说这个显得懂行）：
  ① 只比【同层】节点，不做跨层移动 —— 跨层请换 key 整体重建
  ② type 不同 → 整棵子树销毁重建
```

## 核心要点

### 1. Vue3 快速 diff：双端预处理 + key 映射 + LIS

```
第一步：头头 / 尾尾 预处理（命中就原地 patch，指针内收）

  old: [A, B, C, D, E]      new: [A, B, X, D, E]
        ↑        ↑↑
  头比 A=A ✅ 前移；B=B ✅ 前移；尾比 E=E ✅、D=D ✅ 后移
  → 剩下"中间未知区" old:[C]  new:[X] → C 卸载、X 挂载
  （常见增删改都在两端一轮扫完，0 移动）

第二步：中间区建 key→新索引 的 Map，遍历旧中间区逐个匹配

第三步：对匹配序列求【最长递增子序列 LIS】——不在 LIS 里的节点才移动
```

#### LIS 完整例子（重点模拟）

```
old 中间区: [A, B, C, D]      new 中间区: [D, B, C, A]

① 建 Map（key → 在 new 中的下标）:  D→0  B→1  C→2  A→3

② 按 old 顺序遍历，查 Map 得到"newIndex 序列"：
   A→3   B→1   C→2   D→0     序列 = [3, 1, 2, 0]

③ 朴素算法（Vue2 思路）：newIndex < 已见最大值就移动
   A(3) 记 max=3；B(1)<3 移；C(2)<3 移；D(0)<3 移 → 移动 3 次 ❌

④ 求 LIS：[3,1,2,0] 的最长递增子序列 = [1,2]（即 B、C）
   → B、C 相对顺序本来就对，【原地不动】
   → 不在 LIS 的 A、D 才移动：D 插到最前、A 插到最后

结果：2 次移动完成 [A,B,C,D] → [D,B,C,A] ✅

LIS 直觉：找出"相对顺序已经正确、能留在原地"的最大一批，剩下的各归各位
（贪心+二分求解，O(n log n)）
```

### 2. React diff：单链表一次遍历

```
Fiber 树 = 链表结构：Parent.child 指向第一个子节点，child.sibling 指向下一个

  oldChain: A → B → C → D → null
  newChain: D → B → C → A → null

React 从头部开始【单遍】遍历，同时维护 lastPlacedIndex：
  取 new 节点，去 old 里按 key 找（有 Map 辅助）：
    找不到 → 新建
    找到且 oldIndex >= lastPlacedIndex → 复用不动，lastPlacedIndex = oldIndex
    找到但 oldIndex < lastPlacedIndex  → 复用但要【移动】

  D: oldIndex=3 ≥ 0 → 不动，lastPlaced=3
  B: oldIndex=1 < 3 → 移动
  C: oldIndex=2 < 3 → 移动
  A: oldIndex=0 < 3 → 移动        ← 同一组数据，React 移动 3 次

  type/key 都相同才复用；type 不同整棵换：
  old <div>...</div>  vs new <p>...</p> → 卸载重建，不比子树
```

### 3. 为什么 React 不做双端对比/LIS

```
① 结构决定：Fiber 是 child/sibling 单链表，只能从头往后走，
   没有 oldStart/oldEnd 双指针，"从尾部对比"物理上走不动
② 可中断是底线：渲染要在帧间隙暂停/恢复，
   双端指针、LIS 序列这类额外中间状态会让"暂停-恢复"复杂化；
   单遍 + 少量标记（effect flag）最容易断点续传
③ 哲学差异：React 把优化责任交给开发者 —— 稳定 key、memo、
   虚拟化列表；Vue 把优化做进编译器+运行时
```

### 4. 复杂度与性能取舍

| 维度 | Vue3 | React |
| --- | --- | --- |
| 遍历方式 | 双端指针 + Map + LIS | 单链表一遍扫 |
| 列表移动次数 | 最少（LIS 保证） | 可能多（同例 3 次 vs 2 次） |
| diff 时间复杂度 | O(n)，LIS 为 O(n log n) | O(n) |
| 可中断渲染 | 无（同步递归 patch，树小够用） | 有（Fiber 架构核心卖点） |
| 编译期助力 | 静态提升/Block tree，静态节点直接跳过 | 无编译器（React Compiler 正在补） |
| 性能补偿手段 | 框架自带 | memo/useMemo/稳定 key/虚拟化 |

- DOM 移动比属性修改更贵，所以"少移动"是 Vue3 引入 LIS 的直接动机
- React 移动多几次通常可接受，因为它的大头优化在"少渲染"（memo 跳过子树 render）

## 面试答法

### 30 秒版

> 两家都只做同层比较、type 不同整棵重建，区别在中间列表的处理。Vue3 先用头头、尾尾双端预处理把常见增删改一轮扫掉，中间未知区建 key 到新索引的 Map，遍历旧节点得到 newIndex 序列，再对这个序列求最长递增子序列——LIS 里的节点原地不动，只有不在 LIS 的节点才移动，DOM 移动次数最少。React 受 Fiber 的 child/sibling 单链表结构限制，只能从头单遍遍历，用 lastPlacedIndex 判断复用还是移动，同一组乱序数据 React 可能多移几次。React 不做双向对比是为了保证渲染可中断——双端指针和 LIS 的中间状态不利于暂停恢复，它把优化责任交给 memo 和稳定 key。一句话：Vue 优化"移动次数"，React 优化"渲染次数"并靠可中断取胜。

### 深入版（被追问时按这条线展开）

1. **共同前提**：同层比较、type 不同重建——先划清两家一致的边界
2. **Vue3 三段式**：双端预处理 → key Map 匹配中间区 → LIS 决定谁不动谁移动
3. **手推 LIS 例子**：[A,B,C,D]→[D,B,C,A]，序列 [3,1,2,0]，LIS=[1,2]，朴素移 3 次、LIS 只移 2 次
4. **React 单链表**：child/sibling 只能从头走；lastPlacedIndex 规则跑一遍同一例子得 3 次移动
5. **为什么 React 不学 Vue**：链表结构 + 可中断（暂停/恢复要少维护中间状态）；引出 Fiber
6. **取舍收尾**：Vue 靠编译器+LIS 少移动，React 靠 memo 少渲染、把控制权给开发者

### 常见追问

- **LIS 为什么能减少移动？** → 递增子序列里的节点在新旧列表相对顺序一致，可原地不动；移动次数 = 总数 - LIS 长度，天然最小
- **React 的 key 和 Vue 的 key 作用一样吗？** → 一样是"身份标识供复用"；React 不写 key 隐式用 index，Vue 列表组件必须 key
- **Vue3 为什么不需要 Fiber 可中断？** → 模板 diff 范围小（Block 隔离动态部分），同步递归足够快；React JSX 整棵树重新执行 render，大列表更需要可中断
- **React Compiler 会改变这个对比吗？** → 自动 memo 化解决"少渲染"靠人肉的问题，但 diff 仍是单链表一遍扫
- **两个框架 diff 谁更快？** → 别绝对化：列表乱序场景 Vue 移动更少；但真实瓶颈常在 render 阶段计算量与框架机制（响应式精确更新 vs 组件重渲染），不是纯 diff
