# React 19：那些以前要自己搭的脚手架

## 一个提交按钮要写四十行

写过一个最普通的表单提交：`e.preventDefault()` 拦住默认行为、`const [pending, setPending] = useState(false)`、`try/catch` 抓错误、成功后再手动清空输入框、失败还要把错误文案挂到界面上。一个"提交"动作，四五十行，大部分代码都在处理状态和异常，跟业务没关系。

React 19 的意思很直接：这些活以后它来干。全篇用餐厅点单来打比方，你会看到它把一整条点单流程都收进了工具箱。

## 这次改了什么

React 19 于 2024 年底发布，改动集中在三块：**表单与 Actions**、**数据读取（use）**、**人机接口的简化（ref / Context / 元数据）**。

| 类别 | API | 状态 |
|------|-----|------|
| 表单 / Actions | `useActionState`、`<form action>`、`useFormStatus` | 稳定 |
| 乐观更新 | `useOptimistic` | 稳定 |
| 数据读取 | `use(Promise)` / `use(Context)` | 稳定 |
| ref | ref 作为普通 prop、ref 清理函数 | 稳定 |
| Context | `<Context>` 直接作 Provider | 稳定 |
| 元数据 | `title` / `meta` / `link` 提升到 head | 稳定 |
| 资源 | `preload` / `preinit` / `prefetchDNS` / `preconnect` | 稳定 |
| 组件 | `<Activity>`、`useEffectEvent` | 较新，随小版本转正 |
| 废弃 | `propTypes`、函数组件 `defaultProps`、字符串 ref 等 | 移除 |

## Actions：把单子直接递给服务员

Action 是把一次异步提交（表单、按钮）统一起来的模型：把 async 函数交给 `action`，由 React 自动管理 pending、错误和提交后的状态。

```tsx
import { useActionState } from 'react';

async function submit(prevState, formData) {   // React 会传上一轮状态和这次的表单数据
  const name = formData.get('name');
  const res = await api.save({ name });
  if (!res.ok) return { error: '保存失败' };    // 返回值会成为新的 state
  return { ok: true };
}

function Form() {
  const [state, formAction, isPending] = useActionState(submit, null); // 初始状态 null
  return (
    <form action={formAction}>    {/* 单子直接交给服务员，不用自己 preventDefault */}
      <input name="name" />
      {/* pending 由 React 维护，不用自己 setPending */}
      <button disabled={isPending}>{isPending ? '提交中...' : '提交'}</button>
      {state?.error && <p>{state.error}</p>}
    </form>
  );
}
```

`useActionState` 返回 `[当前状态, 提交函数, 是否 pending]`，签名对应 `(action, 初始状态)`；提交函数会被包成一个走 Transition 的 action，因此提交期间界面保持可交互，不会被一次请求卡死。

`useFormStatus` 则在**子组件**里读取最近父 `<form>` 的提交状态：

```tsx
import { useFormStatus } from 'react-dom';

function SubmitButton() {
  const { pending } = useFormStatus(); // 看最近那个父表单忙不忙
  return <button disabled={pending}>提交</button>;
}
```

这相当于后厨门口的看板：按钮本身不知道订单详情，但只要抬头看一眼所属表单的牌子，就知道该不该禁用。

`<form action={fn}>` 直接接受函数，提交时以 `FormData` 传入，React 会自动 `preventDefault`，无需手写 `onSubmit`。

## useOptimistic：先上凉菜，后厨没了再撤

在请求返回前先「假定成功」地更新 UI，失败后再回滚到真实数据。

```tsx
import { useOptimistic } from 'react';

function Messages({ messages, send }) {
  const [optimistic, addOptimistic] = useOptimistic(
    messages,
    (current, text) => [...current, { id: 'temp', text, pending: true }], // 怎么插临时项
  );

  async function formAction(formData) {
    addOptimistic(formData.get('text')); // 立即插一条临时项，先让客人看到
    await send(formData.get('text'));    // 真请求
    // 成功后 messages 更新，乐观项被真实数据替换
  }

  return <form action={formAction}>...</form>;
}
```

要点：`useOptimistic` 只在 Action 内部有效，Action 结束后自动回到真实值；它不做真正的状态持久化，只是「过渡显示」，失败回滚是自动发生的。

## use()：催菜不用挑时候

`use` 是一个新的读取 API，可在**条件分支**里调用——它是读取型 API，不受 Hook 调用顺序规则约束。

```tsx
import { use, Suspense } from 'react';

function Comments({ commentsPromise }) {
  const comments = use(commentsPromise); // 菜没好就先挂起，由 Suspense 兜住
  return <ul>{comments.map((c) => <li key={c.id}>{c.text}</li>)}</ul>;
}

function Card({ theme }) {
  if (cond) {
    const t = use(themeContext); // use(Context) 允许条件调用
  }
}
```

- `use(Promise)` 与 Suspense 配合；它**不做缓存**，每次渲染拿到新 Promise 都会重新挂起，所以 Promise 应在渲染外创建或缓存。相当于每催一次都重新下单，后厨只会更乱。
- `use(Context)` 可替代 `useContext`，并允许在条件里读取。

## ref：包间钥匙直接给客人

React 19 起，函数组件的 `ref` 就是普通 prop，不必再包一层 `forwardRef` 这个"中介"。

```tsx
// 旧写法：还得用 forwardRef 转发
const Input = forwardRef((props, ref) => <input ref={ref} {...props} />);

// React 19：ref 当普通 prop 接住就行
function Input({ ref, ...props }) {
  return <input ref={ref} {...props} />;
}
```

ref 回调还支持返回清理函数，替代以前在回调里手动判断旧节点：

```tsx
<input
  ref={(node) => {
    // 挂载时拿到 node
    return () => {
      // 卸载或 ref 变化时调用，做清理（如解绑、断开观察器）
    };
  }}
/>
```

`forwardRef` 仍可用（兼容），但新代码不再需要。

## Context：门牌直接挂门上

```tsx
// 旧写法：还得套一层 .Provider
<ThemeContext.Provider value="dark"><App /></ThemeContext.Provider>

// React 19：Context 自己就是门牌
<ThemeContext value="dark"><App /></ThemeContext>
```

## 表单还顺手帮你做了这些

- `<form action={fn}>`：函数型 action，React 自动阻止默认提交。
- 提交完成后 React 会**重置非受控字段**（原生表单行为），不用自己清空。
- 配合 `useActionState` / `useFormStatus` 管理 pending 与错误。
- `react-dom` 提供 `requestFormReset`，可手动重置表单。

## title / meta / link：菜单可以写在包间里

可以在组件树任意位置渲染 `<title>`、`<meta>`、`<link>`，React 会自动提升到 `<head>`。

```tsx
function Page() {
  return (
    <>
      <title>产品详情</title>
      <meta name="description" content="..." />
      <link rel="canonical" href="..." />
    </>
  );
}
```

好处：元数据随组件生命周期管理，SSR 时也能正确输出，无需再依赖 helmet 类库。等于菜单直接写在包间墙上，最后由店里统一收到前台，不用再单独找个人传话。

## 资源预加载：提前把菜备好

`react-dom` 暴露一组预加载 API，配合 `<link rel="stylesheet" precedence>` 使用：

```tsx
import { preload, preinit, prefetchDNS, preconnect } from 'react-dom';

preload('/font.woff2', { as: 'font', type: 'font/woff2' }); // 先把这道菜备上
preinit('/style.css', { as: 'style' });                     // 提前初始化并插入
preconnect('https://cdn.example.com');                      // 提前和供货商建立联系
prefetchDNS('https://api.example.com');                     // 提前问到供货商地址
```

```tsx
// 样式表：React 按 precedence 排序，并保证在依赖它的组件渲染前插入
<link rel="stylesheet" href="/a.css" precedence="default" />
```

异步脚本用 `async` 属性写在组件里，由 React 负责在合适时机插入并保证执行顺序。

## 被移除的东西

| 项 | 说明 |
|----|------|
| `propTypes` | 运行时类型检查移除（改用 TypeScript 等） |
| 函数组件的 `defaultProps` | 不再支持（类组件仍可用），改用参数默认值 |
| 字符串 ref | `ref="input"` 移除，改用 ref 回调 / 对象 |
| `ReactDOM.render` | 移除，改用 `createRoot` |
| `unmountComponentAtNode` | 移除，改用 `root.unmount` |
| `contextTypes` 等遗留 | 移除 |
| legacy 测试工具 | 移除，改用 @testing-library |

注意：被移除的是**函数组件**上的 `defaultProps`，类组件的 `defaultProps` 仍有效。

## 面试答法

React 19 的改动，本质是把常见的异步交互内置化，把以前要自己搭的脚手架收进工具箱。Actions 统一了表单和按钮提交：`<form action={fn}>` 直接接函数、自动阻止默认提交，`useActionState` 返回当前状态、提交函数和 pending，签名是 action 加初始状态，提交被包成 Transition 所以界面不卡，`useFormStatus` 在子组件里读最近父表单的提交状态，`useOptimistic` 先乐观更新 UI、失败自动回滚。数据读取上引入 `use`，既能在 Suspense 下读 Promise，也能读 context 并允许条件调用，但它不做缓存，Promise 必须在渲染外创建。人机接口大幅简化：ref 成为函数组件的普通 prop、不再需要 forwardRef，ref 回调可以返回清理函数，Context 能直接当 Provider，title、meta、link 写在组件里会自动提升到 head，react-dom 还提供 preload、preinit、preconnect 等资源提示。同时移除了 propTypes、函数组件的 defaultProps、字符串 ref、ReactDOM.render 和 unmountComponentAtNode，新代码改用参数默认值、ref 回调、createRoot 和 root.unmount，类组件的 defaultProps 不受影响。
