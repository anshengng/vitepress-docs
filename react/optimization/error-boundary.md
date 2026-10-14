# 错误边界 Error Boundary

## 核心思路

渲染期一旦抛错，JavaScript 的调用栈此时正处在 React 的调度里，
普通的 try/catch 包不住，React 会把这个错误往上抛，沿 fiber 树找最近的错误边界；
**找不到，就卸载整棵 React 树**——这就是白屏的来源。错误边界就是专门接住这类错误的组件。

```text
某个组件在 render 中抛错
    ↓
React 沿 fiber.return 向上寻找最近的 error boundary
    ↓
找到 → 边界渲染 fallback UI（只影响该边界子树，其余照常）
    ↓
找不到 → 卸载整棵 React 树 → 页面白屏
```

React 16 之前出错会保留已渲染的 UI，但界面可能处于不一致状态；
React 16 起改为「默认卸载整棵树」，宁可不显示也不显示错的，这也让错误边界变得必要。

## 类组件实现

错误边界是一个类组件，实现下面两个钩子中的一个（通常一起写）：

```jsx
class ErrorBoundary extends React.Component {
  state = { hasError: false };

  // 渲染阶段调用：返回新的 state，用于切换到 fallback
  // 必须是 static、纯函数，禁止副作用，禁止用 this
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
      return <h1>页面出错了</h1>;   // fallback UI
    }
    return this.props.children;     // 正常情况下渲染子树
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

注意 `getDerivedStateFromError` 必须是**静态方法**——它不依赖实例，只根据错误返回新的 state，
这样 React 才能在渲染期安全调用它（可能要重放）。

## 能捕获与不能捕获的范围

| 能捕获 | 不能捕获 |
|--------|----------|
| 后代组件 render 中抛出的错误 | 事件处理函数里的错误（onClick 等） |
| 后代生命周期方法抛出的错误 | 异步回调（setTimeout、Promise、requestAnimationFrame） |
| 后代组件构造函数抛出的错误 | 服务端渲染（SSR）过程中的错误 |
| | 错误边界组件自身抛出的错误（会继续向上找边界） |

为什么事件处理和异步不捕获：它们都**不在 React 的渲染 / 提交调用栈里执行**。
`onClick` 触发时，React 早已渲染完成，回调由浏览器事件系统直接调用；
`setTimeout` 更是脱离 React 调度。React 的错误捕获帧只包住它自己调度的渲染与生命周期，
所以这些场景必须靠 `try/catch`。

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

## 函数组件没有官方等价 API

到目前为止，React 没有提供 `useErrorBoundary` 之类的官方 Hook。
函数组件要接住渲染错误，只有两条路：

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

库内部同样是一个类组件，只是把 `getDerivedStateFromError` / `componentDidCatch`
和灵活的 fallback 渲染（fallback、fallbackRender、FallbackComponent）封装得更顺手。

## 与 try/catch 的分工

| 场景 | 手段 | 原因 |
|------|------|------|
| 命令式代码：解析、计算、调用外部 | try/catch | 错误发生在自己的调用栈里 |
| 异步回调：setTimeout、Promise | try/catch 或 .catch | 脱离 React 渲染栈 |
| JSX 渲染期抛错 | 错误边界 | 组件函数由 React 调度，try/catch 包不住 |

关键认知：JSX 里写 `<Child />` 只是**创建一个元素对象**，
真正「调用 Child 组件函数」这件事发生在 React 的 beginWork 里，
所以你在父组件里 try/catch 包住 JSX，是包不住子组件渲染抛错的。

## 错误上报

- 上报应放在 `componentDidCatch` 里，它带 `error` 与 `errorInfo.componentStack`，能定位出错组件栈。
- `getDerivedStateFromError` 只负责切 UI，不落日志，避免重复上报。
- 上报到远端前，注意脱敏，不要带敏感字段。

## React 19 的相关改进

React 19 给根节点增加了统一的错误回调，把「被捕获 / 未被捕获 / 可恢复」三类错误分开处理：

```jsx
createRoot(container, {
  onCaughtError: (error, errorInfo) => {
    // 被错误边界接住的错误，默认会 console.error
  },
  onUncaughtError: (error, errorInfo) => {
    // 没有被任何边界接住的错误
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

这三个回调让「错误上报」有了官方的统一入口，
配合已有的错误边界，可以做到「边界负责降级 UI、根回调负责统一收集」。

## 面试答法

错误边界解决的是渲染期抛错导致整棵 React 树被卸载、页面白屏的问题：React 出错时会沿 fiber 树向上找最近的错误边界，找到就渲染 fallback 只影响该子树，找不到就卸载整棵树。实现上它是一个类组件，靠静态的 getDerivedStateFromError 在渲染阶段切换 fallback state，靠 componentDidCatch 在 commit 阶段做上报，拿到 errorInfo.componentStack 定位组件栈，前一个必须是纯函数不能有副作用，后一个适合落日志。它的能力边界要记清楚：后代组件的 render、生命周期和构造函数里抛的错能捕获，但事件处理函数、setTimeout 和 Promise 这类异步回调、SSR，以及错误边界自身抛的错都捕获不到，因为这些都不在 React 的渲染提交调用栈里，得靠 try/catch；而 JSX 里写组件只是创建元素对象，真正调用组件函数发生在 React 的 beginWork，父组件 try/catch 包 JSX 是包不住的。函数组件至今没有官方等价 Hook，只能靠类组件包裹或用 react-error-boundary 库。React 19 又在 createRoot 上增加了 onCaughtError、onUncaughtError、onRecoverableError 三个回调，给错误上报提供了统一入口，配合错误边界正好形成「边界降级 UI、根回调收集错误」的分工。
