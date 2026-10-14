# Suspense 原理详解

## 核心思路

Suspense 是一套"渲染时依赖没就绪就先挂起、等它到齐再重试"的机制，它把"异步加载中"这件事自带了统一的降级 UI（fallback）。

| 用途 | 挂起的是什么 | 举例 |
|------|------------|------|
| 代码分割 | 组件模块 | `React.lazy(() => import('./Chart'))` |
| 数据获取 | 数据 Promise | `use(fetchData())`、路由 loader |
| 流式 SSR | 服务端还没算好的子树 | `renderToPipeableStream` 中的边界 |
| 资源加载 | 图片 / 字体等 | 需自定义挂起，React 原生支持有限 |

它们解决的是同一个问题：某个子树的依赖尚未就绪时，不要让整棵树卡住或闪烁，而是先渲染一个降级 UI，依赖就绪后再换成真实内容。

## thenable 机制：抛出 Promise

Suspense 的实现方式很特别——组件在 render 时如果依赖没就绪，不是返回占位，而是抛出一个 thenable（Promise）。

```typescript
// 极简的资源读取：没就绪就抛 Promise
function readData(cache: Map<string, any>, key: string) {
  const entry = cache.get(key);
  if (entry) {
    if (entry.status === 'success') return entry.value;
    if (entry.status === 'error') throw entry.error;
    throw entry.promise;                  // pending：抛出 thenable
  }
  // 注意：缓存必须在 throw 之前写入，否则每次渲染都新建 Promise
  const promise = fetch(key).then(
    (value) => { entry.status = 'success'; entry.value = value; },
    (error) => { entry.status = 'error'; entry.error = error; }
  );
  const newEntry = { status: 'pending', promise, value: undefined, error: undefined };
  cache.set(key, newEntry);
  entry = newEntry;
  throw promise;
}
```

React 捕获这个抛出的值后，走一套固定流程：

```text
渲染 <Profile />，其内部调用 readData
      ↓ 数据未就绪 → 抛出 Promise
React 的 render 入口捕获到 thenable（不是普通错误）
      ↓ 找到「最近的」<Suspense> 边界，渲染它的 fallback
      ↓ 给这个 Promise 挂一个 then 回调（attach ping listener）
      ↓ Promise resolve
ping：标记该边界需要重试，调度一次更新
      ↓ 重新渲染该子树，此时缓存命中、不再抛出，渲染真实内容
```

关键点：

- 抛出的必须是 thenable（有 `.then` 方法），React 靠这个特征判断"这是挂起"而非"这是异常"；
- React 会给 Promise 挂监听（ping），resolve / reject 都会触发一次重试调度；
- Promise 必须被缓存，否则会"渲染 → 抛出 → resolve → 重试 → 又新建 → 再抛"形成死循环；
- 首次挂起会记录 payload。

需要说明的是：抛出并缓存 Promise 这个模式是"React 内部机制 + 你自建缓存"的组合。React 只识别 thenable 并负责重试，不替你缓存数据 Promise（`use` 甚至会警告"渲染期间创建的 Promise 不会被缓存"），缓存要由数据层或框架提供。

## 与 React.lazy 的关系

`React.lazy` 就是 thenable 机制的内置封装：它接收一个返回 `Promise<{ default: Component }>` 的函数，返回一个"占位组件"。

```jsx
import { lazy, Suspense } from 'react';

const Chart = lazy(() => import('./Chart'));   // 动态 import 返回 Promise

function Panel() {
  return (
    <Suspense fallback={<Spinner />}>
      <Chart data={data} />
    </Suspense>
  );
}
```

它的内部流程与手写版一致：首次渲染时模块还没加载完，抛出内部 payload 的 thenable；模块到达后 resolve，重试渲染，此时 `default` 组件已可用，直接渲染。

| 对比 | React.lazy | 手写 thenable + 缓存 |
|------|-----------|--------------------|
| 触发者 | 组件模块未加载 | 任意异步数据 |
| 缓存 | React 内建（基于 payload） | 需自己缓存，否则无限循环 |
| 边界要求 | 必须被 Suspense 包裹 | 同左 |
| React 19 | 仍可用 | 推荐配合 `use()` |

## 边界嵌套与"最近的边界"

`<Suspense>` 可以嵌套；一个组件挂起时，React 选择从它出发向上遇到的第一个（最近的）Suspense 来展示 fallback。

```tsx
<Suspense fallback={<PageSpinner />}>        {/* 外层，粗粒度 */}
  <Layout>
    <Suspense fallback={<CardSpinner />}>    {/* 内层，细粒度 */}
      <Profile userId={id} />                {/* Profile 挂起 */}
    </Suspense>
    <Suspense fallback={<FeedSpinner />}>
      <Feed />
    </Suspense>
  </Layout>
</Suspense>
```

```text
<Profile /> 抛出 thenable
      ↑ 沿 return 向上查找边界
内层 <Suspense fallback={<CardSpinner/>}>   ← 最近，选中它
      ↑（不再继续往上）
外层 <Suspense fallback={<PageSpinner/>}>
```

结果为：只有 `Profile` 那一块换成 `CardSpinner`，`Layout` 与 `Feed` 照常显示。这种"局部降级"正是嵌套 Suspense 的价值——把加载态的颗粒度交给边界的位置控制：想让 fallback 覆盖更大范围，就把边界往上放一层；想要更小，就往里再包一层。

## 并发模式下的行为：保留已提交内容

这是 React 18 与旧版最本质的差别。

| 模式 | 挂起时的表现 |
|------|-------------|
| Legacy（`ReactDOM.render`） | 挂起后整棵树切到 fallback，可能"闪一下"再回来 |
| Concurrent（`createRoot`） | 若挂起发生在过渡更新中，React 会等待，保持已提交的旧 UI 不变，就绪后一次性切换 |

并发下的关键：当一次渲染因挂起无法完成时，如果这次更新不是紧急的（Transition），React 会选择不提交这个半成品，屏幕继续显示上一次已提交的内容，而不是用 fallback 覆盖；等 Promise resolve 后重新渲染、再一次性提交。

```text
用户切换 Tab（用 startTransition 标记为低优先级）
        ↓
新内容触发挂起（抛 Promise）
        ↓
React 判断：这是 Transition 更新，不是紧急更新
        ↓
不渲染 fallback，而是保留旧 Tab 的已提交 UI
        ↓ Promise resolve
重试渲染 → 成功 → 一次性提交新内容
（全程看不到 fallback 闪烁，只有可选的 isPending 提示）
```

配合 `useTransition` / `startTransition`：

```jsx
function Tabs() {
  const [tab, setTab] = useState('profile');
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <button onClick={() => startTransition(() => setTab('profile'))}>资料</button>
      <button onClick={() => startTransition(() => setTab('feed'))}>动态</button>
      {isPending && <div className="dimmed">加载中…</div>}
      <Suspense fallback={<Spinner />}>
        {tab === 'profile' ? <Profile /> : <Feed />}
      </Suspense>
    </>
  );
}
```

之所以能做到"保留"，是因为 render 阶段不产生可见副作用：未提交的 Fiber 树可以安全丢弃，旧 UI 依旧挂在屏幕上，直到新树被 commit。若挂起发生在紧急更新里（普通 setState），React 仍会立即渲染 fallback——因为没有"可以等待"的余地，用户期待的是一次同步切换。

## React 18 的流式 SSR 与 Suspense

服务端渲染里，Suspense 让"流式输出"成为可能：不必等整棵树的异步数据都就绪，而是先吐 HTML 外壳、慢的部分稍后补。

```typescript
// 服务端
import { renderToPipeableStream } from 'react-dom/server';

const { pipe } = renderToPipeableStream(<App />, {
  onShellReady() { pipe(response); },        // 外壳就绪即开始输出
  onAllReady() { /* 供爬虫 / 非流式场景：全部就绪后再输出 */ },
});
```

```typescript
// 客户端：水合
import { hydrateRoot } from 'react-dom/client';
hydrateRoot(document, <App />);
```

流程：

```text
服务端渲染 <App />
      ↓ 遇到挂起的 <Suspense>，外壳里先放 fallback 的 HTML
onShellReady → 先输出外壳（用户能很快看到基本结构）
      ↓ 各边界的数据陆续就绪
用内联 script 把每段完整 HTML 追加到对应占位符（隐藏模板 + 替换）
      ↓ 全部就绪（onAllReady）
客户端 hydrateRoot 水合
      ↓ 选择性水合（Selective Hydration）：
        哪个边界先就绪就先水合哪一块，甚至优先响应被点击的那块
```

要点：

- 服务端用占位符加内联 script 把延迟内容逐段"流"下来，无需等全量数据；
- 客户端选择性水合：以 Suspense 边界为单位分块水合，先就绪的先可交互；
- 这也是 Suspense 在 SSR 中比"全量等待"体验更好的原因：首屏时间与可交互时间都提前。

## React 19 的数据获取：use()

React 19 提供 `use()`，它既能读取 context，也能展开（unwrap）一个 Promise，与 Suspense 天然配合：

```jsx
import { use, Suspense } from 'react';

function Comments({ commentsPromise }) {
  // commentsPromise 需在组件外创建（如服务端 loader / 缓存层）
  const comments = use(commentsPromise);   // pending 时挂起，resolve 后拿到值
  return <ul>{comments.map((c) => <li key={c.id}>{c.text}</li>)}</ul>;
}

function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <Comments commentsPromise={fetchComments()} />
    </Suspense>
  );
}
```

要点与限制：

| 特性 | 说明 |
|------|------|
| 调用位置 | 与普通 Hook 不同，可在条件、循环中调用（但它不是 Hook） |
| Promise 缓存 | 若拿到"渲染期间新建的 Promise"会警告，无法缓存、易死循环，Promise 要在组件外或用缓存层创建 |
| 错误处理 | Promise 被 reject 时由最近的 Error Boundary 捕获，Suspense 只负责 pending |
| 读 context | `use(ThemeContext)` 可直接读 context，这是它相对 `useContext` 的额外能力 |
| 不可 try/catch | 挂起是通过抛出实现的，放进 `try/catch` 会被拦截而失效 |

## 与 Vue Suspense 的对照

| 维度 | React Suspense | Vue Suspense |
|------|---------------|--------------|
| 触发方式 | 组件抛 thenable / `use()` | 异步 `setup`（返回 Promise）或异步组件 |
| 边界选择 | `<Suspense>`，取最近边界 | `<Suspense>`，取最近边界 |
| 并发行为 | 过渡更新下保留旧 UI，不闪烁 | 有 `timeout` / `pending` 控制等待与降级切换 |
| 数据来源 | 抛 Promise / `use`（自带机制不自带缓存） | 异步 setup 返回的 Promise |
| 心智模型 | 组件"抛"出未就绪的信号 | `setup` 返回 Promise，组件被自动包裹 |

两者都靠"最近的边界 + 降级 UI"，但 React 走的是"渲染函数抛 thenable"这条路，Vue 走的是"异步 setup 返回 Promise"。React 还额外把 Suspense 接进了并发调度（Transition 下等待而非闪烁），这是它相对 Vue 更贴近"不打断当前交互"的部分。

## 常见追问

- fallback 里能再放 Suspense 吗？可以，会形成新的边界。
- 挂起会丢状态吗？不会。已提交的 Fiber 与 DOM 保留，重试时基于现有状态继续，组件不重新初始化。
- Suspense 能处理错误吗？不能。pending 归 Suspense，reject 归 Error Boundary。
- 为什么必须配 Suspense？没有边界时，抛出的 thenable 会一直向上到根，React 会报错（缺少能承接挂起的宿主）。

## 面试答法

Suspense 的本质是"渲染时依赖未就绪就挂起、就绪后重试"：组件在 render 时抛出一个 thenable，React 识别后找到离它最近的 Suspense 边界渲染 fallback，同时给这个 Promise 挂上 ping 回调，等 Promise resolve 再调度一次重试，把真实内容渲染出来；抛出的 Promise 必须缓存，否则会陷入渲染抛出的死循环，React.lazy 就是这套机制的内置封装，React 19 的 use() 则让任意数据 Promise 也能参与。嵌套时 React 采用"最近的边界"，所以局部降级只替换挂着的那一小块。并发模式下最大的差别在挂起发生在 Transition 更新时：React 不会立刻切到 fallback，而是保留上一次已提交的 UI、等就绪后一次性提交，从而避免闪烁，紧急更新则仍会立即渲染 fallback。在 React 18 的 SSR 里，Suspense 让服务端可以流式输出外壳、逐段补齐，客户端还能按边界选择性水合。和 Vue 对照，两者都是最近的边界加降级 UI，但 React 靠抛 thenable，Vue 靠异步 setup 返回 Promise。
