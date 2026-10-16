# React Fiber 架构

## 题目

> 为什么 React 需要 Fiber？它解决了什么问题？讲一下 Fiber 节点结构、双缓冲、时间切片和两阶段渲染。

## 为什么需要

React15（Stack Reconciler）：更新时**递归遍历组件树**，diff + 构建一口气干完，不可拆分、不可中断。

```
用户输入 → setState
              │
              ▼
┌──── 递归调用栈（同步、不可中断）─────┐
│ A → B → C → D → E → ... 一路递归到底  │
│        再一路冒泡回来                 │
└──────────────────────────────────┘
组件树一大，这一趟可能 > 100ms：
帧1 ✅  帧2 ❌  帧3 ❌ …… 动画掉帧、输入没反应
```

浏览器每帧约 16.6ms（60fps），除了跑 JS 还要 style → layout → paint。
JS 连续霸占主线程，渲染和用户响应就全被卡住。

**Fiber 的目标：把"一整块不可中断的大活"拆成"一粒粒可暂停、可恢复的小活"。**

## 核心要点

### 一、长任务卡帧时间线（Fiber 前后对比）

```
每帧预算 16.6ms：

Stack（React15）                    Fiber（React16+）
├─帧1─┤├─帧2─┤├─帧3─┤             ├─帧1─┤├─帧2─┤├─帧3─┤
██████████████████                  █▌   █▌   █▌   ✅完成
│←── reconcile 80ms ──→│             每帧只干一小片，帧间留给渲染/输入
动画❌  输入❌  输入❌                   动画✅  输入✅（用户优先）
```

### 二、Fiber 节点 = 链表结构（child / sibling / return）

把递归树改成**三指针链表**，就能"走一步歇一步"：

```
        Fiber 树（第一个孩子 + 右兄弟 + 父指针）

            A
            │ child
            ▼
            B ─sibling─► C ─sibling─► D
            │ child          │ child
            ▼                ▼
            E ─sibling─► F   G

深度优先遍历：A → B → E → F → C → G → D
每一步都只是"从当前节点找下一个"，不依赖递归栈
→ 随时可以停，下次从停的地方接着走
return 指针：子树走完回到父亲，继续找下一个兄弟
```

```javascript
{
  type: 'div',                // 对应的元素 / 组件
  key: null,
  stateNode: 真实DOM或实例,     // 与 DOM / 类实例的关联
  child: 第一个子Fiber,         // ↓
  sibling: 右边第一个兄弟,       // →
  return: 父Fiber,             // ↑
  pendingProps, memoizedProps, memoizedState,  // props/state 快照
  flags: 增删改标记             // commit 阶段消费
}
```

本质：**用链表模拟调用栈**——递归的栈帧不可控，链表的指针可控可暂停。

### 三、时间切片（Scheduler 调度）

```
一帧 16.6ms 预算：
├─ 浏览器自己的活（style/layout/paint/输入）┤├─ 空闲区域 ├┤
                                             ▲
                                  React 在这里干活（约 5ms 一片）

工作循环（示意）：
while (还有下一个 Fiber 节点 && 没超时 && 没有更高优先级任务) {
  处理 workInProgress 指向的节点 → 指针推进到下一个
}
超时/高优任务来了 → 存档（记住当前节点）→ 让出主线程
下一帧 → 从存档处继续
```

- **优先级（Lane 模型）**：用户输入 > 过渡更新 > 空闲更新，高优先级可插队
- **workInProgress**：指向"正在处理"的指针，像书签一样记录进度

### 四、双缓冲（current 树 ↔ workInProgress 树）

```
屏幕上：   current 树（正在显示）
内存里：   workInProgress 树（对照 current 一边 diff 一边构建）

  更新 N：workInProgress = 基于 current 打补丁的新树
  commit：DOM 应用变更 → 两棵树指针互换 → workInProgress 变成新的 current

中断/失败：workInProgress 直接扔掉，屏幕上的 current 毫发无损
（类似显卡双缓冲：后台画好一帧，再一键切换，看不到"画一半"的画面）
```

### 五、两阶段流程（render 可中断 vs commit 不可中断）

```
setState
   │
   ▼
① Render / Reconcile 阶段（可中断 ✅）
   遍历 Fiber 链表，diff 新旧子树，在 workInProgress 树上打 flags 标记
   纯计算、不碰真实 DOM → 中断了扔掉重来也没有副作用
   │
   ▼
② Commit 阶段（不可中断 ❌，同步一口气）
   before mutation → 读 DOM 快照（getSnapshotBeforeUpdate）
   mutation       → 真实增删改 DOM
   layout         → 同步执行 componentDidMount / useLayoutEffect 等
```

commit 为什么不可中断：DOM 改一半用户会看到残缺界面，且布局类生命周期必须保证**同步且只执行一次**。

### 六、可中断带来的新问题（一句带过）

render 阶段可能"走了又回头重放"，其中的生命周期可能**被调用多次**：
`componentWillMount / componentWillReceiveProps / componentWillUpdate` 被标记 `UNSAFE_`，React18 全面并发后废弃，用 `getDerivedStateFromProps`、`getSnapshotBeforeUpdate` 等纯函数替代。

与 Vue 一句对比：Vue 靠依赖追踪做**细粒度**更新，天然只更新受影响的组件，基本不需要时间切片；React 是"重跑组件"的粗粒度模型，只能靠 Fiber + 调度把大活切片。

## 面试答法

### 30 秒版

Fiber 是 React16 重写的协调架构。React15 用递归同步渲染，组件树大的时候一次更新可能霸占主线程上百毫秒，动画和输入都卡。Fiber 做了三件事：一是把组件树改成 child、sibling、return 三指针的链表，把递归变成可暂停的循环；二是引入 Scheduler 时间切片，每帧只干几毫秒就通过 shouldYield 让出主线程，保证渲染和用户响应，高优先级任务还能插队；三是用双缓冲，在内存里的 workInProgress 树上构建和 diff，commit 阶段才一次性同步应用到 DOM，所以 render 阶段可以随时中断丢弃，失败也不影响页面。代价是 render 阶段生命周期可能多次调用，一批 will 类生命周期被标 UNSAFE 废弃。

### 深入版

1. **先抛问题**：React15 递归同步 → 长任务卡帧，画 80ms 长任务时间线
2. **讲链表化**：三指针把递归树变成可暂停的深度优先遍历（本质：链表模拟调用栈）
3. **讲调度**：时间切片 + Lane 优先级，每帧 5ms 一片，高优先级插队
4. **讲双缓冲**：current ↔ workInProgress，commit 后指针互换，中断可丢弃
5. **讲两阶段**：render 纯计算可中断；commit 改 DOM 不可中断（残缺画面 + 生命周期单次）
6. **延伸收尾**：UNSAFE_ 生命周期的由来；Vue 依赖追踪细粒度更新一句话对比

### 常见追问

- **diff 发生在哪个阶段？** → render/reconcile 阶段，结果以 flags 标记在 workInProgress 树上，commit 阶段统一消费
- **commit 为什么不能切片？** → DOM 改一半会呈现残缺界面，且布局类生命周期必须同步执行且只执行一次
- **时间切片固定是 5ms 吗？** → 是 yield 检查点的工作预算，会根据优先级和浏览器空闲情况动态调整
- **Fiber 是线程吗？** → 不是，JS 仍然单线程，Fiber 只是"可中断恢复的数据结构 + 调度策略"
- **React18 并发和 Fiber 什么关系？** → Fiber 是地基，startTransition、Suspense 等并发特性在其之上全面启用
