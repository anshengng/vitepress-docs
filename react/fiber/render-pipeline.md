# 渲染全流程串讲：从 Element 到 Fiber 再到屏幕

> 本篇是 Fiber 架构的「总串讲」：把 [Element 与 Fiber](/react/jsx/element-vs-fiber)、[双缓冲与两阶段](/react/fiber/double-buffer)、[协调与 Diff](/react/fiber/reconcile-diff) 三篇的内容串成一条完整的时间线。先建立全局地图，再深入单篇，阅读顺序任选。

## 一张图先看全貌

以一次点击导致的 `setState` 为例，从事件到屏幕更新，完整链路是：

```text
点击按钮 → setState(count+1)
   │
   ▼
① 调度：创建 update 入队，按 Lane 排优先级，请求一次渲染
   │
   ▼
② render 阶段（可中断，纯内存，不碰屏幕）
   │   workLoop 深度优先遍历 workInProgress 树：
   │
   ├─ beginWork(fiber)
   │     函数组件 → 调用组件函数 → 得到【新 Element】
   │     reconcileChildFibers：Element + key/type 与旧 Fiber 比对
   │       ├─ 匹配   → createWorkInProgress 复用 Fiber，新 props 写入 pendingProps
   │       ├─ 不匹配 → createFiberFromElement 新建 Fiber     ← Element 在这里变成 Fiber
   │       └─ 旧没了 → 标记 Deletion
   │
   ├─ completeWork(fiber)（回溯时）
   │     host 节点（div 等）→ createInstance 建出【离屏 DOM】挂到 stateNode
   │     把子树副作用汇总，标记 flags（Placement / Update / ChildDeletion）
   │
   ▼
③ finishedWork：整棵新树建好，副作用清单已收集完毕
   │
   ▼
④ commit 阶段（不可中断，同步一口气执行）
   │
   ├─ mutation 子阶段：按 flags 真正增 / 删 / 改 DOM；跑 useLayoutEffect 清理
   ├─ layout 子阶段：DOM 已更新但未绘制；执行 useLayoutEffect、绑定 ref
   ├─ root.current = finishedWork（双缓冲原子切换）
   │
   ▼
⑤ 浏览器 paint 绘制新画面
   │
   ▼
⑥ 异步执行 passive effects：useEffect 回调
```

下面逐段展开。

## 第 0 步：三种"树"的关系

全流程之所以绕，是因为同时存在三棵树，先分清：

| 树 | 组成 | 存在时机 | 类比 |
|----|------|---------|------|
| Element 树 | `jsx()` 产出的不可变对象 | 每次组件函数执行时新建，用完即弃 | 图纸 |
| Fiber 树 | current 树（屏幕上）+ workInProgress 树（内存里） | 常驻内存，跨更新复用 | 施工队名册 |
| DOM 树 | 真实节点 | 浏览器里 | 交付的房子 |

对应关系：**一个 Element 描述一个节点"应该长什么样"；一个 Fiber 记录这个节点"现在什么状态、改到哪了"；一个 DOM 是最终产物。**

```text
Element 树          Fiber 树              DOM 树
<App/>       →     Fiber(tag=0)    →     （无实体，组件不产生 DOM）
 ├─<div>     →     Fiber(tag=5)    →     <div id=...>
 │   ├─<p>    →    Fiber(tag=5)    →       <p>
 │   └─<List/>→    Fiber(tag=0)    →       （无实体）
```

## 第 1 步：触发与调度——更新进入队列

`setState`（准确说是 `dispatchSetState`）做的事：

1. 把新值包成一个 `update` 对象，挂进该 Fiber `updateQueue` 的**环形链表**
2. 从当前 Fiber 向上遍历，把这次更新的 Lane（优先级）冒泡标记到根
3. 调用 `scheduleUpdateOnFiber(root, fiber, lane)`，向 Scheduler 请求一次渲染回调

注意：**此刻组件函数一次都还没执行**，Element 还不存在。调度细节见 [Lane 优先级模型](/react/scheduler/lane-model) 与 [Scheduler 与时间切片](/react/scheduler/scheduler-slice)。

## 第 2 步：render 阶段——Element 变成 Fiber

调度回调开始执行 `performConcurrentWorkOnRoot`，核心是一个**深度优先的可中断遍历**：

```javascript
function workLoopConcurrent() {
  while (workInProgress !== null && !shouldYield()) {
    performUnitOfWork(workInProgress)   // 处理一个 Fiber
  }
}

function performUnitOfWork(unitOfWork) {
  const next = beginWork(unitOfWork)    // 向下：展开子节点
  if (next === null) completeUnitOfWork(unitOfWork) // 叶子：回溯
  else workInProgress = next                       // 否则继续向下
}
```

### beginWork：Element → Fiber 的"接头点"

对函数组件 Fiber 来说，beginWork 里发生的事：

```javascript
// 1. 取出待处理的更新，算出新 state（跑 reducer）
const newState = processUpdateQueue(fiber)

// 2. 调用组件函数 → 得到本次渲染的【新 Element】
const children = App(props)     // 你的 JSX 在这里被执行

// 3. reconcile：拿新 Element 与 fiber.child 链表逐个比对
const newChild = reconcileChildFibers(fiber, children)
```

reconcile 的匹配规则（单链表同层比较）：

| 情况 | 处理 |
|------|------|
| `element.key === oldFiber.key && element.type === oldFiber.type` | `createWorkInProgress(oldFiber, element.props)` 复用，新 props 写入 `pendingProps` |
| 不匹配 | `createFiberFromElement(element)` 新建 Fiber |
| 旧 Fiber 多余 | 标记 `ChildDeletion` 副作用 |

**这就是 Element 与 Fiber 发生关联的唯一时刻**：Element 的 `type` 变成 Fiber 的 `tag`/`type`，Element 的 `props` 变成 Fiber 的 `pendingProps`，`key` 用于匹配。Element 本身用完即弃，Fiber 活下来继续工作。

### completeWork：为 host 节点建出离屏 DOM

beginWork 走到叶子后回溯，completeWork 对 `HostComponent`（div/p/span）做：

```javascript
// 由 element.type ('div') 创建真实 DOM 对象，但还没插入文档
const dom = createInstance('div', finishedWork.pendingProps)
finishedWork.stateNode = dom
// 把子 DOM append 进来，形成"离屏 DOM 子树"
```

同时在这里给 Fiber 打 `flags`（Placement / Update），并**向上冒泡汇总**成一条 effect 链表——commit 阶段只遍历这条链表，不重走整棵树。

### render 阶段可以中断的原因

整个过程只写内存（Fiber 树 + 离屏 DOM），屏幕上的 current 树和 DOM 完好无损。时间片用完就 `shouldYield()` 停下，下次从 `workInProgress` 指针继续；有更高优先级更新插队，直接丢弃半成品重来（双缓冲保证不脏）。

## 第 3 步：commit 阶段——把变更清单一次性上屏

render 产出 `root.finishedWork` 后进入 commit。为什么不可中断？DOM 改到一半停下，用户会看到**结构残缺、新旧混杂**的撕裂画面。

commit 遍历 effect 链表，分三个子阶段：

| 子阶段 | 干什么 | 关键钩子 |
|--------|--------|---------|
| before mutation | 记录将删除子树的 DOM 引用 | `getSnapshotBeforeUpdate` |
| mutation | **真正操作 DOM**：插入新子树、更新属性文本、删除旧节点 | `useLayoutEffect` 的【清理函数】 |
| layout | DOM 已更新、浏览器未绘制：完成 ref 挂载等收尾 | `useLayoutEffect` 回调、`componentDidMount/Update` |

最后一步是双缓冲的原子切换：

```javascript
root.current = finishedWork   // 新树转正，旧树降级为下一轮的 wip
```

## 第 4 步：绘制与 passive effects

commit 同步跑完后浏览器才 paint。此时画面已经是新的，React 再异步调度一次 `flushPassiveEffects` 执行 `useEffect` 回调——放在绘制之后，所以它不阻塞渲染。

```text
commit 结束 ──► 浏览器 paint ──► (下一帧宏任务) useEffect 执行
```

## 完整例子：一次点击的旅程

```jsx
function App() {
  const [count, setCount] = useState(0)
  return <div onClick={() => setCount(count + 1)}>{count}</div>
}
```

1. 首次 `root.render(<App/>)`：为 App 建 Fiber → beginWork 执行函数得到 `<div>0</div>` Element → 新建 div Fiber → completeWork 建出 `<div>0</div>` DOM → commit 插入容器 → 异步跑 effect
2. 点击：`setCount(1)` → update 入队 → 调度
3. render：克隆出 wip 树 → beginWork(App) 重跑函数，`useState` 从队列取出 1，返回新 Element `<div>1</div>` → reconcile：key/type 匹配，复用 div Fiber，`pendingProps.children = 1` → completeWork：div 文本变化，打 `Update` flag
4. commit：mutation 里 `updateTextContent(dom, '1')` → layout → 切换 current
5. 浏览器绘制出 `1`

注意第 3 步里：**组件函数重跑了、Element 新建了，但 div 的 Fiber 和 DOM 都是复用的**——这就是"React 每次渲染都重新执行组件函数，界面却不闪"的原因。

## 与 Vue 的对照（帮助记忆）

| | React | Vue |
|---|---|---|
| 描述对象 | Element（每次 render 新建） | VNode（每次 render 新建） |
| 运行时实例 | Fiber（常驻，含状态/队列/DOM 引用） | 组件实例 instance + ReactiveEffect |
| 触发方式 | setState 显式重渲染，自顶向下 | 响应式依赖收集，精确到组件 |
| 可否中断 | render 阶段可中断（时间切片） | 不可中断，微任务批量更新 |
| 改 DOM 时机 | completeWork 建离屏 DOM，commit 统一上屏 | patch 时边 diff 边直接操作 DOM |

## 面试答法

一次 React 更新分两大阶段。触发时 setState 先把 update 入队并按 Lane 调度。接着是 render 阶段：从根出发对 workInProgress 树做可中断的深度遍历，beginWork 里执行组件函数得到新 Element，reconcileChildFibers 用 key+type 把 Element 和旧 Fiber 比对，匹配则 createWorkInProgress 复用并把新 props 写进 pendingProps，不匹配则 createFiberFromElement 新建——这就是 Element 与 Fiber 的关联时刻；回溯时 completeWork 为 host 节点创建离屏 DOM 并打上 Placement/Update 等 flags 汇总副作用。整棵树建好后进入 commit 阶段，同步不可中断地遍历 effect 链表，分 before mutation、mutation（真正增删改 DOM）、layout（useLayoutEffect、ref）三个子阶段执行，最后 root.current = finishedWork 原子切换双缓冲树。浏览器绘制之后再异步执行 useEffect。三种树各司其职：Element 是每次新建的图纸，Fiber 是常驻复用的工人，DOM 是交付的房子。
