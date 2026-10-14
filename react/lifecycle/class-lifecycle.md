# 类组件生命周期（React 16 → 18）

## 核心思路

React 16 引入 Fiber 后可中断渲染，生命周期被重新划分成两类：
**渲染阶段**（可能被打断、暂停、丢弃重放）和**提交阶段**（一次性、不可中断）。
一批原本在渲染阶段执行的 `componentWill*` 钩子因此变得不安全而被废弃，
新增的两个钩子 `getDerivedStateFromProps`、`getSnapshotBeforeUpdate` 就是为补上它们的空缺。

```text
mount：
  constructor
      ↓
  getDerivedStateFromProps   （mount 与 update 每次渲染都会走）
      ↓
  render
      ↓
  React 更新 DOM 与 ref
      ↓
  componentDidMount          （副作用：请求、订阅、定时器）

update：
  getDerivedStateFromProps
      ↓
  shouldComponentUpdate      （返回 false 则跳过后续）
      ↓
  render
      ↓
  getSnapshotBeforeUpdate    （DOM 变更前读取，返回值交给 didUpdate 第三参）
      ↓
  React 更新 DOM 与 ref
      ↓
  componentDidUpdate

unmount：
  componentWillUnmount       （清理：解绑、clearTimeout、取消订阅）
```

## 挂载阶段（mount）

| 顺序 | 钩子 | 职责 |
|------|------|------|
| 1 | constructor | 初始化 state、绑定 this；禁止副作用 |
| 2 | getDerivedStateFromProps | 从 props 派生 state，静态纯函数 |
| 3 | render | 返回元素，必须纯；不能 setState、不能副作用 |
| 4 | componentDidMount | DOM 与 ref 已就绪；发请求、订阅、操作 DOM |

```jsx
class List extends React.Component {
  constructor(props) {
    super(props);
    this.state = { items: [] };
    this.handleClick = this.handleClick.bind(this);  // 绑定 this
  }

  componentDidMount() {
    // DOM 已就绪、ref 可用，适合发起数据请求或订阅
    this.fetchData();
  }

  render() {
    return <ul>{this.state.items.map((it) => <li key={it.id}>{it.name}</li>)}</ul>;
  }
}
```

## 更新阶段（update）

更新可能由自身 `setState`、父组件重渲染（新 props）或 `forceUpdate` 触发。

| 顺序 | 钩子 | 职责 |
|------|------|------|
| 1 | getDerivedStateFromProps | 每次渲染都会执行，即使 props 没变 |
| 2 | shouldComponentUpdate | 返回 false 可跳过 render 及后续 |
| 3 | render | 产出新的元素 |
| 4 | getSnapshotBeforeUpdate | render 后、DOM 变更前读取快照 |
| 5 | componentDidUpdate | DOM 已更新；副作用，注意条件判断防死循环 |

```jsx
getSnapshotBeforeUpdate(prevProps, prevState) {
  // 此时 DOM 还是旧的，可以读变更前的滚动位置
  if (prevProps.list.length < this.props.list.length) {
    return this.listRef.scrollHeight;
  }
  return null;
}

componentDidUpdate(prevProps, prevState, snapshot) {
  // snapshot 就是上面返回的值，用来把滚动位置修正到用户期望的位置
  if (snapshot !== null) {
    this.listRef.scrollTop += this.listRef.scrollHeight - snapshot;
  }
}
```

`componentDidUpdate` 里若无条件 `setState` 会形成死循环，务必带条件：

```jsx
componentDidUpdate(prevProps) {
  if (prevProps.userId !== this.props.userId) {   // 仅关键字段变化才发请求
    this.fetchUser(this.props.userId);
  }
}
```

## 卸载阶段（unmount）

`componentWillUnmount` 是唯一的卸载钩子，用于清理：

```jsx
componentWillUnmount() {
  clearInterval(this.timer);        // 清定时器
  this.unsubscribe();               // 取消订阅
  window.removeEventListener('resize', this.onResize);  // 解绑事件
}
```

## 被废弃的三个 will 钩子

| 旧名 | 新名（React 16.3+） | 废弃原因 |
|------|---------------------|----------|
| componentWillMount | UNSAFE_componentWillMount | 渲染期执行，可能被多次调用或整体丢弃 |
| componentWillReceiveProps | UNSAFE_componentWillReceiveProps | 同上；且父组件任意渲染都会触发，语义易误解 |
| componentWillUpdate | UNSAFE_componentWillUpdate | 同上；常被误用来做「变更前」副作用 |

原因的本质是 Fiber 的**可中断渲染**：render 阶段的工作可能被暂停、恢复、甚至整段丢弃重做，
这些 `componentWill*` 钩子都在 render 阶段执行，于是**可能被调用多次，或一次都不被调用**。
在其中发请求、改外部状态、写日志，就会出现重复请求、脏数据、内存泄漏等问题。
加 `UNSAFE_` 前缀是官方明确的警告信号——不是「存在漏洞」，而是「用在这些会重放的阶段会出 bug」。

## getDerivedStateFromProps 的引入背景

旧的 `componentWillReceiveProps` 在渲染阶段执行，可以访问 `this`、可以 `setState`、可以写副作用，语义混乱。
新钩子被设计成**静态纯函数**，只依赖 `(props, state)` 返回 state 增量：

```jsx
static getDerivedStateFromProps(props, state) {
  if (props.value !== state.prevValue) {
    return { prevValue: props.value, value: props.value };
  }
  return null;   // 无需更新则返回 null
}
```

约束换来了「可被安全重放」。但要注意它**每次渲染都会执行**（连 props 没变时也执行），
所以「用 props 派生 state」要非常克制，多数需求其实应该在 render 里直接算，而不是塞进 state 复制一份。

## getSnapshotBeforeUpdate 的引入背景

需要「DOM 变更前」读快照（滚动位置、尺寸）时，旧的 `componentWillUpdate` 已被废弃且不安全。
新钩子处在 render 完成、commit 变更 DOM 前的稳定窗口：

```text
render 完成
    ↓
getSnapshotBeforeUpdate   ← DOM 还是旧的，可安全读取布局信息
    ↓
commit 变更 DOM 与 ref
    ↓
componentDidUpdate(prevProps, prevState, snapshot)   ← snapshot 回传进来
```

它的返回值被 React 缓存，作为 `componentDidUpdate` 的第三个参数回传，
正好完成「变更前记录 → 变更后修正」这一对操作。

## 生命周期与 Hooks 的对应关系

| 类生命周期 | 函数组件等价物 |
|------------|----------------|
| constructor | useState / useRef 的初始值，或在函数体内初始化 |
| getDerivedStateFromProps | 渲染期直接用 props 计算，或 useState + 手动比较 props |
| shouldComponentUpdate | React.memo / useMemo |
| render | 函数组件函数体本身 |
| componentDidMount | useEffect(fn, []) |
| componentDidUpdate | useEffect(fn)（无依赖）/ useEffect(fn, [deps]) |
| componentWillUnmount | useEffect 的清理函数（return () => {...}） |
| getSnapshotBeforeUpdate | useLayoutEffect 配合 ref 在绘制前读 DOM |

这张表是「能力等价」而非「一一映射」：
类生命周期是按时间点切开的，而 Effect 把「建立 + 清理」打包在一起，
再用依赖数组控制执行时机，组合能力更强。

## React 18：StrictMode 下的双调用

```text
开发模式 + <StrictMode>
    ↓
渲染期函数被双调用：
  类组件的 constructor、render、shouldComponentUpdate 等，
  函数组件函数体，以及 useState / useMemo / useReducer 的初始化函数
    ↓
Effect 走 setup → cleanup → setup 一遍
    ↓
目的：暴露「渲染不纯」「缺少清理函数」的副作用问题
```

双调用只发生在**开发模式**，生产构建不会。
它的用意是让你提前发现「不该在渲染期执行的副作用」——
如果你的 `render` 里发了请求、改了外部变量，双调用会立刻把问题暴露出来。
所以类组件里同样要保证 render 是纯函数、副作用只放在 `componentDidMount` / `componentDidUpdate` / `componentWillUnmount`。

## 面试答法

类组件的生命周期按挂载、更新、卸载三个阶段划分。挂载依次是 constructor 初始化 state 和绑定 this、getDerivedStateFromProps 从 props 派生 state、render 产出元素、componentDidMount 在 DOM 和 ref 就绪后做请求和订阅；更新阶段是 getDerivedStateFromProps 每次渲染都走、shouldComponentUpdate 返回 false 可以跳过、render、getSnapshotBeforeUpdate 在 DOM 变更前读快照、最后 componentDidUpdate 拿到快照做修正，注意里面无条件 setState 会死循环；卸载只有 componentWillUnmount 负责清理。React 16 引入 Fiber 后可中断渲染，render 阶段的工作可能被暂停、恢复甚至整段丢弃重做，所以 componentWillMount、componentWillReceiveProps、componentWillUpdate 这些在渲染期执行的钩子会被多次调用或一次都不被调用，因此加了 UNSAFE_ 前缀标记废弃，取而代之的是静态纯函数 getDerivedStateFromProps 和在变更 DOM 前读快照的 getSnapshotBeforeUpdate。和函数组件 Hooks 对应起来，constructor 对应 useState 初始化、componentDidMount 对应 useEffect 空依赖、componentDidUpdate 对应 useEffect 带依赖、componentWillUnmount 对应 Effect 的清理函数，是能力等价而非一一映射。最后 React 18 在开发模式加 StrictMode 下会双调用渲染期函数、并让 Effect 走 setup 到 cleanup 再 setup 一遍，用来暴露渲染不纯和缺少清理的副作用问题。
