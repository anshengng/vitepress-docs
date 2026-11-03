# React 18 那几个新 Hook 到底在补什么

## 一个 SSR 报错引出的问题

写了个带无障碍属性的表单，图省事用了 `id={Math.random()}`，本地开发一切正常。一上 SSR，控制台立刻红一片：hydration mismatch。

换成全局自增计数器，想着"这次总该稳了吧"，结果还是偶发报错。原因不是随机数不吉利，而是它暴露了并发渲染时代的两类新问题：**服务端和客户端必须各自生成一模一样的东西**，**React 之外的数据源要能安全地接进来**。

React 18 补的那几个 Hook，就是分别填这两个坑的。下面用一座工厂来打比方：React 是总厂，组件是工位，外部 store 是厂外供应商。

## 五个 Hook 分别在补什么

| Hook | 解决的问题 | 典型使用者 |
|------|------------|------------|
| `useId` | SSR / CSR 生成一致的稳定 id | 无障碍属性、表单 label |
| `useSyncExternalStore` | 外部 store 订阅 + 避免撕裂 | Redux、Zustand、自写 store |
| `useTransition` | 标记非紧急更新 | 搜索、Tab 切换 |
| `useDeferredValue` | 延迟某个值 | 来自 props 的重计算 |
| `useInsertionEffect` | 布局读取前注入样式 | CSS-in-JS 库 |

## useId：为什么随机数一上服务端就翻车

用途：生成一个在服务端与客户端**首帧一致**的 id，避免 hydration mismatch。关键不在于"生成一个 id"，而在于"两端生成同一个 id"。

```tsx
function Field() {
  const id = useId(); // 形如 :r0:（:r1:、:r2: ... 依树中位置递增）
  return (
    <>
      <label htmlFor={id}>邮箱</label>
      <input id={id} aria-describedby={`${id}-hint`} />
      <span id={`${id}-hint`}>用于登录</span>
    </>
  );
}
```

为什么换成别的方式都不行：

```text
Math.random()   ：服务端生成一次、客户端再生成一次 → 值不同 → mismatch
全局自增计数器  ：客户端模块加载顺序/时机不同 → 值不同 → mismatch
useId           ：由组件在树中的「位置」推导 → 两端同一位置 → 值一致
```

把它想成给零件打铭牌：不写生产时间、不写流水号，只写"这是第几个工位"，那么不管是哪班工人来装，同一个工位的牌子永远是同一个编号。

要点：

- 值只保证「唯一、稳定、两端一致」，内容本身没有意义，**不要**拿来做 CSS 选择器或列表 key。
- 列表 key 应由数据提供（比如后端返回的 id），而不是用 `useId`。
- 它正是 [SSR 与 hydration](/react/ssr/ssr-hydration) 里解决「不稳定 id」的推荐手段。

## useSyncExternalStore：怎么防止"一半新一半旧"

用途：安全地订阅 React 之外的数据源，并在并发渲染下**避免撕裂（tearing）**。

撕裂是什么：并发渲染可能把一次渲染拆成多段，若在这期间外部数据变了，同一次提交里不同组件可能读到不同版本的数据——一半新、一半旧，界面对不上。

```typescript
import { useSyncExternalStore } from 'react';

function useOnlineStatus() {
  return useSyncExternalStore(
    (callback) => {                        // subscribe：登记"货到了叫我"，返回退订函数
      window.addEventListener('online', callback);
      window.addEventListener('offline', callback);
      return () => {
        window.removeEventListener('online', callback);
        window.removeEventListener('offline', callback);
      };
    },
    () => navigator.onLine,                // getSnapshot：客户端此刻的货是什么
    () => true,                            // getServerSnapshot：SSR 时用，两端必须一致
  );
}
```

原理：

```text
useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
   ↓
渲染时读取 getSnapshot()                 // 每次取货都先看当前批次
   ↓ 若更新可能与并发渲染中途读到的快照不一致
React 采用「同步一致性」策略：
   ├── 对外部 store 的更新强制走同步渲染   // 供应商送货时全厂暂停对账
   └── 提交前再次校验快照，若已变化则重渲染 // 上料前再核对一遍批次号
        → 保证同一次提交读到同一版本，消除撕裂
```

要点：

- `getSnapshot` 必须返回**缓存稳定**的值（同一时刻多次调用返回同一引用），否则 React 会认为一直在变，陷入死循环。
- `getServerSnapshot` 用于 SSR，保证服务端与客户端首帧一致。
- 它是 react-redux v8、Zustand 等库对接 React 并发的基石。
- 相比「手写 useEffect + useState 订阅」，它天然避免撕裂与「订阅晚一拍」的问题——后者指组件已经渲染完才挂上监听，中间漏掉的那次更新就丢了。

```typescript
// 用一个极简外部 store 演示怎么接
const store = {
  value: 0,
  listeners: new Set<() => void>(),
  subscribe(l: () => void) { this.listeners.add(l); return () => this.listeners.delete(l); },
  getSnapshot() { return this.value; },
  set(v: number) { this.value = v; this.listeners.forEach((l) => l()); },
};

function useValue() {
  return useSyncExternalStore(
    store.subscribe.bind(store),
    store.getSnapshot.bind(store),
    store.getSnapshot.bind(store),   // 没有服务端环境时，退化用同一个快照
  );
}
```

## useTransition 与 useDeferredValue：快慢两条通道

两者都是把「不紧急的更新」标记为低优先级，让加急的活儿先过。细节见 [并发特性](/react/scheduler/concurrent)。

| 对比项 | useTransition | useDeferredValue |
|--------|---------------|------------------|
| 输入 | 一段 setState 逻辑 | 一个值 |
| 是否给 pending | 返回 `isPending` | 需自行比较值是否滞后 |
| 适用 | 知道哪些更新该降级 | 值来自 props，改不了来源 |

打个比方：`useTransition` 是你手里有一张"普通通道"的通行证，自己决定哪批货走慢线；`useDeferredValue` 则是货已经在别人手里，你只能让它在门口多等一会儿。

## useInsertionEffect：刷漆前先把壁纸贴好

用途：给 **CSS-in-JS** 库在「样式被读取前」注入 `<style>` 标签。

```typescript
useInsertionEffect(() => {
  const style = document.createElement('style');
  style.textContent = generatedCSS;
  document.head.appendChild(style);   // 把样式塞进 head，且要赶在布局测量之前
  return () => style.remove();        // 卸载时把注入的样式撤掉
}, [generatedCSS]);
```

时机：

```text
render → commit
          ├── mutation（改 DOM）
          ├── useInsertionEffect   ← 在此同步执行，早于 layout effect
          └── layout（useLayoutEffect）
                 ↓ 浏览器绘制
          passive（useEffect）
```

要点：

- 在 `useLayoutEffect` 之前运行，保证布局读取时样式已插入，避免样式晚到导致的闪烁。
- 此时 **ref 尚未绑定**，不能读 DOM；也不要在里面 setState。
- 普通业务代码几乎不用它，它是给库作者准备的。

## 自动批处理与 StrictMode：两条容易忽略的规矩

自动批处理：React 18 `createRoot` 起，无论更新发生在合成事件、`setTimeout`、Promise 还是原生事件里，同一微任务窗口内的多次 setState 都会被合并成一次渲染（详见 [useState 与更新队列](/react/hooks/usestate-queue)）。

```typescript
// React 18：下面两次 setState 只触发一次渲染
setTimeout(() => {
  setCount((c) => c + 1);
  setFlag((f) => !f);
}, 0);
```

StrictMode（仅开发环境）：对每个组件做「挂载 → 卸载 → 再挂载」，并**双调用** render 与 effect，用来暴露不纯的渲染与缺失的清理。

```tsx
<StrictMode>
  <App />
</StrictMode>
```

目的：检测「副作用写在 render 里」「订阅没清理」等问题；生产环境不会双调用。就像质检部门故意把零件装拆两遍，只为看它经不经得起重复操作。

| 需求 | 选择 |
|------|------|
| 需要稳定唯一的 id（含 SSR） | `useId` |
| 订阅 Redux / Zustand / 浏览器 API | `useSyncExternalStore` |
| 降级一段 setState 更新 | `useTransition` |
| 降级一个来自 props 的值 | `useDeferredValue` |
| 给库注入样式（早于 layout） | `useInsertionEffect` |
| 读取 DOM 布局 | `useLayoutEffect` |
| 数据请求 / 订阅（不阻塞绘制） | `useEffect` |

## 面试答法

React 18 新增的这几个 Hook，解决的是跨端一致性和外部数据订阅两类问题。useId 靠组件在树中的位置生成 id，服务端和客户端首帧一致，避免 Math.random 或全局自增计数器带来的 hydration mismatch，它只保证唯一稳定，不该拿来做列表 key 或 CSS 选择器。useSyncExternalStore 用 subscribe、getSnapshot、getServerSnapshot 三个参数订阅 React 之外的数据源，通过同步一致性校验避免并发渲染下的撕裂，是把 Redux、Zustand 接入并发的基石，前提是 getSnapshot 返回稳定引用，SSR 时要提供 getServerSnapshot。useTransition 和 useDeferredValue 是把非紧急更新降为低优先级的两个入口，前者包裹一段 setState 逻辑并返回 isPending，后者只延迟一个值。useInsertionEffect 专给 CSS-in-JS 库在 layout effect 之前注入样式，此时 ref 还没绑定、不能读 DOM，也不该 setState。此外 React 18 引入自动批处理，createRoot 之后任意来源的多次 setState 会在同一微任务内合并成一次渲染，StrictMode 只在开发环境双调用渲染与 effect，用来暴露不纯的渲染和缺失的清理。
