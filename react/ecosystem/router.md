# React Router：为什么 pushState 之后页面不动

## 先说一个卡住很多人的现象

在控制台敲一句 `history.pushState({}, '', '/users/42')`，地址栏确实变成了 `/users/42`，可页面一点没变。再补一句 `window.addEventListener('popstate', ...)`，发现回调根本不触发。第一反应是浏览器有 bug。

不是。`pushState` 只是改了地址栏和浏览历史，它**故意不触发任何事件**。React Router 的整套设计，就是从补这个"缺口"开始的。

打一个贯穿全篇的比方：把浏览器地址栏当成大楼的**门牌号**，Router 就是**前台**。前台的工作是：盯着门牌号有没有变、按手里的分拣规则决定客人去哪间房、再把人领过去。前进后退按钮相当于"按访客的足迹倒带"，前台也得跟着重新领路。

先认一下各角色：

| 角色 | 干什么 |
|------|------|
| Router（BrowserRouter / HashRouter） | 前台，订阅门牌号变化，向下提供 location 与 navigate |
| Routes / Route | 分拣规则表，按 path 匹配，决定客人进哪个房间 |
| Outlet | 楼层里给子房间留的那道门 |
| Hooks | 客人在房间里查门牌、查参数、要求换房 |
| loader / action（数据路由） | 客人到之前先收拾房间、退房时处理手续 |

## 两种门牌：真门牌和 # 暗号

| 维度 | BrowserRouter | HashRouter |
|------|---------------|------------|
| URL 形态 | `/users/42` | `/#/users/42` |
| 底层机制 | History API（pushState / replaceState）+ popstate | location.hash + hashchange |
| 是否发请求 | 需服务端把所有路径回落到 index.html | `#` 之后不发给服务端，无需服务端配置 |
| SEO | 友好 | 较差（hash 不参与索引） |
| 适用场景 | 有服务端配置能力的正式项目 | 静态托管、无法配置回落时的兜底 |

BrowserRouter 依赖 History API，关键在"改地址不等于通知"：

```javascript
// 跳转：只改地址栏和历史记录，不刷新页面，也不触发任何事件
history.pushState({ page: 1 }, '', '/users/42');

// 监听浏览器前进 / 后退（注意 pushState 自己不会触发它）
window.addEventListener('popstate', (event) => {
  // event.state 就是 pushState 传入的第一个参数
  render(location.pathname);
});
```

要点：`pushState` / `replaceState` 不会触发 `popstate`，只有用户点前进后退（或 `history.go`）才会。所以 Router 在做 `navigate` 时，是自己先改地址、再**手动广播**给订阅者，而不是等事件。

```text
navigate('/users/42')                     // 前台领路
      ↓ history.pushState(...)（只改门牌号，没有事件）
      ↓ 主动 notify listeners（前台自己喊一声"换地方了"）
      ↓ 订阅的 <Routes> 重新匹配
      ↓ 渲染对应 Route 的 element（把客人带进房间）

用户点「后退」                              // 访客按足迹倒带
      ↓ 浏览器触发 popstate 事件
      ↓ 监听器读取 location 并广播
      ↓ 同样触发重新匹配与渲染
```

HashRouter 则监听 `hashchange`，把 `window.location.hash` 当路径解析。`#` 后面的部分浏览器不会发给服务器，所以天然不需要"所有路径回落 index.html"这套配置，代价是 SEO 吃亏。

## 把三种门牌来源统一：history 抽象层

React Router 早期依赖独立的 `history` 包，v6 起把实现内联进 `@remix-run/router`。它把三类来源统一成同一个抽象：浏览器 history、内存 history（测试 / 非浏览器环境）、hash history。抽象里提供 `location`、`push` / `replace` / `go`，以及返回取消订阅函数的 `listen`。

`BrowserRouter` 对应 `createBrowserHistory`，`HashRouter` 对应 `createHashHistory`，`MemoryRouter` 对应 `createMemoryHistory`。上层 Router 组件拿到 history 的 `location` 存进 state，用 `listen` 订阅变化后触发重渲染，并把 `navigate`（内部调 push / replace）通过 context 传给下游。

相当于前台只认一套"门牌登记系统"，底下是真门牌、暗号门牌还是测试用的假门牌，上层不用关心。

## 前台怎么挑房间：Routes 的匹配规则

v6 用 `<Routes>` 包裹若干 `<Route>`，既是声明式，又是集中匹配：一次只渲染匹配度最高的那一条分支，行为很像 `switch`。

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

匹配算法（简化）：先把所有嵌套 Route 展开成若干"分支"（从根到叶的一条路径），为每条分支算一个匹配分（score），取分最高的那条渲染。评分大致考虑：静态段优先于动态段、更具体（更长）的路径优先、`*` 兜底最低。所以 `/users/:id` 会优先于 `/users/*`。

```text
URL: /users/42                       // 客人报出的门牌号
候选择例：
  /                  → 不匹配
  /users/:id         → 匹配，捕获 { id: '42' }
  /users/*           → 匹配（兜底）
  *                  → 匹配（兜底）
按 score 排序，选中 /users/:id，params = { id: '42' }
```

动态参数的解析：路径按 `/` 切段，`:name` 段会记为该段的参数名；匹配时把 `:id` 替换成正则捕获组，命中后写进 `params` 对象，再由 `useParams()` 读出来。

## 嵌套房间：父路由如何给子路由留门

父 Route 的 `path` 与子 Route 的 `path` 相对拼接，父级的 `element` 里用 `<Outlet />` 作为子路由的渲染位置。就像一层楼先有大厅，大厅里再留几间房门。

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
      <main><Outlet /></main>   {/* 子房间的门，子路由在这里渲染 */}
    </div>
  );
}
```

访问 `/dashboard/settings` 会同时渲染 `DashboardLayout` 与 `Settings`，后者出现在 `<Outlet />` 的位置。子 path 是相对的：`path="settings"` 等价于 `/dashboard/settings`；`index` 表示父路径本身（`/dashboard`）时渲染的默认子路由。

## useRoutes：不爱写 JSX 的门牌表

不喜欢 JSX 声明写法时，可以用 `useRoutes` 接一个数组配置，返回与 `<Routes>` 等价的元素树：

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

## 让房间先收拾好再进：loader 与 action

v6.4 起引入数据路由（data router），把"取数据"从组件里的 `useEffect` 提前到渲染之前，等于客人到之前先把房间铺好。

```jsx
import {
  createBrowserRouter, RouterProvider, useLoaderData, redirect,
} from 'react-router-dom';

const router = createBrowserRouter([
  {
    path: '/users/:id',
    element: <User />,
    // 渲染前先跑 loader 收拾房间，返回值通过 useLoaderData 读取
    loader: async ({ params }) => {
      const res = await fetch(`/api/users/${params.id}`);
      if (!res.ok) throw redirect('/login');   // 数据不对，直接改道去登录
      return res.json();
    },
  },
]);

function App() {
  return <RouterProvider router={router} />;
}

function User() {
  const user = useLoaderData();   // 直接拿到 loader 的结果，不用再等
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

`loader` 在渲染前执行，意味着"数据与 UI 同时就绪"，避免了"先渲染组件、再在 effect 里请求、再二次渲染"的瀑布流程。

## 日常用的几把钥匙：常用 Hooks

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

`navigate` 的第二个参数：`{ replace: true }` 走 `replaceState`、不新增历史记录；`{ state }` 写入 `location.state`；传数字表示 `history.go(delta)`，相当于按足迹快退或快进几格。

## 页面代码太大？按需进门

路由级代码分割：让每个页面的代码只在进入时才下载，用 `React.lazy` 加 `<Suspense>` 承接加载中的状态。

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

`React.lazy` 的原理：首次渲染时模块还没到，组件抛出一个 thenable（Promise），React 捕获后渲染最近的 `<Suspense>` 的 `fallback`，模块加载完成后重试渲染。相当于房间还没装修好，先在门口挂个"稍等"的牌子。

v6.4 的数据路由还支持在路由上直接写 `lazy`：它接收一个异步函数，返回 `{ Component, loader, action, errorElement }` 等字段，React Router 会先 await 它再挂载路由，因此子路由的代码与数据"一起就绪"，同样避免了"先渲染组件、再补数据"的瀑布。

## v7：从路由库到全栈框架

- 库模式（library mode）：仍以组件 + hooks 的方式使用，`RouterProvider` / `Routes` / `useNavigate` 等都在，适合已有工程增量接入。
- 框架模式（framework mode）：v7 把原 Remix 的能力并入 React Router，提供约定式路由（`routes.ts`）、SSR / 流式渲染、`loader` 与 `action` 在服务端执行、类型安全等，等于"React Router 即全栈框架"。
- 包名收敛：v7 起 `react-router-dom` 的能力收敛进 `react-router`（`react-router-dom` 仍作为兼容再导出存在）。
- 迁移视角：`loader` / `action` / `RouterProvider` 在 v6.4 与 v7 之间基本一致，主要变化是单包化与框架能力的合流。

## 面试答法

React Router 的本质是把 URL 当成唯一状态源，Router 相当于前台：订阅地址变化，把当前 location 存进 state 并向下提供 navigate。`<Routes>` 把路由表展开成一条条分支、按匹配分选出最合适的一条渲染，静态段优先于动态段，`:id` 这类动态段被捕获进 params 由 useParams 读取，嵌套路由用相对路径拼接、靠 `<Outlet>` 给子路由留出渲染位置。BrowserRouter 基于 History API，pushState 只改地址不触发事件，所以 navigate 是改完再手动广播，popstate 只负责前进后退；HashRouter 用 location.hash 和 hashchange，不需要服务端回落但 SEO 较差。v6.4 的数据路由把取数据提前到渲染前，loader / action 配 useLoaderData、redirect、errorElement 处理加载、提交和错误，v7 又把 Remix 并入，分成库模式与框架模式。路由级懒加载用 React.lazy 加 Suspense，模块没到时抛 thenable，加载完再重试渲染。
