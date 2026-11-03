# 错误边界 Error Boundary

## 先说一个真实的困惑

某个深层子组件里只写了 `throw new Error('boom')`，你想看看会发生什么。刷新页面——**整页白了**，连导航栏、侧边栏全都没了。

你第一反应是"我在父组件里包个 try/catch 不就行了"，于是：

```jsx
try {
  return <Child />;
} catch (err) {
  return <div>出错了</div>;
}
```

没用。页面照样白。

原因有两个，得摆在前面说清楚：一是 React 在渲染时抛错，会沿 Fiber 树向上找"最近的一道保护开关"，找不到就**卸载整棵 React 树**——白屏就是这么来的；二是 JSX 里的 `<Child />` 只是**创建了一个元素对象**，真正"调用 Child 组件函数"发生在 React 的 `beginWork` 里，早就跑出你这个 try 块了。

这个"保护开关"就是错误边界。把它想成楼里的**断路器**：哪一路短路，就只跳哪一路的闸，其他房间的灯照常亮。

## 错误边界就是一路断路器

先看没有断路器和有断路器的区别：

```text
某个组件在 render 中抛错
    ↓
React 沿 fiber.return 向上寻找最近的 error boundary
    ↓
找到 → 边界渲染 fallback UI（只影响该边界子树，其余照常）
    ↓
找不到 → 卸载整棵 React 树 → 页面白屏
```

这里补一个历史背景：React 16 之前，出错会保留已经渲染的 UI，但界面可能停在**不一致的中间状态**（一半新一半旧）。React 16 起改成「默认卸载整棵树」，宁可不显示也不显示错的，这也让错误边界从"可选优化"变成了必需品。

## 断路器长什么样：一个类组件

错误边界必须是一个类组件，实现下面两个钩子中的至少一个（通常两个一起写）：

```jsx
class ErrorBoundary extends React.Component {
  state = { hasError: false };

  // 渲染阶段调用：返回新的 state，用于切换到 fallback
  // 必须是 static、纯函数，不能有副作用，也不能用 this
  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  // commit 阶段调用：适合打日志、上报错误
  // 第二个参数 errorInfo 里的 componentStack 给出出错组件栈
  componentDidCatch(error, errorInfo) {
    reportError(error, errorInfo.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return <h1>页面出错了</h1>;   // fallback UI：这一路停电，只亮应急灯
    }
    return this.props.children;     // 正常情况下渲染子树，电流照常通过
  }
}

// 使用：包住可能出错的子树
<ErrorBoundary>
  <App />
</ErrorBoundary>;
```

两个钩子分工明确：

| 钩子 | 执行阶段 | 用途 | 约束 |
|------|----------|------|------|
| getDerivedStateFromError | render 阶段 | 切换 fallback state | static、纯，禁止副作用 |
| componentDidCatch | commit 阶段 | 副作用：上报、打点、日志 | 可含副作用；切 UI 应交给上一个钩子 |

为什么 `getDerivedStateFromError` 必须是**静态方法**？因为它不依赖实例，只根据错误返回新的 state，这样 React 才能在渲染期安全地调用它（这个阶段的工作甚至可能被重放，碰 `this` 就等于碰可能被丢弃的实例）。

## 断路器管得到和管不到的地方

| 能捕获 | 不能捕获 |
|--------|----------|
| 后代组件 render 中抛出的错误 | 事件处理函数里的错误（onClick 等） |
| 后代生命周期方法抛出的错误 | 异步回调（setTimeout、Promise、requestAnimationFrame） |
| 后代组件构造函数抛出的错误 | 服务端渲染（SSR）过程中的错误 |
| | 错误边界组件自身抛出的错误（会继续向上找边界） |

为什么事件处理和异步不捕获？因为断路器只在**"电路系统"内部工作**，而它们都不在 React 的渲染 / 提交调用栈里：

- `onClick` 触发时，React 早已渲染完成，回调由浏览器事件系统直接调用；
- `setTimeout` 更是彻底脱离 React 调度。

React 的错误捕获帧只包住它自己调度的渲染与生命周期。这些场景必须自己带个保险丝：

```jsx
// 事件处理里的错误，错误边界管不到，得自己 try/catch
function handleClick() {
  try {
    doSomethingRisky();
  } catch (err) {
    reportError(err);
  }
}
```

至于"错误边界自己抛错"，很好理解：断路器不能保护自己短路，它一坏，只能往上找上一级总闸。

## 函数组件没有官方等价 API

到目前为止，React 没有提供 `useErrorBoundary` 之类的官方 Hook。函数组件要接住渲染错误，只有两条路：

1. 外面套一层类组件的错误边界；
2. 使用社区库 `react-error-boundary`。

```jsx
import { ErrorBoundary } from 'react-error-boundary';

<ErrorBoundary
  fallbackRender={({ error }) => <h1>出错了：{error.message}</h1>}
  onError={(error, info) => reportError(error, info.componentStack)}
>
  <App />
</ErrorBoundary>;
```

库内部同样是一个类组件，只是把 `getDerivedStateFromError` / `componentDidCatch` 和灵活的 fallback 渲染（`fallback`、`fallbackRender`、`FallbackComponent`）封装得更顺手。

## 和 try/catch 怎么分工

| 场景 | 手段 | 原因 |
|------|------|------|
| 命令式代码：解析、计算、调用外部 | try/catch | 错误发生在自己的调用栈里 |
| 异步回调：setTimeout、Promise | try/catch 或 .catch | 脱离 React 渲染栈 |
| JSX 渲染期抛错 | 错误边界 | 组件函数由 React 调度，try/catch 包不住 |

一句话记住：**try/catch 保护"你亲自调用的代码"，错误边界保护"React 替你调用的代码"。**

## 错误上报的规矩

- 上报应放在 `componentDidCatch` 里，它带 `error` 与 `errorInfo.componentStack`，能定位出错组件栈。
- `getDerivedStateFromError` 只负责切 UI，不落日志，避免重复上报。
- 上报到远端前，注意脱敏，不要带敏感字段。

## React 19：给配电室加一个总记录

React 19 给根节点增加了统一的错误回调，把「被捕获 / 未被捕获 / 可恢复」三类错误分开处理：

```jsx
createRoot(container, {
  onCaughtError: (error, errorInfo) => {
    // 被错误边界接住的错误，默认会 console.error
  },
  onUncaughtError: (error, errorInfo) => {
    // 没有被任何边界接住的错误（会导致卸载、白屏的那类）
  },
  onRecoverableError: (error) => {
    // 可恢复错误，如水合不匹配；默认也会打印
  },
});
```

等价地，用 `<Root>` 组件也可以传这三个选项：

```jsx
<Root
  onCaughtError={(error, info) => reportError(error, info.componentStack)}
  onUncaughtError={(error, info) => reportError(error, info.componentStack)}
>
  <App />
</Root>
```

这三个回调让「错误上报」有了官方的统一入口，配合已有的错误边界，可以做到「边界负责降级 UI、根回调负责统一收集」。

## 面试答法

错误边界解决的是渲染期抛错导致整棵 React 树被卸载、页面白屏的问题：React 出错时会沿 fiber 树向上找最近的错误边界，找到就渲染 fallback 只影响该子树，找不到就卸载整棵树。实现上它是一个类组件，靠静态的 getDerivedStateFromError 在渲染阶段切换 fallback state，靠 componentDidCatch 在 commit 阶段做上报，拿到 errorInfo.componentStack 定位组件栈，前一个必须是纯函数不能有副作用，后一个适合落日志。它的能力边界要记清楚：后代组件的 render、生命周期和构造函数里抛的错能捕获，但事件处理函数、setTimeout 和 Promise 这类异步回调、SSR，以及错误边界自身抛的错都捕获不到，因为这些都不在 React 的渲染提交调用栈里，得靠 try/catch；而 JSX 里写组件只是创建元素对象，真正调用组件函数发生在 React 的 beginWork 里，父组件 try/catch 包 JSX 是包不住的。函数组件至今没有官方等价 Hook，只能靠类组件包裹或用 react-error-boundary 库。React 19 又在 createRoot 上增加了 onCaughtError、onUncaughtError、onRecoverableError 三个回调，给错误上报提供统一入口，正好形成「边界降级 UI、根回调收集错误」的分工。
