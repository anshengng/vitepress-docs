# throw 一个 Promise，页面怎么就变成 loading 了

## 先看一个让人发懵的写法

第一次见到 Suspense 的人，多半会被这段代码劝退：

```jsx
function Profile() {
  const data = readData();   // 里面没有 await，还可能 throw 一个 Promise
  return <div>{data.name}</div>;
}
```

组件函数是同步的，没有 `async`，却要等数据；更奇怪的是，数据没到的时候它不是返回 `null`，而是**扔出一个 Promise**。扔出去之后，页面竟然自动变成 `fallback` 里的 loading 界面，等数据到了又自己变回来。

把它想成一家**后厨很忙的馆子**：菜还没做好，服务员不会让你干等着，而是先在你桌上放一块「稍等片刻」的牌子；后厨做好了会有人来叫你，牌子撤走，菜端上来。Suspense 整篇文章都在讲这块牌子。

## 挂起不是「等」，是「先交出一个信号」

Suspense 是一套「渲染时依赖没就绪就先挂起、等它到齐再重试」的机制，它顺手把「异步加载中」这件事配上了统一的降级 UI（fallback）。

它覆盖的场景其实不止数据：

| 用途 | 挂起的是什么 | 举例 |
|------|------------|------|
| 代码分割 | 组件模块 | `React.lazy(() => import('./Chart'))` |
| 数据获取 | 数据 Promise | `use(fetchData())`、路由 loader |
| 流式 SSR | 服务端还没算好的子树 | `renderToPipeableStream` 中的边界 |
| 资源加载 | 图片 / 字体等 | 需自定义挂起，React 原生支持有限 |

这些场景解决的是同一个问题：某个子树的依赖还没到，别让整桌客人一起干等，先上一块牌子，依赖到了再换真菜。

## 到底扔出去了什么：thenable 机制

组件在 render 时如果依赖没就绪，不是返回占位，而是抛出一个 thenable（Promise）。React 不把它当异常处理，而是当成「这桌还没好，先记一笔」。

```typescript
// 极简资源读取：没就绪就把 Promise 扔给 React
function readData(cache: Map<string, any>, key: string) {
  const entry = cache.get(key);        // 先查菜单记录
  if (entry) {
    if (entry.status === 'success') return entry.value;  // 做好了，直接上菜
    if (entry.status === 'error') throw entry.error;     // 做砸了，抛真错误
    throw entry.promise;               // 还在做：把"等它"的凭证扔出去
  }
  // 注意：缓存必须在 throw 之前写入，否则每次渲染都新建 Promise，永远等不完
  const promise = fetch(key).then(
    (value) => { entry.status = 'success'; entry.value = value; },
    (error) => { entry.status = 'error'; entry.error = error; }
  );
  const newEntry = { status: 'pending', promise, value: undefined, error: undefined };
  cache.set(key, newEntry);            // 先把"正在做"的订单记下来
  entry = newEntry;
  throw promise;                       // 再扔出凭证
}
```

React 接住这个值之后，走的是一套固定流程：

```text
渲染 <Profile />，内部调用 readData
      ↓ 数据未就绪 → 抛出 Promise
React 的 render 入口捕获到 thenable（先判断是不是普通错误，不是才当挂起）
      ↓ 找到「最近的」<Suspense> 边界，渲染它的 fallback（放牌子）
      ↓ 给这个 Promise 挂一个 then 回调（attach ping listener，相当于留电话）
      ↓ Promise resolve（后厨做好了）
ping：标记该边界需要重试，调度一次更新（打电话叫你）
      ↓ 重新渲染该子树，此时缓存命中、不再抛出，渲染真实内容（撤牌上菜）
```

几个必须记住的点：

- 抛出的必须是 thenable（有 `.then` 方法），React 靠这个特征区分「挂起」和「异常」；
- React 会给 Promise 挂监听（ping），resolve 和 reject 都会触发一次重试调度；
- Promise 必须被缓存，否则会陷入「渲染 → 抛出 → resolve → 重试 → 又新建 → 再抛」的死循环；
- 首次挂起会记录 payload，后续重试靠它判断状态。

还得说清楚一件事：**抛出并缓存 Promise 是「React 内部机制 + 你自建缓存」的组合**。React 只负责识别 thenable 和安排重试，不替你缓存数据 Promise（`use` 甚至会警告「渲染期间创建的 Promise 不会被缓存」），缓存要由数据层或框架提供。就像馆子只负责叫号，订单本身得有人记。

## React.lazy：官方替你写好的一份

`React.lazy` 就是 thenable 机制的内置封装：接收一个返回 `Promise<{ default: Component }>` 的函数，返回一个「占位组件」。

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

它的内部流程和手写版一模一样：首次渲染时模块还没加载完，抛出内部 payload 的 thenable；模块到达后 resolve，重试渲染，此时 `default` 组件已经可用，直接渲染。相当于预制菜包还没送到，先放牌子，送到了热一热就上。

| 对比 | React.lazy | 手写 thenable + 缓存 |
|------|-----------|--------------------|
| 触发者 | 组件模块未加载 | 任意异步数据 |
| 缓存 | React 内建（基于 payload） | 需自己缓存，否则无限循环 |
| 边界要求 | 必须被 Suspense 包裹 | 同左 |
| React 19 | 仍可用 | 推荐配合 `use()` |

## 嵌套边界：找「最近的那一桌」

`<Suspense>` 可以嵌套。一个组件挂起时，React 从它出发向上找，遇到的第一个（最近的）Suspense 负责展示 fallback——谁离得近，谁先放牌子。

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

结果是：只有 `Profile` 那一块换成 `CardSpinner`，`Layout` 和 `Feed` 照常显示。这种「局部降级」正是嵌套 Suspense 的价值——加载态的颗粒度由边界位置控制：想让 fallback 覆盖更大范围，就把边界往上放一层；想更小，就往里再包一层。

## 并发模式下为什么不闪：旧菜先别撤

这是 React 18 和旧版最本质的差别。

| 模式 | 挂起时的表现 |
|------|-------------|
| Legacy（`ReactDOM.render`） | 挂起后整棵树切到 fallback，可能「闪一下」再回来 |
| Concurrent（`createRoot`） | 若挂起发生在过渡更新中，React 会等待，保持已提交的旧 UI 不变，就绪后一次性切换 |

并发下的关键是：一次渲染因挂起无法完成时，如果这次更新不是紧急的（Transition），React 选择**不提交这个半成品**，屏幕继续显示上一次已提交的内容，而不是用 fallback 盖上去；等 Promise resolve 后重新渲染、再一次性提交。相当于新菜没做好之前，桌上旧菜一直不收，做好了再整桌换。

```text
用户切换 Tab（用 startTransition 标记为低优先级、慢单）
        ↓
新内容触发挂起（抛 Promise，后厨说还没好）
        ↓
React 判断：这是 Transition 更新，不是紧急更新
        ↓
不渲染 fallback，而是保留旧 Tab 的已提交 UI（旧菜不收）
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

之所以敢「保留」，是因为 render 阶段不产生可见副作用：未提交的 Fiber 树可以安全丢弃，旧 UI 依旧挂在屏幕上，直到新树被 commit。若挂起发生在紧急更新里（普通 setState），React 仍会立即渲染 fallback——催单不能等，用户期待的就是一次同步切换。

## 挂起的那棵树去哪了：offscreen 树

这里还藏着 Suspense 的一个实现细节：**挂起的子树没有被销毁，而是被挂进一棵 offscreen（离屏）树里**。

React 内部用 `Offscreen` 类型的 Fiber 包住「暂时不该显示」的子树，它有两种模式：`visible` 正常挂在屏幕上，`hidden` 表示内容已经渲染好，但先不插进 DOM、也不挂载 effect。Suspense 挂起时，真实内容那一侧就被切成 `hidden`：

```text
<Suspense fallback={<Spinner />}>       ← 边界
   ├─ primary 子树（真实内容）          ← 包在 Offscreen Fiber 里，mode = hidden
   │      已经渲染出 Fiber / 离屏 DOM，但没插入页面，effect 也不执行
   └─ fallback 子树（Spinner）           ← 显示在屏幕上，给客人看的"稍等"牌子

Promise resolve → primary 的 Offscreen 切成 visible
   → 插入离屏 DOM → 挂载 effect → 撤掉 fallback
```

好处是：内容可以在后台提前渲染，只是先不放上桌；需要显示时直接切换模式、把已经做好的菜端出来，不必从头再渲染一遍。`hidden` 的预渲染工作还会被标到 `OffscreenLane` 上，属于优先级最低的那一档，不跟用户正在看的界面抢资源。

需要区分的是：挂着等数据的**新内容**和屏幕上**已经提交的旧内容**不是同一棵树。旧内容留在 current 树上继续显示，新内容在 workInProgress / offscreen 里等待，两者互不覆盖，这就是并发模式下不闪的结构基础。

## 服务端也能「边做边上」：流式 SSR

服务端渲染里，Suspense 让「流式输出」成为可能：不必等整棵树的异步数据都就绪，而是先把 HTML 外壳吐出来，慢的部分稍后补。就像先上凉菜和主食，热菜一道一道跟着上。

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

整体流程：

```text
服务端渲染 <App />
      ↓ 遇到挂起的 <Suspense>，外壳里先放 fallback 的 HTML
onShellReady → 先输出外壳（用户很快能看到基本结构）
      ↓ 各边界的数据陆续就绪
用内联 script 把每段完整 HTML 追加到对应占位符（隐藏模板 + 替换）
      ↓ 全部就绪（onAllReady）
客户端 hydrateRoot 水合
      ↓ 选择性水合（Selective Hydration）：
        哪个边界先就绪就先水合哪一块，甚至优先响应被点击的那块
```

三个要点：

- 服务端用占位符加内联 script，把延迟内容逐段「流」下来，不用等全量数据；
- 客户端选择性水合：以 Suspense 边界为单位分块水合，先就绪的先可交互；
- 这就是 Suspense 在 SSR 里比「全量等待」体验更好的原因：首屏时间和可交互时间都提前了。

## React 19：用 use() 展开 Promise

React 19 提供了 `use()`，它既能读 context，也能展开（unwrap）一个 Promise，和 Suspense 天然配合：

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
| Promise 缓存 | 若拿到「渲染期间新建的 Promise」会警告，无法缓存、易死循环，Promise 要在组件外或缓存层创建 |
| 错误处理 | Promise 被 reject 时由最近的 Error Boundary 捕获，Suspense 只负责 pending |
| 读 context | `use(ThemeContext)` 可直接读 context，这是它相对 `useContext` 的额外能力 |
| 不可 try/catch | 挂起是通过抛出实现的，放进 `try/catch` 会被拦截而失效 |

## 和 Vue 的 Suspense 对照

| 维度 | React Suspense | Vue Suspense |
|------|---------------|--------------|
| 触发方式 | 组件抛 thenable / `use()` | 异步 `setup`（返回 Promise）或异步组件 |
| 边界选择 | `<Suspense>`，取最近边界 | `<Suspense>`，取最近边界 |
| 并发行为 | 过渡更新下保留旧 UI，不闪烁 | 有 `timeout` / `pending` 控制等待与降级切换 |
| 数据来源 | 抛 Promise / `use`（自带机制不自带缓存） | 异步 setup 返回的 Promise |
| 心智模型 | 组件「抛」出未就绪的信号 | `setup` 返回 Promise，组件被自动包裹 |

两边都靠「最近的边界 + 降级 UI」，但 React 走的是「渲染函数抛 thenable」，Vue 走的是「异步 setup 返回 Promise」。React 还额外把 Suspense 接进了并发调度（Transition 下等待而不是闪烁），这是它比 Vue 更贴近「不打断当前交互」的部分。

## 几个常被追问的点

- fallback 里能再放 Suspense 吗？可以，会形成新的边界。
- 挂起会丢状态吗？不会。已提交的 Fiber 和 DOM 保留，重试时基于现有状态继续，组件不重新初始化。
- Suspense 能处理错误吗？不能。pending 归 Suspense，reject 归 Error Boundary。
- 为什么必须配 Suspense？没有边界时，抛出的 thenable 会一直向上到根，React 会报错（缺少能承接挂起的宿主）。

## 面试答法

Suspense 的本质是「渲染时依赖没就绪就先挂起、就绪后重试」。组件在 render 时抛出一个 thenable，React 靠 `.then` 判断这是挂起而不是异常，然后找到最近的 Suspense 边界渲染 fallback，同时给这个 Promise 挂上 ping 回调，resolve 或 reject 都会触发一次重试调度，等数据到了重新渲染，此时缓存命中不再抛出。抛出的 Promise 必须缓存，否则会陷入渲染→抛出→重试→再新建的死循环，React.lazy 就是这套机制的内置封装，React 19 的 use() 让任意数据 Promise 也能参与。嵌套时取「最近的边界」，所以只替换挂着的那一小块。并发模式下最大的差别是：挂起发生在 Transition 更新时，React 会保留上一次已提交的 UI、等就绪后一次性提交，避免 fallback 闪烁；紧急更新则仍立即渲染 fallback。SSR 里 Suspense 支持流式输出外壳、逐段补齐，客户端还能按边界选择性水合。
