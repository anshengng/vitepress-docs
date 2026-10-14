# React 19 新特性

## 版本定位

React 19 于 2024 年底发布，改动集中在三块：**表单与 Actions**、**数据读取（use）**、**人机接口的简化（ref / Context / 元数据）**。下面按「稳定」与「较新」区分。

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

## Actions 与 useActionState

Action 是把一次异步提交（表单、按钮）统一起来的模型：把 async 函数交给 `action`，由 React 自动管理 pending、错误和提交后的状态。

```tsx
import { useActionState } from 'react';

async function submit(prevState, formData) {
  const name = formData.get('name');
  const res = await api.save({ name });
  if (!res.ok) return { error: '保存失败' };
  return { ok: true };
}

function Form() {
  const [state, formAction, isPending] = useActionState(submit, null);
  return (
    <form action={formAction}>
      <input name="name" />
      <button disabled={isPending}>{isPending ? '提交中...' : '提交'}</button>
      {state?.error && <p>{state.error}</p>}
    </form>
  );
}
```

`useActionState` 返回 `[当前状态, 提交函数, 是否 pending]`，签名对应 `(action, 初始状态)`；提交函数会被包成一个走 Transition 的 action，因此提交期间界面保持可交互。

`useFormStatus` 在**子组件**里读取最近父 `<form>` 的提交状态：

```tsx
import { useFormStatus } from 'react-dom';

function SubmitButton() {
  const { pending } = useFormStatus(); // 读取最近父 <form> 的状态
  return <button disabled={pending}>提交</button>;
}
```

`<form action={fn}>` 直接接受函数，提交时以 `FormData` 传入，React 会自动 `preventDefault`，无需手写 `onSubmit`。

## useOptimistic 乐观更新

在请求返回前先「假定成功」地更新 UI，失败后再回滚到真实数据。

```tsx
import { useOptimistic } from 'react';

function Messages({ messages, send }) {
  const [optimistic, addOptimistic] = useOptimistic(
    messages,
    (current, text) => [...current, { id: 'temp', text, pending: true }],
  );

  async function formAction(formData) {
    addOptimistic(formData.get('text')); // 立即插入临时项
    await send(formData.get('text'));    // 真请求
    // 成功后 messages 更新，乐观项被真实数据替换
  }

  return <form action={formAction}>...</form>;
}
```

要点：`useOptimistic` 只在 Action 内部有效，Action 结束后自动回到真实值；它不做真正的状态持久化，只是「过渡显示」，失败回滚是自动发生的。

## use：读取 Promise 与 Context

`use` 是一个新的读取 API，可在**条件分支**里调用（它是读取型 API，不受 Hook 调用顺序规则约束）。

```tsx
import { use, Suspense } from 'react';

function Comments({ commentsPromise }) {
  const comments = use(commentsPromise); // 未就绪会挂起，由 Suspense 兜住
  return <ul>{comments.map((c) => <li key={c.id}>{c.text}</li>)}</ul>;
}

function Card({ theme }) {
  if (cond) {
    const t = use(themeContext); // use(Context) 允许条件调用
  }
}
```

- `use(Promise)` 与 Suspense 配合；它**不做缓存**，每次渲染拿到新 Promise 都会重新挂起，所以 Promise 应在渲染外创建或缓存。
- `use(Context)` 可替代 `useContext`，并允许在条件里读取。

## ref 的简化

React 19 起，函数组件的 `ref` 就是普通 prop，不必再包 `forwardRef`。

```tsx
// 旧写法
const Input = forwardRef((props, ref) => <input ref={ref} {...props} />);

// React 19
function Input({ ref, ...props }) {
  return <input ref={ref} {...props} />;
}
```

ref 回调支持返回清理函数，替代在回调里判断旧节点：

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

## Context 直接作 Provider

```tsx
// 旧写法
<ThemeContext.Provider value="dark"><App /></ThemeContext.Provider>

// React 19
<ThemeContext value="dark"><App /></ThemeContext>
```

## 新的表单能力

- `<form action={fn}>`：函数型 action，React 自动阻止默认提交。
- 提交完成后 React 会**重置非受控字段**（原生表单行为）。
- 配合 `useActionState` / `useFormStatus` 管理 pending 与错误。
- `react-dom` 提供 `requestFormReset`，可手动重置表单。

## Document Metadata

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

好处：元数据随组件生命周期管理，SSR 时也能正确输出，无需再依赖 helmet 类库。

## 资源加载

`react-dom` 暴露一组预加载 API，配合 `<link rel="stylesheet" precedence>` 使用：

```tsx
import { preload, preinit, prefetchDNS, preconnect } from 'react-dom';

preload('/font.woff2', { as: 'font', type: 'font/woff2' }); // 预加载资源
preinit('/style.css', { as: 'style' });                     // 预初始化并插入
preconnect('https://cdn.example.com');                      // 提前建连
prefetchDNS('https://api.example.com');                     // 提前解析 DNS
```

```tsx
// 样式表：React 按 precedence 排序，并保证在依赖它的组件渲染前插入
<link rel="stylesheet" href="/a.css" precedence="default" />
```

异步脚本用 `async` 属性写在组件里，由 React 负责在合适时机插入并保证执行顺序。

## 移除 / 废弃项

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

React 19 的改动可以概括为把常见异步交互「内置化」：用 Actions 统一表单和按钮提交，`useActionState` 返回状态、提交函数和 pending，配合 `useFormStatus` 在子组件读取提交状态，`<form action={fn}>` 直接接函数并自动阻止默认提交，`useOptimistic` 在请求返回前先乐观更新 UI、失败再自动回滚。数据读取上引入 `use`，它既能在 Suspense 下读 Promise，也能读取 context 并允许条件调用，但它不做缓存，Promise 必须在渲染外创建。人机接口被大幅简化：ref 成为函数组件的普通 prop、不再需要 forwardRef，ref 回调可以返回清理函数，`<Context>` 能直接当 Provider，`title`/`meta`/`link` 可在组件里写并自动提升到 head，react-dom 还提供了 preload/preinit/preconnect 等资源提示 API。同时 React 19 移除了一批遗留能力，如 propTypes、函数组件的 defaultProps、字符串 ref、ReactDOM.render 与 unmountComponentAtNode，新代码应改用参数默认值、ref 回调、createRoot 和 root.unmount，类组件的 defaultProps 不受影响。
