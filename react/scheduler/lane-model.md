# Lane 优先级模型

## 核心思路

React 17 起用 **Lane（车道）** 表示优先级。它是一个 31 位的二进制数，每一位代表一条独立车道。

为什么不用数字 1~5 的枚举？因为**一次更新可以同时属于多条车道**，用位运算的"或 / 与 / 非"能自然地表达集合的合并、包含与清除，这正是枚举做不到的。

| 操作 | 位运算 | 例子 |
|------|--------|------|
| 合并多条车道 | 或 | `lanes = DefaultLane \| TransitionLane1` |
| 判断是否包含 | 与 | `if (lanes & SyncLane) { ... }` |
| 清除某条车道 | 与非 | `remaining = lanes & ~DefaultLane` |
| 取最高优先级 | 与负数 | `highest = lanes & -lanes` |

## 31 位里各 Lane 占位

位数越靠右（索引越小）优先级越高，同步车道排在最右。

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
| NoLanes / NoLane | 全 0 | 没有任何待处理车道 |
| SyncLane | 第 0 位为 1 | 同步车道，最高优先级 |
| InputContinuousLane | 第 2 位为 1 | 连续输入（拖拽、滚动）触发 |
| DefaultLane | 第 4 位为 1 | 默认优先级，普通 setState |
| TransitionLanes | 第 6 ~ 21 位 | 一组 Transition 车道，TransitionLane1 到 16 |
| RetryLanes | 第 22 ~ 26 位 | 一组重试车道，RetryLane1 到 5 |
| SelectiveHydrationLane | 第 27 位为 1 | 选择性注水（SSR 时优先注水被点击区域） |
| IdleHydrationLane | 第 28 位为 1 | 空闲注水 |
| IdleLane | 第 29 位为 1 | 空闲优先级 |
| OffscreenLane | 第 30 位为 1 | Offscreen 组件（可隐藏 / 预渲染）用 |

带 `Hydration` 后缀的车道是 SSR 注水专用的，它们与对应的正常车道成对出现，注解水阶段的更新优先级。

### 为什么一组车道是连续的

Transition 需要 16 条、Retry 需要 5 条，是因为同一时间可能有多个 Transition 任务并发进行，**每个任务各占一条独立车道**，互不覆盖。这样 React 既能区分它们，又能用 `TransitionLanes` 这个掩码一次性判断"是不是 Transition 类更新"。

## 为什么用位运算

位运算把"优先级集合"的几种操作变成一行代码，既快又清晰：

```typescript
// 合并：这次要处理的车道集合
const lanes = DefaultLane | TransitionLane1;

// 判断：是否包含某条车道（结果非 0 即包含）
if (lanes & SyncLane) {
  // 包含同步车道
}

// 清除：处理完后把已完成的车道从待处理集合里去掉
const remaining = lanes & ~DefaultLane;

// 交集：两条集合的共同车道
const common = a & b;
```

## getHighestPriorityLane：取最低有效位

既然越靠右优先级越高，那么"最高优先级车道"就是二进制里**最靠右的那个 1**。标准做法是 `lanes & -lanes`：

```typescript
// ReactFiberLane
export function getHighestPriorityLane(lanes: Lanes): Lane {
  return lanes & -lanes; // 隔离出最低有效位
}
```

原理：在补码里 `-lanes` 等于 `~lanes + 1`，低位全变 0 并进位，只有原数最低的那个 1 位置会同时为 1，与 `lanes` 相与就只剩它。

```text
lanes        = 0b0000000000000000000000000001010000
-lanes       = 0b1111111111111111111111111110110000
lanes & -lanes = 0b0000000000000000000000000000010000  → DefaultLane
```

哪怕集合里同时有 DefaultLane 和 TransitionLane1，取出来的也是更靠右的 DefaultLane。

## 常用的车道工具函数

ReactFiberLane 里封装了一组基于位运算的工具函数，读源码时会反复见到：

| 函数 | 核心实现 | 作用 |
|------|----------|------|
| mergeLanes | 两个集合按位或 | 合并两条车道集合 |
| removeLanes | lanes 与非目标车道 | 从集合里移除指定车道 |
| includesSomeLane | (a & b) !== NoLanes | a 是否包含 b 中的任意一条 |
| isSubsetOfLanes | (a & b) === a | a 是否是 b 的子集 |
| getHighestPriorityLane | lanes & -lanes | 取最靠右、优先级最高的车道 |
| getLowestPriorityLane | 1 << (31 - Math.clz32(lanes)) | 取最靠左、优先级最低的车道 |

`getLowestPriorityLane` 借助 `Math.clz32` 数出前导零的个数，从而定位最高有效位，和 `getHighestPriorityLane` 正好相反。

## renderLanes 与 root.pendingLanes

两个概念要分清：

| 名称 | 归属 | 含义 |
|------|------|------|
| root.pendingLanes | FiberRoot | 记录整个 root 上所有待处理的车道集合，用或运算不断累加 |
| renderLanes | 本次 render | 这次渲染实际处理的车道集合，由 getNextLanes 从 pendingLanes 里挑出 |
| root.entangledLanes | FiberRoot | 互相纠缠的车道（如 Transition 与它触发的更新），需一起处理 |

渲染时，只有"更新车道落在 `renderLanes` 里"的更新会被处理，其余留到下一次。这就是"高优先级先渲染、低优先级靠后"的落地方式。

## Lane 与 Scheduler 优先级的映射

Lane 决定优先级档位，再映射到 Scheduler 的调度优先级：

| Lane | 典型来源 | 调度方式 |
|------|----------|----------|
| SyncLane | flushSync、离散事件（click、input 提交） | 不进 Scheduler，同步刷新 |
| InputContinuousLane | 连续事件（mousemove、scroll、拖拽） | 映射到 Scheduler 的 UserBlocking / Continuous |
| DefaultLane | 普通 setState、网络回调 | 映射到 Normal |
| TransitionLanes | startTransition 产生的更新 | 映射到 Normal，但可中断 |
| RetryLanes | 挂起后重试 | 映射到 Normal |
| IdleLane | 空闲任务 | 映射到 Idle |

也就是说 Lane 是 React 内部的"语义优先级"，Scheduler 的 Immediate / UserBlocking / Normal / Idle 是"执行优先级"，中间由 `ensureRootIsScheduled` 完成翻译。

## 从 setState 到调度的车道流转

一次普通 setState，车道会经历这样一条流转链路：

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
renderLanes                           本次 render 实际处理的车道
        │  渲染时，update.lane & renderLanes 非 0 的才处理
        ↓
未落在 renderLanes 的更新 → 车道留在 pendingLanes，等下一次 render
```

这段链路的重点：**优先级在分配更新时确定，在调度时排序，在渲染时按 renderLanes 过滤**。

## 批处理原理

早期 React（17 之前）用 `expirationTime` 数字表示优先级，同一个事件回调里的多次 setState 会落到同一个 expirationTime，从而合并。Lane 模型下是同样的思路，只是换成"同一条车道位"：

```javascript
function handleClick() {
  setA(1); // 分配 DefaultLane
  setB(2); // 也分配 DefaultLane
  setC(3); // 还是 DefaultLane
  // 三个更新落在同一个 Lane 位，累积进 root.pendingLanes，
  // 只触发一次 ensureRootIsScheduled → 合并成一次 render
}
```

如果三次 setState 分别处于不同事件回调（或被 `await` 打断），就会落到不同批次、触发多次渲染。

### 位运算流程示意

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

## 面试答法

React 从 17 开始用 Lane 表示优先级，Lane 是一个 31 位的二进制数，每一位代表一条车道，比如 SyncLane、InputContinuousLane、DefaultLane、一组 TransitionLanes、一组 RetryLanes、IdleLane、OffscreenLane 等等。之所以用位运算而不是简单枚举，是因为一次更新可能同时属于多条车道，可以用或运算合并、用与运算判断是否包含、用与非清除，非常高效。取最高优先级车道时用 getHighestPriorityLane 做 lanes & -lanes，隔离出最低有效位，因为位数越靠右优先级越高，所以同步车道 SyncLane 在最右的第 0 位。React 用 root.pendingLanes 记录 root 上所有待处理车道，用 renderLanes 表示本次渲染实际处理的车道，只有落在 renderLanes 里的更新才会被处理；Lane 与 Scheduler 优先级通过 ensureRootIsScheduled 衔接，SyncLane 直接同步执行，其余依次映射到 UserBlocking、Normal、Idle。批处理的原理就是同一个事件回调里的多次 setState 落在相同 Lane 位，合并到一次 render。
