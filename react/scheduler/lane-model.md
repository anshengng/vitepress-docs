# 31 位，为什么不能直接用 1 到 5？

## 卡住我的那一行

第一次翻 `ReactFiberLane`，满屏都是这种代码：

```typescript
export function getHighestPriorityLane(lanes: Lanes): Lane {
  return lanes & -lanes;
}
```

优先级为什么非要用二进制位存？用 `1、2、3` 的枚举排个序，谁小谁优先，不是更直白吗？还有 `lanes` 是个**集合**又不是单个值，集合怎么能塞进一个数字里？

答案藏在"它不只是一个优先级"这件事上：一次渲染可能要同时处理好几类更新。就像收费站——你不会只开一条道，而是同时开好几条，哪条先放行取决于车道的位置。整篇都用这个收费站讲：31 位就是 31 条并排车道，一个数字就是"这一轮开放了哪几条"的位图。

## 枚举的局限：一次更新不止一个优先级

React 17 起用 **Lane（车道）** 表示优先级，它是一个 31 位二进制数，每一位对应一条独立车道。

如果用一个数字表示"当前优先级"，那它就是单值的：整个 root 在某一刻只能有一个优先级在生效。可现实是——`root.pendingLanes` 要记录**所有**待处理的更新类型，而且"这次要处理的车道集合"必须能合并、能判断包含、能清除。这三件事用位运算各一行就写完了，用枚举得写一堆分支和数组：

| 操作 | 位运算 | 例子 |
|------|--------|------|
| 合并多条车道 | 或 | `lanes = DefaultLane \| TransitionLane1` |
| 判断是否包含 | 与 | `if (lanes & SyncLane) { ... }` |
| 清除某条车道 | 与非 | `remaining = lanes & ~DefaultLane` |
| 取最高优先级 | 与负数 | `highest = lanes & -lanes` |

## 31 条车道怎么排

位数越靠右（索引越接近 0）优先级越高。同步车道排在最右，相当于 ETC 专道，一进来就放行；越往左越慢，最左边是几乎永远不开的应急通道。

```text
高优先级 ←────────────────────────────────────────────────────→ 低优先级
位索引:   0     1     2     3     4     5     6 ~ 21    22 ~ 26   27     28     29    30
        ┌─────┬─────┬─────┬─────┬─────┬─────┬──────────┬─────────┬──────┬──────┬─────┬──────┐
        │Sync │Cont │Cont │Dflt │Dflt │TrHyd│ Trans    │ Retry   │ SelHy│IdlHy │ Idle│Offsc │
        │Lane │Hyd  │Lane │Hyd  │Lane │lane │ 1 ~ 16   │ 1 ~ 5   │      │      │Lane │reen  │
        └─────┴─────┴─────┴─────┴─────┴─────┴──────────┴─────────┴──────┴──────┴─────┴──────┘
```

| Lane | 位索引 | 含义 |
|------|--------|------|
| `NoLanes` / `NoLane` | 全 0 | 一条车道都没开，没有任何待处理工作 |
| `SyncLane` | 第 0 位为 1 | 同步车道，最高优先级 |
| `InputContinuousLane` | 第 2 位为 1 | 连续输入（拖拽、滚动）触发 |
| `DefaultLane` | 第 4 位为 1 | 默认优先级，普通 `setState` |
| `TransitionLanes` | 第 6 ~ 21 位 | 一组 Transition 车道，`TransitionLane1` 到 `16` |
| `RetryLanes` | 第 22 ~ 26 位 | 一组重试车道，`RetryLane1` 到 `5` |
| `SelectiveHydrationLane` | 第 27 位为 1 | 选择性注水（SSR 时优先注水被点击的那块） |
| `IdleHydrationLane` | 第 28 位为 1 | 空闲注水 |
| `IdleLane` | 第 29 位为 1 | 空闲优先级 |
| `OffscreenLane` | 第 30 位为 1 | Offscreen 组件（可隐藏 / 预渲染）用 |

带 `Hydration` 后缀的是 SSR 注水专用车道，它们和对应的正常车道成对出现，专门标注"注水阶段"的更新。之所以必须单独占位，是因为注水和普通更新要区别对待——同一个组件，注水那次和后续更新不能混在同一条道上。

### 为什么一组车道是连号的

Transition 要 16 条、Retry 要 5 条，是因为同一时刻可能有多个 Transition 任务并发跑，**每个任务各占一条独立车道**，互不覆盖。

用收费站解释：16 条并发通道同时开工，每辆车走一条，彼此不挡；同时，管理方还能用 `TransitionLanes` 这个**掩码**一次判断"这辆车是不是走 Transition 通道的"——不用逐条查，一个与运算就够。这就是"连号"的真正收益：**既分得开，又能一把捞出来**。

## 四种动作，一行一个

```typescript
// 合并：这一轮要开哪几条道
const lanes = DefaultLane | TransitionLane1;

// 判断：这条道开了吗（结果非 0 即包含）
if (lanes & SyncLane) {
  // 包含同步车道
}

// 清除：这批活干完了，把车道从待处理集合里划掉
const remaining = lanes & ~DefaultLane;

// 交集：两批开放车道里重合的部分
const common = a & b;
```

## `lanes & -lanes` 为什么能挑出最右的 1

既然越靠右优先级越高，那"最高优先级"就是二进制里**最靠右的那个 1**。把它单独抠出来，标准做法是 `lanes & -lanes`：

```typescript
// ReactFiberLane
export function getHighestPriorityLane(lanes: Lanes): Lane {
  return lanes & -lanes; // 隔离出最低有效位（最靠右的 1）
}
```

原理是补码：`-lanes` 等于 `~lanes + 1`——先按位取反，再把最低位加 1 引发进位，于是原来最低的那个 1 及其右边全变 0、它本身被进回来仍是 1，再和原数相与，就只剩它一个。

```text
lanes        = 0b0000000000000000000000000001010000
-lanes       = 0b1111111111111111111111111110110000
lanes & -lanes = 0b0000000000000000000000000000010000  → DefaultLane
```

集合里同时开着 `DefaultLane`（第 4 位）和 `TransitionLane1`（第 6 位），抠出来的也是更靠右的 `DefaultLane`——最右的那条道先放行。

## 读源码会反复见到的几个函数

| 函数 | 核心实现 | 作用 |
|------|----------|------|
| `mergeLanes` | 两个集合按位或 | 合并两条车道集合 |
| `removeLanes` | `lanes & ~目标` | 从集合里移除指定车道 |
| `includesSomeLane` | `(a & b) !== NoLanes` | a 是否包含 b 中的任意一条 |
| `isSubsetOfLanes` | `(a & b) === a` | a 是否是 b 的子集 |
| `getHighestPriorityLane` | `lanes & -lanes` | 取最靠右、优先级最高的车道 |
| `getLowestPriorityLane` | `1 << (31 - Math.clz32(lanes))` | 取最靠左、优先级最低的车道 |

`getLowestPriorityLane` 借助 `Math.clz32` 数出前导零的个数来定位最高有效位，跟 `getHighestPriorityLane` 正好对着干：一个找最右，一个找最左。

## 三个容易混的集合

| 名称 | 归属 | 含义 |
|------|------|------|
| `root.pendingLanes` | FiberRoot | 整个 root 上所有待处理的车道集合，不断用或运算累加 |
| `renderLanes` | 本次 render | 这次渲染实际处理的车道集合，由 `getNextLanes` 从 `pendingLanes` 里挑出 |
| `root.entangledLanes` | FiberRoot | 互相纠缠的车道（比如一个 Transition 和它触发的更新），必须一起处理 |

渲染时，只有"更新自己的 lane 落在 `renderLanes` 里"的更新会被处理，其余的留在 `pendingLanes` 等下一次。这就是"高优先级先渲染、低优先级靠后"落到代码里的样子——收费站这一轮只放行某几条道，剩下的车继续排队。

## 从一次 setState 到调度，车道怎么走

```text
用户事件回调里调用 setState
        │  requestUpdateLane：按事件类型分配一条 Lane
        ↓
update.lane = DefaultLane              更新对象自带车道
        │  markRootUpdated：或运算累加
        ↓
root.pendingLanes |= update.lane       挂到 root 的待处理集合
        │  ensureRootIsScheduled
        ↓
getNextLanes(root)：从 pendingLanes 挑出最高优先级的一组
        ↓
renderLanes                            本次 render 实际处理的车道
        │  渲染时，update.lane & renderLanes 非 0 的才处理
        ↓
未落在 renderLanes 的更新 → 车道留在 pendingLanes，等下一次 render
```

重点一句话：**优先级在分配更新时确定，在调度时排序，在渲染时按 `renderLanes` 过滤。**

## 批处理的道理：同一波车走同一条道

早期 React（17 之前）用 `expirationTime` 这个数字表示优先级，同一个事件回调里的多次 `setState` 会落到同一个 `expirationTime`，于是合并。Lane 模型是同一个思路，只是换成"同一个车道位"：

```javascript
function handleClick() {
  setA(1); // 分配 DefaultLane
  setB(2); // 也分配 DefaultLane
  setC(3); // 还是 DefaultLane
  // 三个更新落在同一个 Lane 位，累积进 root.pendingLanes，
  // 只触发一次 ensureRootIsScheduled → 合并成一次 render
}
```

如果三次 `setState` 分布在不同的回调里（或被 `await` 打断），就会落到不同批次、触发多次渲染。

### 位运算走一遍

```text
DefaultLane   0b00000000000000000000000000010000   （第 4 位）
Transition1   0b00000000000000000000000001000000   （第 6 位）
                        │  |  合并
                        ↓
lanes         0b00000000000000000000000001010000
                        │  & SyncLane（0b01，第 0 位）
                        ↓
              0b00000000000000000000000000000000  → 不包含 SyncLane
                        │  & -lanes 取最低有效位
                        ↓
DefaultLane   0b00000000000000000000000000010000  → 本次最高优先级是 DefaultLane
```

## Lane 怎么翻译成 Scheduler 的优先级

Lane 是 React 内部的"语义优先级"，Scheduler 的五档是"执行优先级"，中间由 `ensureRootIsScheduled` 完成翻译：

| Lane | 典型来源 | 调度方式 |
|------|----------|----------|
| `SyncLane` | `flushSync`、离散事件（click、input 提交） | 不进 Scheduler，直接同步刷新 |
| `InputContinuousLane` | 连续事件（mousemove、scroll、拖拽） | 映射到 Scheduler 的 UserBlocking / Continuous |
| `DefaultLane` | 普通 `setState`、网络回调 | 映射到 Normal |
| `TransitionLanes` | `startTransition` 产生的更新 | 映射到 Normal，但可被中断 |
| `RetryLanes` | 挂起后重试 | 映射到 Normal |
| `IdleLane` | 空闲任务 | 映射到 Idle |

所以别把两套优先级混为一谈：车道决定"这活儿急不急"，Scheduler 决定"什么时候把它塞进时间片"。

## 面试答法

React 从 17 开始用 Lane 表示优先级，Lane 是一个 31 位二进制数，每一位是一条车道，比如 SyncLane、InputContinuousLane、DefaultLane、一组 16 条 TransitionLanes、一组 5 条 RetryLanes、IdleLane、OffscreenLane 等等。之所以用位运算而不是枚举，是因为一次更新可能同时属于多条车道，用或运算合并、与运算判断包含、与非清除，一行就能表达集合操作。取最高优先级用 `getHighestPriorityLane` 做 `lanes & -lanes`，因为补码下 `-lanes` 会把最低位的 1 单独留下，而位数越靠右优先级越高，SyncLane 就排在第 0 位。React 用 `root.pendingLanes` 记录 root 上所有待处理车道，`renderLanes` 表示本次渲染实际处理的车道，只有 `update.lane & renderLanes` 非 0 的更新才会被处理，其余留到下一轮。Lane 与 Scheduler 通过 `ensureRootIsScheduled` 衔接：SyncLane 直接同步执行，其余依次映射到 UserBlocking、Normal、Idle。批处理的原理就是同一回调里的多次 setState 落在相同 Lane 位，合并成一次 render。
