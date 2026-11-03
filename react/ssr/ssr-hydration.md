# SSR 与 hydration：页面明明显示了，为什么点不动

## 一个所有人都遇到过的瞬间

打开一个网页，内容已经完整地摆在眼前了：标题、列表、按钮，一个不缺。你顺手点了一下按钮，没反应。再点，还是没反应。过了一两秒，忽然就能点了。

那一两秒里发生了什么？内容明明已经在了，为什么还不能用？

答案就一句话：**屏幕上的是"盖好的房子"，但电还没接通。** 全篇用盖房来打比方：CSR 是在空地上从零施工，SSR 是工厂先把房子预制好运到现场，而 hydration 就是电工进场，把每个开关接上电。

## 两种盖房方式

| 对比项 | 纯客户端 CSR | SSR + hydration |
|--------|--------------|-----------------|
| 服务端返回 | 空的容器 div | 带真实内容的 HTML |
| 首屏可见 | JS 加载并渲染后 | HTML 一到达即可见 |
| SEO | 爬虫可能拿不到内容 | 首屏 HTML 直接可读 |
| 代价 | 无服务端渲染开销 | 服务端要渲染一次、需保证两端一致 |
| 可交互时间 | 渲染完成后 | HTML 可见后还要等 hydration |

注意：SSR 减少的是「首屏可见时间」，并不减少「可交互时间」的总量，它只是把 visible 提前了。

## 为什么要先盖好房子

- 首屏更快：用户更早看到内容（FCP 更快），即便 hydration 尚未完成。
- SEO：搜索引擎直接抓到 HTML 内容，无需执行 JS。
- 弱网与低端设备：可先看到内容再交互。
- 代价：服务端负载增加，且必须保证「两次渲染结果一致」，否则会出现 hydration mismatch。

## renderToString：整栋房一次性预制

```typescript
import { renderToString } from 'react-dom/server';

const html = renderToString(<App />);
// 一次性生成完整 HTML 字符串，同步阻塞，不支持流式与 Suspense 按需输出
```

React 18 起它属于遗留 API，仍然可用，但无法利用流式渲染，渲染大页面时会阻塞事件循环。对应「只生成标记」的还有 `renderToStaticMarkup`（不生成 hydration 所需的注释与 id，适合纯静态页面）。

相当于把整栋房子在工厂里一次性做好，再整栋运过去。房子没做完之前，现场什么也看不到。

## renderToPipeableStream：分段交付

```typescript
import { renderToPipeableStream } from 'react-dom/server';

const { pipe, abort } = renderToPipeableStream(<App />, {
  onShellReady() {
    // 外壳（Suspense 边界之外的同步内容）就绪，立刻开始发送
    response.setHeader('Content-Type', 'text/html');
    pipe(response);
  },
  onShellError(err) {
    response.statusCode = 500;
  },
  onAllReady() {
    // 全部就绪后回调，爬虫场景可在这里输出完整页面
  },
  onError(err) {
    console.error(err);
  },
});
```

Web 流（边缘运行时）对应 `renderToReadableStream`。

### 流式渲染的意义

```text
renderToPipeableStream
   ↓
先输出 shell（Suspense 边界外的同步内容）      // 客厅先交付，能住人
   ↓ 遇到未就绪的 <Suspense> 边界
先输出 fallback 占位 HTML                      // 卧室先挂个"施工中"的牌子
   ↓ 该边界的数据就绪（可能乱序）
把真实内容以 <script> 内联片段推到同一位置      // 卧室装好了，补上
   ↓ 全部完成后关闭流
```

好处：首屏不必等最慢的数据；后到的慢区块可以「后到先插」，即 out-of-order streaming。`<Suspense>` 的 `fallback` 就是那块"施工中"的占位牌。

## hydration：不是重建，是给房子接电

hydration 不是「重新渲染」，而是在已有服务端 HTML 之上**接管**：

```text
服务端 HTML： <button>计数器 0</button>   ← 房子盖好了，但开关没接线
   ↓ 客户端加载 JS
hydrateRoot(container, <App />)
   ↓ React 遍历既有 DOM，构建 Fiber 树，把事件监听接到 root 容器
可交互：      <button>计数器 0</button>   ← DOM 复用，没拆没重建，只是通了电
```

关键点：

| 项 | 说明 |
|----|------|
| DOM 复用 | 不重新创建 DOM，只在其上「挂载」Fiber 与事件 |
| 事件委托 | React 17 起把监听统一挂在 root 容器，靠冒泡分发 |
| 状态不恢复 | 服务端没有 state，客户端首帧用初始值重建 |
| 首帧一致 | hydration 的首帧结构必须与服务端 HTML 完全一致 |

React 18 的入口：

```typescript
import { hydrateRoot } from 'react-dom/client';

hydrateRoot(document.getElementById('root')!, <App />);
```

`hydrate`（react-dom 遗留入口）是旧版写法；`hydrateRoot` 支持并发特性与流式所带来的按需注水。

## hydration mismatch：图纸和现场对不上

mismatch 指客户端首帧渲染出的结构与服务端 HTML 对不上。React 18 遇到后会**放弃复用该节点、退化为客户端渲染**并报错（React 19 的报错里会给出 diff 提示）。相当于电工发现插座位置和图纸不符，只能把那面墙拆了重装。

常见原因与修复：

| 原因 | 示例 | 修复 |
|------|------|------|
| 时间相关 | `new Date().toLocaleString()` | 首帧给固定占位，挂载后再更新 |
| 随机数 | `Math.random()` | 改用 `useId` 或稳定值 |
| 环境专属分支 | `typeof window !== 'undefined'` | 用 effect 处理客户端差异 |
| 本地存储 / 时区 | 读 `localStorage`、locale | 初始值固定，挂载后再读 |
| 非法 HTML 嵌套 | `<div>` 里嵌 `<p>` | 修正结构（浏览器会纠正） |
| 不稳定 id | 自增计数器 / 随机 id | 用 `useId` |

```tsx
// 错误：服务端与客户端首帧时间不同 → mismatch
function Clock() {
  return <span>{new Date().toLocaleTimeString()}</span>;
}

// 正确：首帧固定，挂载后再更新
function Clock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    // 只有客户端会跑到这里，此时再取真实时间就安全了
    const id = setInterval(() => setNow(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span>{now ?? '--:--:--'}</span>;   // 两端首帧都是这个占位
}
```

补充：`useLayoutEffect` 在服务端没有 DOM，会告警，应改为 `useEffect`；浏览器以外的环境读取 `window` 也必须在 effect 内进行。

## 选择性注水：哪个房间先接电

React 18 不要求「整页一次性注水」，它把注水也纳入 Lane 优先级调度：

```text
hydration 开始
   ├── 优先注水与用户交互相关的 <Suspense> 边界   // 有人进的房间先接电
   ├── 用户点击了一个尚未注水的边界
   │       → 该边界提升为高优先级，立即注水
   └── 其余边界按优先级排期，逐个注水            // 空房间慢慢来
```

要点：

- 每个 `<Suspense>` 边界是一个可独立注水的单元。
- 用户与某边界交互（点击、输入）时，React **先记录这次事件、优先注水该边界**，随后重放（event replay），交互不会丢。
- 与流式配合：服务端早到、或用户先点的边界会先被注水。
- 因此边界划分很关键：把可交互、可延迟的部分各自包成一个边界，而不是整页一个大边界。

## 和 Next.js 的关系

Next.js 的 SSR / SSG / ISR 与 App Router 都建立在这些原语之上：

| 能力 | 底层 |
|------|------|
| pages 目录 SSR | `renderToPipeableStream` + 客户端 hydration |
| App Router 流式 | `renderToPipeableStream` + Suspense + Server Components |
| 客户端接管 | `hydrateRoot`（有服务端 HTML）或 `createRoot`（无） |
| Server Components | 服务端输出 RSC payload，客户端再做注水 |

所以 SSR 原理不是框架私有魔法，而是 `react-dom/server` 与 `react-dom/client` 提供的这组入口，框架只是把数据获取、路由、缓存编排到这些原语上。

## 面试答法

SSR 解决的是纯客户端首屏空白和 SEO 差的问题：服务端用 react-dom/server 把组件渲染成 HTML 字符串先返回，浏览器立刻能看到内容，随后客户端用 hydrateRoot 在已有 DOM 上接管，把事件监听和 Fiber 树挂上去，而不是重新创建 DOM，这一步就叫 hydration。React 18 的流式渲染用 renderToPipeableStream，先发 shell，遇到未就绪的 Suspense 边界先发 fallback 占位，数据好了再以脚本片段推到同一位置、可以乱序到达；renderToString 是同步遗留 API，会阻塞事件循环，吃不到这些收益。hydration 要求客户端首帧和服务端 HTML 完全一致，不一致就是 hydration mismatch，常见于时间、随机数、localStorage、时区、非法 HTML 嵌套或随机 id，修法是首帧用稳定值、把差异挪进 useEffect，或用 useId 生成跨端一致的 id。React 18 还把注水和 Lane 优先级打通，做选择性注水：每个 Suspense 边界可独立注水，用户在某边界上交互时会优先注水并重放该事件。Next.js 的 SSR、App Router 流式和 Server Components，本质都是对这套原语的编排。
