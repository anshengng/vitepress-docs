# React 底层原理

React 与 Vue 的底层思路差异很大：Vue 有独立的响应式系统做依赖收集，React 则靠 **setState 触发重渲染 + Fiber 树 diff** 来更新界面。
本分区先按 React 的**包结构**拆开核心机制，再按主题补充面试高频的扩展专题，共 11 组 27 篇。

| 分组 | 篇数 | 对应源码包 | 核心问题 |
|------|------|-----------|---------|
| JSX 与 Element | 2 | `react` | JSX 编译成什么，Element 与 Fiber 什么关系 |
| Fiber 架构 | 3 | `react-reconciler` | 为什么可中断，双缓冲怎么做，diff 怎么比 |
| Hooks 原理 | 4 | `react-reconciler`（ReactFiberHooks） | 状态存在哪里，更新队列与闭包陷阱 |
| 调度与并发 | 4 | `scheduler` | 时间切片、Lane 优先级、并发与 Suspense |
| 事件系统 | 1 | `react-dom-bindings` | 合成事件与委托位置 |
| Context 与 Ref | 2 | `react-reconciler` | 跨层传值与 DOM 引用怎么实现 |
| 渲染与表单 | 2 | `react-dom` | Portals 与受控/非受控组件 |
| 优化与生命周期 | 3 | `react` / `react-reconciler` | bailout、PureComponent、错误边界、类组件生命周期 |
| 状态管理与路由 | 2 | 生态 | 全局状态方案与 React Router 原理 |
| 现代特性与 SSR | 3 | `react` / `react-dom` | React 18/19 新特性、SSR 与水合 |
| 手写实现 | 1 | —— | 用几百行还原 React 的核心链路 |

## 一、核心机制

### JSX 与 Element

React 没有自己的模板语法，JSX 只是编译期语法糖，产物是普通的 Element 对象。

- [JSX 本质与编译](/react/jsx/jsx-compile)：jsx-runtime 自动引入、createElement 与 jsx/jsxs、Element 对象结构、key/ref 的特殊处理
- [Element 与 Fiber 的区别](/react/jsx/element-vs-fiber)：Element 只是「描述」，Fiber 才是「可调度的工作单元」，由此引出 Fiber

### Fiber 架构

Fiber 是 React 16 之后的核心重构，把原来不可中断的递归协调，改造成可中断、可恢复的链表遍历。

- [为什么要 Fiber](/react/fiber/why-fiber)：Stack Reconciler 的问题、16ms 帧预算、child/sibling/return 三指针结构
- [双缓冲与两阶段](/react/fiber/double-buffer)：current 与 workInProgress 树、render 阶段的 beginWork/completeWork、commit 的三子阶段
- [协调与 Diff](/react/fiber/reconcile-diff)：单链表遍历、key 的作用、bailout 优化与 props 浅比较

### Hooks 原理

函数组件没有实例，所有 Hook 状态挂在 Fiber 的 `memoizedState` 链表上，这是「不能条件调用 Hook」的根本原因。

- [Hooks 链表](/react/hooks/hooks-link)：memoizedState 链表、mount/update 两套 dispatcher、调用顺序为什么必须稳定
- [useState 与更新队列](/react/hooks/usestate-queue)：useReducer 底层、环形更新队列、eagerState、批处理与闭包陷阱
- [useEffect 与 useMemo](/react/hooks/effect-and-memo)：effect 环形链表、依赖浅比较、清理函数、useLayoutEffect 的区别
- [手写简化版 Hooks](/react/hooks/handwritten-hooks)：用几十行代码还原 useState / useEffect 的游标与依赖比较

### 调度与并发

调度器是一个独立发布的包，是 React 并发渲染的底座，核心是「时间切片 + 优先级」。

- [Scheduler 与时间切片](/react/scheduler/scheduler-slice)：MessageChannel 调度、shouldYield、workLoopConcurrent、双队列
- [Lane 优先级模型](/react/scheduler/lane-model)：31 位二进制车道、位运算合并与判断、批处理原理
- [并发特性](/react/scheduler/concurrent)：startTransition、useDeferredValue、可中断与高优插队
- [Suspense 原理](/react/scheduler/suspense)：throw Promise 挂起、offscreen 树、与并发渲染的配合

### 事件系统

- [合成事件](/react/events/synthetic-event)：SyntheticEvent、React 17 起委托到 root 容器、与原生事件的差异

## 二、扩展专题

### Context 与 Ref

跨层级传值与 DOM 引用，是函数组件替代类组件后必须补充的两块能力。

- [Context 原理](/react/context/context)：Provider/Consumer、context 栈、新旧 API 差异与性能取舍
- [Ref 体系](/react/ref/ref-system)：createRef/useRef/forwardRef、ref 在 commit 阶段的赋值时机

### 渲染与表单

- [Portals](/react/render/portals)：createPortal、事件冒泡穿透、DOM 层级与 React 树的分离
- [受控与非受控组件](/react/forms/controlled-uncontrolled)：value/onChange 绑定、defaultValue、如何取舍

### 优化与生命周期

- [memo 与 PureComponent](/react/optimization/memo-purecomponent)：浅比较拦截重渲染、与 bailout 的关系
- [错误边界](/react/optimization/error-boundary)：getDerivedStateFromError、componentDidCatch、能捕获哪些错误
- [类组件生命周期](/react/lifecycle/class-lifecycle)：挂载/更新/卸载三阶段顺序，与 Hooks 的对应关系

### 状态管理与路由

- [状态管理方案](/react/state/state-management)：Context + useReducer、Redux、Zustand、MobX 的取舍
- [React Router 原理](/react/ecosystem/router)：History API、路由匹配与嵌套路由、与 hooks 式 API 的结合

### 现代特性与 SSR

- [React 18 新 Hooks](/react/modern/react18-hooks)：useId、useSyncExternalStore、useTransition、useDeferredValue
- [React 19 新特性](/react/modern/react19)：use、Actions、ref as prop、文档元数据、Compiler
- [SSR 与水合](/react/ssr/ssr-hydration)：renderToString、hydrateRoot、为什么会 hydration mismatch

### 手写实现

- [手写 mini-react](/react/handwritten/mini-react)：从 createElement 到 Fiber 渲染与 useState，串起整条链路

## 阅读顺序建议

```text
JSX 与 Element（先理解数据形状）
      ↓
Fiber 架构（为什么可中断、怎么调度、怎么 diff）
      ↓
Hooks 原理（状态挂在哪、更新怎么入队）
      ↓
调度与并发（优先级模型、并发特性、Suspense）
      ↓
扩展专题（Context/Ref、渲染表单、优化、状态管理、SSR、现代特性）
      ↓
手写实现（把前面的链路亲手串一遍）
```

## 与 Vue 的对比

React 分层与 Vue 的关键差异：

| 维度 | Vue 3 | React |
|------|-------|-------|
| 更新触发 | 响应式系统依赖收集，精确知道谁变了 | setState 标记组件脏，重渲染 + diff |
| 编译时 | 编译器做大量静态优化（PatchFlags、Block Tree） | JSX 只是轻量语法糖，优化主要在运行时 |
| 运行时核心 | 虚拟 DOM + 靶向 diff | Fiber + 可中断调度 + Lane 优先级 |
| 平台抽象 | runtime-dom 是平台适配层 | 平台层拆成 react-dom + react-dom-bindings |

详见 [Vue vs React 对比](/compare/vue-vs-react)。
