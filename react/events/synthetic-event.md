# 你写的 onClick，其实从没绑在按钮上

## 先看一个让人不信的结论

在代码里写下 `<button onClick={handleClick}>`，然后打开开发者工具查看这个按钮绑定的事件，会发现它身上干干净净，一个 `addEventListener` 都没有。

监听器到底挂哪去了？为什么 `e.stopPropagation()` 有时候拦不住 `document` 上的监听？为什么 `e` 明明长得像原生事件，却不是原生事件？

把它想成**写字楼的前台代收快递**：每个工位不单独装门铃，整栋楼只在一楼前台设一个收件处；快递到了前台，前台按收件人查到工位号，再沿着楼层一层层找上去。React 的事件系统，本质就是这套前台代收。

## React 为什么要自己造一层事件

浏览器之间的事件差异很多：绑定方式、`this` 指向、事件名大小写、兼容性行为都不一致。React 的做法是不直接暴露原生事件，而是包一层**跨浏览器一致的合成事件（SyntheticEvent）**，统一接口、统一行为，并把监听器挂到统一容器上做**事件委托**。

| 目标 | 手段 |
|------|------|
| 抹平浏览器差异 | 用 SyntheticEvent 包装原生事件，统一属性与方法 |
| 减少监听器数量 | 事件委托：只在根容器上注册，靠 DOM 冒泡统一分发 |
| 让事件参与调度 | 事件 → Lane 优先级映射，决定同步还是并发更新 |
| 统一阻止默认/冒泡 | 合成事件上的 preventDefault / stopPropagation 被统一处理 |

相当于前台统一代收，既不用给每个工位装门铃，也不用教每个人怎么签收。

## 前台设在哪：从 document 搬到 root

React 不在每个元素上挂 listener，而是把原生监听器注册在**一个统一容器**上，利用 DOM 事件冒泡加 `event.target` 反查是哪个 Fiber 触发的。

| 版本 | 绑定位置 |
|------|---------|
| React 16 及以前 | `document` |
| React 17 及以后 | **root 容器**（`ReactDOM.render(el, container)` 或 `createRoot(container)` 挂载的那个 container） |

```text
React 16：            React 17+：
  window                root container
    ↓                     ↓
  document              (所有监听器挂这里)
    ↓                     ↓ 冒泡
  所有 listener         目标元素
```

React 16 是把前台设在园区唯一的入口（document），所有快递都堆在一处；React 17 改成每栋写字楼自己的一楼大堂（root 容器）。

### 为什么 17 要从 document 搬到 root

```text
一个页面同时存在多个 React 版本 / 多个 root：
  root A（React 17）    root B（React 18）
```

| 挂在 document 的问题 | 挂在 root 的好处 |
|---------------------|-----------------|
| 多版本 React 监听同一 document，互相抢事件、无法隔离 | 各 root 监听各自容器，多版本可共存 |
| 嵌套 root 时事件会被外层 root 重复处理 | 多根嵌套互不冲突 |
| listener 与 root 无绑定关系，卸载 root 时不便清理 | 监听器生命周期随 root 走，销毁 root 即一并清理 |
| 与第三方直接监听 document 的代码互相干扰 | 作用域收敛在容器内，干扰最小化 |

这就是「整个园区只有一个总收发室」和「每栋楼一个收发室」的差别：楼拆了，收发室一起拆；一栋楼里的事也影响不到隔壁楼。

## 一次注册，整栋楼通用

React 17 在创建 root 时，会把所有支持的原生事件在容器上注册一遍（冒泡 + 捕获各一份），后续所有元素的事件都靠这一批监听器统一转发：

```javascript
// react-dom：为 root 容器注册所有支持的事件
function listenToAllSupportedEvents(rootContainerElement) {
  allNativeEvents.forEach((domEventName) => {
    // 非委托式事件（如 scroll、load，本身不冒泡）只在捕获阶段注册
    if (!nonDelegatedEvents.has(domEventName)) {
      listenToNativeEvent(domEventName, false, rootContainerElement) // 冒泡阶段
    }
    listenToNativeEvent(domEventName, true, rootContainerElement)    // 捕获阶段
  })
}
```

好处是：无论页面有多少元素、写了多少 `onClick`，真实注册的监听器数量都是**常数级**（只和事件种类数有关），而不是跟元素数线性增长。前台只有一个人，但整栋楼的快递都能收。

## 前台怎么判断这单急不急：事件名映射到 Lane

React 会根据**事件类型**推断这次更新的优先级，进而决定用同步还是并发调度：

| 事件分类 | 代表事件 | 优先级 | 对应 Lane |
|---------|---------|--------|-----------|
| 离散事件（Discrete） | `click`、`keydown`、`input`、`change` | `DiscreteEventPriority` | `SyncLane`（同步、立即刷新） |
| 连续事件（Continuous） | `mousemove`、`scroll`、`drag`、`pointermove` | `ContinuousEventPriority` | `InputContinuousLane` |
| 普通事件（Default） | `load`、`animationend`、`transitionend` | `DefaultEventPriority` | `DefaultLane` |
| 空闲事件（Idle） | 部分低优先级场景 | `IdleEventPriority` | `IdleLane` |

映射逻辑（简化）：

```javascript
// react-dom 中，事件名 → 优先级
function getEventPriority(domEventName) {
  switch (domEventName) {
    case "click":
    case "keydown":
    case "input":
      return DiscreteEventPriority // → SyncLane
    case "mousemove":
    case "scroll":
      return ContinuousEventPriority
    case "animationend":
    case "load":
      return DefaultEventPriority
    default:
      return DefaultEventPriority
  }
}
```

离散事件（比如点击）必须立刻、同步地反映到界面，否则会感觉卡顿，所以给最高优先级的 `SyncLane`；连续事件和普通事件允许并发调度、可被更高优先级打断。这就是「点一下按钮马上更新，但滚动、拖拽可以更平滑」背后的机制——前台判断这是个急件，立刻通知；是普通件，就先排着。

## 从收件到签收：一次派发的完整路线

原生事件在 root 上触发后，React 用 `event.target` 找到最近的 Fiber，再沿树的 `return` 指针向上遍历，收集沿途所有挂有监听函数的 Fiber，模拟出捕获与冒泡两个阶段。

```text
DOM 事件触发（root 上的原生监听器被调用）
      ↓ 由 event.target 找到最近的 Fiber（getClosestInstanceFromNode）
      ↓ 沿 return 指针向上遍历到根，收集沿途带监听函数的 Fiber
      ↓ 按监听函数的 phase 拆成两部分
捕获队列（root → target）+ 冒泡队列（target → root）
      ↓ 组装成 dispatchQueue，构造 SyntheticEvent 包装原生事件
      ↓ 捕获阶段按正序调用，冒泡阶段按逆序调用
      执行用户 handler（过程中可 preventDefault / stopPropagation）
```

收集方向和执行顺序是两件事，别混：

| 阶段 | 遍历方向 | 调用顺序 |
|------|---------|---------|
| 捕获 | 从 target 向上收集，但执行按 root → target | 正序 |
| 冒泡 | 从 target 向上收集 | 逆序（target → root） |

即使 JSX 里写的是 `onClick`（看起来像冒泡），React 内部依然同时为捕获和冒泡收集了监听信息，再由 `SyntheticEvent` 上的 `stopPropagation` 决定后续是否继续派发。注意合成事件的绑定是**委托式**的：你并没有在按钮上真正注册 `addEventListener`，只是在前台登记了「这个工位要收件」。

## 对象池：一段被移除的历史

React 17 以前，`SyntheticEvent` 采用**对象池（pooling）**：事件对象会被复用，回调执行完就被回收、属性清空。原因是早期浏览器分配对象成本高，复用能减少 GC 压力。副作用是异步里访问事件对象会拿到被清空的值，必须手动 `event.persist()` 才能真正持有。

React 17 起**移除池化**：现代 JS 引擎的对象分配已经足够廉价，事件对象不再复用，异步访问也安全，`persist()` 失去必要。这是 17 的一个破坏性（行为）变化——以前前台只有一张登记表，用完擦掉重写；现在每人一张，签完就归你。

## 合成事件与原生事件，到底差在哪

| 对比项 | 合成事件（SyntheticEvent） | 原生事件（NativeEvent） |
|--------|---------------------------|------------------------|
| 绑定位置 | 委托在 root 容器，不在元素上 | 直接绑在目标元素 |
| 事件名 | 驼峰，如 `onClick`、`onMouseMove` | 小写，如 `click`、`mousemove`，且不带 on |
| this 指向 | 可用箭头函数/绑定，行为统一 | 随绑定方式而变，需注意 this |
| 浏览器差异 | React 统一抹平 | 各浏览器不一致 |
| preventDefault | 统一方法，内部对接原生 | 各浏览器方法名可能不同 |
| stopPropagation | 只阻止合成事件继续派发；要拦原生须用 `nativeEvent.stopPropagation()` | 直接作用于 DOM 冒泡链 |
| 事件对象复用 | 17 起不再复用（旧版有池化） | 每次触发是新的原生事件对象 |
| 访问原生事件 | `event.nativeEvent` | 即本身 |

关于阻止冒泡要特别注意：合成事件的监听器委托在 root 上，所以 `e.stopPropagation()` 只影响 React 收集到的合成监听链，并不会天然阻断绑在 document 或其他元素上的真实原生监听器。就像你跟楼里的前台说「别再往上送了」，但快递员已经在一楼大厅，得直接跟他说，也就是 `e.nativeEvent.stopPropagation()`。

## 几个常被追问的点

- **为什么写 `onClick` 却要 `nativeEvent` 才能拦原生冒泡？** 因为 listener 委托在 root 上，`e.stopPropagation()` 只截断 React 的合成派发链，动不了 DOM 的真实冒泡，对绑在 document 或具体元素上的原生监听无效。
- **合成事件是同步还是异步触发？** 派发本身是同步的：原生事件一到，React 立即遍历 Fiber 收集并调用 handler；真正异步的是 handler 里 `setState` 触发的更新，它会按事件对应的 Lane 走同步或并发调度。
- **`onClick` 和 `onClickCapture` 的区别？** 二者都由同一个委托监听器分发，区别只在挂到哪个队列：`onClick` 进冒泡队列（target → root 逆序调用），`onClickCapture` 进捕获队列（root → target 正序调用）。

## 面试答法

React 自己实现了一套合成事件 SyntheticEvent，用来抹平浏览器在事件绑定、this 指向、事件名大小写、阻止默认行为上的差异，统一成驼峰命名、行为一致的接口。它用事件委托减少监听器数量：React 16 及以前把所有监听器挂在 document 上，17 起改挂到 root 容器上，这样多个 React 版本或多个 root 可以共存，嵌套 root 不会互相抢事件，监听器生命周期也随 root 一起销毁，注册数量只和事件种类有关、与元素数无关。事件触发后，React 由 event.target 找到最近的 Fiber，沿 return 指针向上遍历，收集沿途带监听函数的 Fiber，按 phase 拆成捕获队列和冒泡队列，构造 SyntheticEvent 后捕获正序、冒泡逆序地调用，同时把事件名映射到 Lane 优先级：click、keydown 这类离散事件给 SyncLane 需要同步更新，mousemove 这类连续事件和普通事件走并发调度。另外 React 17 以前事件对象有对象池会被复用，必须 persist() 才能异步访问，17 起移除了池化。
