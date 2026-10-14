# React Router 原理

## 核心思路

客户端路由的本质是：URL 是唯一的状态源，UI 是它的函数。它不做整页请求，而是监听 URL 变化，匹配路由、渲染对应组件，同时借浏览器 history API 让前进 / 后退按钮依然可用。

| 概念 | 职责 |
|------|------|
| Router（BrowserRouter / HashRouter） | 订阅 URL 变化，向下提供 location 与 navigate |
| Routes / Route | 按 path 匹配，决定渲染哪个组件 |
| Outlet | 嵌套路由中父级渲染子级的占位 |
| Hooks | 组件内部读写路由状态、参数、跳转 |
| loader / action（数据路由） | 渲染前加载数据、提交时处理副作用 |

## 两种模式：BrowserRouter 与 HashRouter

| 维度 | BrowserRouter | HashRouter |
|------|---------------|------------|
| URL 形态 | `/users/42` | `/#/users/42` |
| 底层机制 | History API（pushState / replaceState）+ popstate | location.hash + hashchange |
| 是否发请求 | 需服务端把所有路径回落到 index.html | `#` 之后不发给服务端，无需服务端配置 |
| SEO | 友好 | 较差（hash 不参与索引） |
| 适用场景 | 有服务端配置能力的正式项目 | 静态托管、无法配置回落时的兜底 |

BrowserRouter 依赖 History API：

```javascript
// 跳转：只改 URL，不触发页面刷新
history.pushState({ page: 1 }, '', '/users/42');

// 监听浏览器前进 / 后退（pushState 本身不触发任何事件）
window.addEventListener('popstate', (event) => {
  // event.state 即 pushState 传入的第一个参数
  render(location.pathname);
});
```

要点：`pushState` / `replaceState` 不会触发 `popstate`，只有用户点前进后退（或 `history.go`）才会。因此 Router 在提供 `navigate` 时，是自己调用 pushState 再手动通知订阅者，而不是等事件。

```text
navigate('/users/42')
      ↓ history.pushState(...)（改 URL，无事件）
      ↓ 主动 notify listeners（Router 内部广播新的 location）
      ↓ 订阅的 <Routes> 重新匹配
      ↓ 渲染对应 Route 的 element

用户点「后退」
      ↓ 浏览器触发 popstate 事件
      ↓ 监听器读取 location 并广播
      ↓ 同样触发重新匹配与渲染
```

HashRouter 则监听 `hashchange`，把 `window.location.hash` 当路径解析，天然规避服务端回落问题。

## history 抽象层

React Router 早期依赖独立的 `history` 包，v6 起把实现内联进 `@remix-run/router`。它把三类来源统一成同一个抽象：浏览器 history、内存 history（测试 / 非浏览器环境）、hash history；抽象里提供 `location`、`push` / `replace` / `go` 以及返回取消订阅函数的 `listen`。

`BrowserRouter` 对应 `createBrowserHistory`，`HashRouter` 对应 `createHashHistory`，`MemoryRouter` 对应 `createMemoryHistory`。上层 Router 组件拿到 history 的 `location` 存进 state，用 `listen` 订阅变化后触发重渲染，并把 `navigate`（内部调 push / replace）通过 context 传给下游。

## 路由匹配：Routes 与 Route

v6 用 `<Routes>` 包裹若干 `<Route>`，既是声明式，又是集中匹配（一次只渲染匹配度最高的那一个分支，类似 switch）：

```jsx
import { Routes, Route } from 'react-router-dom';

<Routes>
  <Route path="/" element={<Home />} />
  <Route path="/users/:id" element={<User />} />
  <Route path="*" element={<NotFound />} />
</Routes>
```

| 写法 | 含义 |
|------|------|
| `path="/users"` | 静态路径，精确匹配该段 |
| `path="/users/:id"` | 动态段，`:id` 被捕获为参数 |
| `path="/files/*"` | 通配（splat），匹配剩余任意层级 |
| `path="*"` | 兜底路由（404），通常放最后 |
| `element` | 渲染的 React 元素（v5 的 `component` / `render` 已废弃） |
| `index` | 索引路由，父路径本身对应的默认子路由 |

匹配算法（简化）：将所有嵌套 Route 展开成若干"分支"（从根到叶的一条路径），为每条分支计算一个匹配分（score），取分最高的分支渲染。评分大致考虑静态段优先于动态段、更具体（更长）的路径优先、`*` 兜底最低。所以 `/users/:id` 会优先于 `/users/*`。

```text
URL: /users/42
候选择例：
  /                  → 不匹配
  /users/:id         → 匹配，捕获 { id: '42' }
  /users/*           → 匹配（兜底）
  *                  → 匹配（兜底）
按 score 排序，选中 /users/:id，params = { id: '42' }
```

动态参数的解析：路径按 `/` 切段，`:name` 段会记为该段的参数名；匹配时把 `:id` 替换为正则捕获组，命中后写进 `params` 对象，再由 `useParams()` 读出来。

## 嵌套路由与 Outlet

父 Route 的 `path` 与子 Route 的 `path` 会相对拼接，父级的 `element` 里用 `<Outlet />` 作为子路由的渲染位置：

```jsx
<Routes>
  <Route path="/dashboard" element={<DashboardLayout />}>
    <Route index element={<Overview />} />
    <Route path="settings" element={<Settings />} />
    <Route path=":userId" element={<Profile />} />
  </Route>
</Routes>
```

```jsx
function DashboardLayout() {
  return (
    <div>
      <Sidebar />
      <main><Outlet /></main>   {/* 子路由在此渲染 */}
    </div>
  );
}
```

访问 `/dashboard/settings` 会同时渲染 `DashboardLayout` 与 `Settings`，后者出现在 `<Outlet />` 的位置。子 path 是相对的：`path="settings"` 等价于 `/dashboard/settings`；`index` 表示父路径本身（`/dashboard`）时渲染的默认子路由。

## useRoutes：配置式路由

不喜欢 JSX 声明写法时，可用 `useRoutes` 接受一个数组配置，返回与 `<Routes>` 等价的元素树：

```jsx
const routes = [
  { path: '/', element: <Home /> },
  {
    path: '/users',
    element: <Users />,
    children: [
      { index: true, element: <UserList /> },
      { path: ':id', element: <UserDetail /> },
    ],
  },
  { path: '*', element: <NotFound /> },
];

function App() {
  return useRoutes(routes);
}
```

`useRoutes` 是 `<Routes>` 的 hook 版本，内部同样做分支展开与评分匹配，返回匹配到的元素。适合路由表由后端下发、或需要动态生成的场景。

## 数据路由：loader 与 action

v6.4 起引入数据路由（data router），把"取数据"从组件里 `useEffect` 的时机提前到渲染之前：

```jsx
import {
  createBrowserRouter, RouterProvider, useLoaderData, redirect,
} from 'react-router-dom';

const router = createBrowserRouter([
  {
    path: '/users/:id',
    element: <User />,
    // 渲染前先跑 loader，返回值通过 useLoaderData 读取
    loader: async ({ params }) => {
      const res = await fetch(`/api/users/${params.id}`);
      if (!res.ok) throw redirect('/login');
      return res.json();
    },
  },
]);

function App() {
  return <RouterProvider router={router} />;
}

function User() {
  const user = useLoaderData();   // 直接拿到 loader 的结果
  return <h1>{user.name}</h1>;
}
```

| 要点 | 说明 |
|------|------|
| `loader` | 进入该路由渲染前执行，同一分支上可并行；返回值即类型安全的数据 |
| `action` | 处理 `<Form>` 提交，常配合 `redirect` 跳转，完成后自动重跑 loader |
| `errorElement` + `useRouteError` | 捕获 loader / action / 渲染抛出的错误，充当路由级错误边界 |
| `useNavigation` | 读取提交 / 加载中的状态，用于 pending UI |
| 与旧入口区别 | `<BrowserRouter>` 没有 loader / action；`createBrowserRouter` + `RouterProvider` 才有 |

`loader` 在渲染前执行意味着"数据与 UI 同时就绪"，避免了"先渲染组件、再在 effect 里请求、再二次渲染"的瀑布流程。

## 常用 Hooks

| Hook | 作用 | 数据来源 |
|------|------|---------|
| `useParams` | 读取动态段参数，返回 `{ [name]: string }` | 匹配结果 |
| `useLocation` | 当前 location 对象（pathname / search / hash / state） | Router context |
| `useNavigate` | 返回 `navigate(to, options)`，命令式跳转 | history 的 push / replace |
| `useSearchParams` | 读写 query 串，形如 `[params, setParams]` | location.search |
| `useMatch` | 用模式匹配当前 URL | 匹配算法 |
| `useLoaderData` / `useActionData` | 读取 loader / action 返回的数据 | 数据路由 |

```jsx
function UserDetail() {
  const { id } = useParams();                 // /users/:id 的 :id
  const location = useLocation();             // { pathname, search, state, ... }
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const tab = searchParams.get('tab') ?? 'info';
  return (
    <>
      <span>用户 {id}，路径 {location.pathname}，tab={tab}</span>
      <button onClick={() => setSearchParams({ tab: 'setting' })}>切换</button>
      <button onClick={() => navigate('/users', { replace: true })}>返回列表</button>
    </>
  );
}
```

`navigate` 的第二个参数：`{ replace: true }` 走 `replaceState`、不新增历史记录；`{ state }` 写入 `location.state`；传数字表示 `history.go(delta)`。

## 路由懒加载与 Suspense 配合

路由级代码分割：让每个页面的代码只在进入时才下载，用 `React.lazy` 加 `<Suspense>` 承接加载中的状态：

```jsx
import { lazy, Suspense } from 'react';

const Settings = lazy(() => import('./Settings'));   // 动态 import 返回 Promise

<Routes>
  <Route
    path="/settings"
    element={
      <Suspense fallback={<Spinner />}>
        <Settings />
      </Suspense>
    }
  />
</Routes>
```

`React.lazy` 的原理：首次渲染时模块还没到，组件抛出一个 thenable（Promise），React 捕获后渲染最近的 `<Suspense>` 的 `fallback`，模块加载完成后重试渲染。

v6.4 的数据路由还支持在路由上直接写 `lazy`：它接收一个异步函数，返回 `{ Component, loader, action, errorElement }` 等字段，React Router 会先 await 它再挂载路由，因此子路由的代码与数据"一起就绪"，同样避免了"先渲染组件、再补数据"的瀑布。

## React Router v7 与框架模式

- 库模式（library mode）：仍以组件 + hooks 的方式使用，`RouterProvider` / `Routes` / `useNavigate` 等都在，适合已有工程增量接入。
- 框架模式（framework mode）：v7 把原 Remix 的能力并入 React Router，提供约定式路由（`routes.ts`）、SSR / 流式渲染、`loader` 与 `action` 在服务端执行、类型安全等，等于"React Router 即全栈框架"。
- 包名收敛：v7 起 `react-router-dom` 的能力收敛进 `react-router`（`react-router-dom` 仍作为兼容再导出存在）。
- 迁移视角：`loader` / `action` / `RouterProvider` 在 v6.4 与 v7 之间基本一致，主要变化是单包化与框架能力的合流。

## 面试答法

React Router 的核心是把 URL 当成唯一状态源：Router 组件订阅 URL 变化，把当前 location 存进 state 并向下提供 navigate，`<Routes>` 再把路由表展开成一条条分支、按匹配分选出最合适的那一个渲染。BrowserRouter 基于 History API，用 pushState 改 URL、用 popstate 监听前进后退，注意 pushState 本身不触发事件，所以 navigate 是改完 URL 再手动广播给订阅者，HashRouter 则用 location.hash 和 hashchange，天然不需要服务端回落配置。匹配上，动态段 :id 会被捕获进 params 由 useParams 读取，嵌套路由用相对路径加 `<Outlet>` 定位子级渲染点，useRoutes 是 Routes 的配置式等价物。v6.4 引入的数据路由把取数据提前到渲染之前，用 loader 和 action 配合 useLoaderData、redirect、errorElement 处理加载、提交与错误，v7 又把 Remix 能力并入，形成库模式与框架模式两种用法，路由级懒加载一般用 React.lazy 加 Suspense，模块没到时抛 thenable、加载完成后重试。
