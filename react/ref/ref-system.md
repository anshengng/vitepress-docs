# ref 体系与命令式访问

## 核心思路

React 是声明式的，而 ref 是它留给你的**命令式逃生口**：让你在需要时直接摸到 DOM 节点或组件实例。
ref 不参与渲染、不触发更新，它的全部意义在于——**在 commit 之后，拿到一个已经就绪的引用**。

| 形态 | 写法 | 说明 |
|------|------|------|
| 字符串 ref | `<div ref="box" />` | 16.3 起不推荐，后续移除；靠 `this.refs.box` 读取 |
| 对象 ref | `<div ref={objRef} />` | `{ current: 节点 }`，React 在 commit 阶段直接赋 current |
| 回调 ref | `<div ref={(el) => { ... }} />` | 挂载 / 卸载时以节点或 null 调用，可挂钩清理 |
| useRef | `const r = useRef(null)` | 函数组件里创建跨渲染稳定的 `{ current }` |
| createRef | `const r = createRef()` | 每次调用返回新的 `{ current: null }`，类组件常用 |

## React 何时把值写进 ref：commit 阶段

ref 的赋值**不在 render 阶段**。render 只负责产出元素，此时 DOM 尚未生成，`ref.current` 还停留在旧值或 null。

```text
render 阶段
    ↓ 不碰 ref（DOM 还没生成）
commit 阶段
    ├── mutation 子阶段：commitDetachRef 先把旧引用置空
    │        （更新或卸载时，回调 ref 会先被调用一次 null）
    └── layout 子阶段：commitAttachRef 把新节点 / 实例写入 ref.current
             ↓
      componentDidMount / useLayoutEffect 执行 → 此时 ref 已就绪
             ↓
      useEffect 执行 → ref 同样已就绪
```

由此得到一条实践规律：**在渲染期读写 `ref.current` 不可靠**（渲染可能被中断、丢弃），
除了 `useRef(init)` 的初始值之外，读写的时机应放在副作用里。

## 对象 ref 与 useRef

```jsx
function App() {
  const boxRef = useRef(null);   // 首次渲染创建一个 { current: null }

  useEffect(() => {
    // DOM 已就绪，可以直接量尺寸、聚焦、滚动
    boxRef.current.getBoundingClientRect();
  }, []);

  return <div ref={boxRef}>内容</div>;
}
```

`useRef` 的返回值在整个组件生命周期内是**同一个对象**，所以 `ref={boxRef}` 不需要每次渲染重新传。
改变 `ref.current` 不会触发任何重渲染——这正是它适合存「与渲染无关的可变值」的原因。

## 回调 ref 与清理函数

回调 ref 更灵活：挂载时以节点调用，更新或卸载时以 `null` 调用，可在其中做订阅 / 解绑。

```jsx
function App() {
  return (
    <div
      ref={(node) => {
        // 挂载：node 是 DOM 节点
        console.log('挂载', node);
        // 卸载：React 会以 null 再调一次
      }}
    />
  );
}
```

React 19 起，回调 ref 可以**返回一个清理函数**，用它替代「被调用 null」这套约定：

```jsx
function App() {
  return (
    <div
      ref={(node) => {
        const subscription = subscribe(node);
        // React 19：返回的函数在卸载（或 ref 变化）时执行
        return () => subscription.unsubscribe();
      }}
    />
  );
}
```

> 注意：一旦回调 ref 返回了清理函数，React 19 就不再对它调用 `ref(null)`。

## forwardRef：函数组件默认收不到 ref

函数组件每次渲染都是重新调用一遍函数，**没有稳定的实例对象**，
React 也不知道该把 ref 挂到哪个对象上，所以默认会报「Function components cannot be given refs」。
需要 `forwardRef` 显式转发：

```jsx
const Input = forwardRef(function Input(props, ref) {
  // 把父级传来的 ref 透传到内部真实 DOM 上
  return <input ref={ref} {...props} />;
});

// 使用
const inputRef = useRef(null);
<Input ref={inputRef} />;
```

类组件不同：它有实例（`this`），ref 会直接指向类实例，可调其方法、读其字段。

## useImperativeHandle：只暴露你想暴露的

直接把整个 DOM 节点交出去，等于把内部实现全公开。`useImperativeHandle` 可以自定义暴露的实例形态：

```jsx
const FancyInput = forwardRef(function FancyInput(props, ref) {
  const inputRef = useRef(null);

  // 父组件拿到的不是 DOM，而是这个受控的精简对象
  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current.focus(),
    clear: () => { inputRef.current.value = ''; },
  }));

  return <input ref={inputRef} />;
});

// 使用
const ref = useRef(null);
ref.current.focus();   // 只能调暴露出来的方法
```

## React 19：ref 作为普通 prop

React 19 起，函数组件可以直接把 `ref` 当作普通 prop 接收，**不必再包 forwardRef**：

```jsx
// React 19 写法：ref 就是普通 prop
function Input({ ref, ...props }) {
  return <input ref={ref} {...props} />;
}
```

`forwardRef` 仍然可用，但已被标记为待废弃；新代码直接解构 `ref` 即可。
这样做的前提是：React 19 把 `ref` 从「特殊属性」降级成了可以随 props 一起传递的普通字段。

## ref（模板 ref）与 useRef 的区别

| 对比项 | 模板 ref（`ref={...}` 属性） | useRef |
|--------|------------------------------|--------|
| 用途 | 让 React 把 DOM 节点 / 组件实例写进 current | 存任意跨渲染可变值（定时器 id、上一轮值、标志位） |
| current 由谁赋值 | commit 阶段由 React 自动填写 | 由你手动改写 |
| 初始值 | 渲染时为 null，commit 后填充 | `useRef(initialValue)` 直接给初值 |
| 变化是否触发渲染 | 否 | 否 |
| 能否跨渲染保持引用 | 需自己持有同一个 ref 对象 | 本身即稳定对象 |

一个常见混淆点：`useRef` **不是只能用来当 DOM ref**。
它更通用的身份是「一个跨渲染不变、改它不引发渲染的可变盒子」，
`useRef(null)` 只是恰好拿来接 DOM 而已。

```jsx
function Timer() {
  const timerRef = useRef(null);   // 存定时器 id，不触发渲染

  useEffect(() => {
    timerRef.current = setInterval(() => {}, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  return <span>计时中</span>;
}
```

> 小提醒：React 19 的 TypeScript 类型要求 `useRef` 显式传初始值（不再允许无参调用）。

## 常见陷阱

| 陷阱 | 后果 | 对策 |
|------|------|------|
| 渲染期读写 `ref.current` | 渲染可能被中断重放，拿到脏值 | 一律放 useEffect / useLayoutEffect |
| 直接把 DOM 交给父组件 | 内部实现完全暴露，耦合脆弱 | 用 useImperativeHandle 收口 |
| 组件卸载后仍用 ref | 访问已卸载节点，报错 | 清理函数里置空或取消引用 |
| 每次渲染重建回调 ref | 反复解绑 / 绑定，引发无谓调用 | 用 useCallback 稳定回调引用 |
| 误认为改 ref.current 会重渲染 | 界面不更新，逻辑出错 | 需更新 UI 就用 state，不用 ref |

## 面试答法

ref 是 React 里唯一的命令式逃生口，它不参与渲染也不触发更新，核心价值是在 commit 之后拿到一个已经就绪的节点或实例引用。它的赋值时机很关键：render 阶段完全不碰 ref，因为 DOM 还没生成，等到 commit 的 mutation 子阶段先由 commitDetachRef 把旧引用置空，再由 layout 子阶段的 commitAttachRef 把新节点写进 ref.current，所以 componentDidMount 和 useLayoutEffect、useEffect 里读到 ref 一定已经就绪，反过来在渲染期读写 ref.current 是不可靠的。ref 的形态里字符串 ref 早已废弃，主流是对象 ref、回调 ref、useRef 和 createRef，其中回调 ref 在挂载和卸载时会分别以节点和 null 调用，React 19 起还支持返回清理函数来替代调用 null。函数组件因为没有稳定实例、默认收不到 ref，过去必须用 forwardRef 转发，配合 useImperativeHandle 只暴露受控的方法，而 React 19 直接把 ref 降级成普通 prop，不用再包 forwardRef。最后要区分模板 ref 和 useRef：前者是让 React 帮你填 current 指向 DOM，后者本质是一个跨渲染稳定、改动不引发渲染的可变盒子，常用来存定时器 id 这类与渲染无关的值。
