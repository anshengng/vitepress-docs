# React 18 新 Hook

## 总览

React 18 为并发渲染补齐了几个底层 Hook，它们解决的是「跨端一致性」与「外部数据源订阅」这两类问题。

| Hook | 解决的问题 | 典型使用者 |
|------|------------|------------|
| `useId` | SSR / CSR 生成一致的稳定 id | 无障碍属性、表单 label |
| `useSyncExternalStore` | 外部 store 订阅 + 避免撕裂 | Redux、Zustand、自写 store |
| `useTransition` | 标记非紧急更新 | 搜索、Tab 切换 |
| `useDeferredValue` | 延迟某个值 | 来自 props 的重计算 |
| `useInsertionEffect` | 布局读取前注入样式 | CSS-in-JS 库 |

## useId

用途：生成一个在服务端与客户端**首帧一致**的 id，避免 hydration mismatch。

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

为什么不能改用别的方式生成：

```text
Math.random()   ：服务端与客户端各生成一次 → 值不同 → mismatch
全局自增计数器  ：客户端模块加载顺序/时机不同 → 值不同 → mismatch
useId           ：由组件在树中的「位置」推导 → 两端同一位置 → 值一致
```

要点：

- 值只保证「唯一、稳定、两端一致」，内容无意义，**不要**拿来做 CSS 选择器或列表 key。
- 列表 key 应由数据提供，而不是用 `useId`。
- 它正是 [SSR 与 hydration](/react/ssr/ssr-hydration) 里解决「不稳定 id」的推荐手段。

## useSyncExternalStore

用途：安全地订阅 React 之外的数据源，并在并发渲染下**避免撕裂（tearing）**。

撕裂是什么：并发渲染可能把一次渲染拆成多段，若在这期间外部数据变了，同一次提交里不同组件可能读到不同版本的数据（一半新、一半旧）。

```typescript
import { useSyncExternalStore } from 'react';

function useOnlineStatus() {
  return useSyncExternalStore(
    (callback) => {                        // subscribe：注册监听，返回取消订阅
      window.addEventListener('online', callback);
      window.addEventListener('offline', callback);
      return () => {
        window.removeEventListener('online', callback);
        window.removeEventListener('offline', callback);
      };
    },
    () => navigator.onLine,                // getSnapshot：客户端当前快照
    () => true,                            // getServerSnapshot：SSR 时用，两端须一致
  );
}
```

原理：

```text
useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
   ↓
渲染时读取 getSnapshot()
   ↓ 若更新可能与并发渲染中途读到的快照不一致
React 采用「同步一致性」策略：
   ├── 对外部 store 的更新强制走同步渲染
   └── 提交前再次校验快照，若已变化则重渲染
        → 保证同一次提交读到同一版本，消除撕裂
```

要点：

- `getSnapshot` 必须返回**缓存稳定**的值（同一时刻多次调用返回同一引用），否则会死循环。
- `getServerSnapshot` 用于 SSR，保证服务端与客户端首帧一致。
- 它是 react-redux v8、Zustand 等库对接 React 并发的基石。
- 相比「手写 useEffect + useState 订阅」，它天然避免撕裂与「订阅晚一拍」的问题。

```typescript
// 用一个极简外部 store 演示对接
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
    store.getSnapshot.bind(store),
  );
}
```

## useTransition 与 useDeferredValue（简要）

两者把「不紧急的更新」标记为低优先级，细节见 [并发特性](/react/scheduler/concurrent)。

| 对比项 | useTransition | useDeferredValue |
|--------|---------------|------------------|
| 输入 | 一段 setState 逻辑 | 一个值 |
| 是否给 pending | 返回 `isPending` | 需自行比较值是否滞后 |
| 适用 | 知道哪些更新该降级 | 值来自 props，改不了来源 |

## useInsertionEffect

用途：给 **CSS-in-JS** 库在「样式被读取前」注入 `<style>` 标签。

```typescript
useInsertionEffect(() => {
  const style = document.createElement('style');
  style.textContent = generatedCSS;
  document.head.appendChild(style);
  return () => style.remove();
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

- 在 `useLayoutEffect` 之前运行，保证布局读取时样式已插入，避免闪烁。
- 此时 **ref 尚未绑定**，不能读 DOM；也不要在里面 setState。
- 普通业务代码几乎不用它，它是给库作者准备的。

## 自动批处理与 StrictMode

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

目的：检测「副作用写在 render 里」「订阅没清理」等问题；生产环境不会双调用。

## 何时用哪个 Hook

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

React 18 新增的这几个 Hook 分别解决跨端一致性和外部数据订阅两类问题。useId 用组件在树中的位置生成 id，保证服务端和客户端首帧一致，从而避免用 Math.random 或全局自增计数器带来的 hydration mismatch，它只保证唯一稳定，不该拿来做列表 key 或 CSS 选择器。useSyncExternalStore 用 subscribe、getSnapshot、getServerSnapshot 三个参数订阅 React 之外的数据源，通过同步一致性检查避免并发渲染下的撕裂，是把 Redux、Zustand 这类外部 store 安全接入并发的基石，前提是 getSnapshot 返回稳定引用，并在 SSR 时提供 getServerSnapshot。useTransition 和 useDeferredValue 是把非紧急更新降为低优先级的两个入口，区别在于前者包裹一段 setState 逻辑并返回 isPending、后者只延迟一个值，细节在并发特性里。useInsertionEffect 专给 CSS-in-JS 库在 layout effect 之前注入样式，此时 ref 还没绑定、不能读 DOM，也不该 setState。此外 React 18 引入自动批处理，createRoot 之后任意来源的多次 setState 在同一微任务内会被合并成一次渲染，StrictMode 则只在开发环境双调用渲染与 effect，用来暴露不纯的渲染和缺失的清理。
