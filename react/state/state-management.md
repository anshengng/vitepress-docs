# React 状态管理原理

## 为什么需要状态管理

组件树是单向数据流，state 只能自上而下传递。当一份状态要跨多层甚至跨分支被读写时，纯靠 props 会很痛苦。状态管理库要解决的正是「把状态放到组件树之外，再用订阅把变化精确通知给关心的组件」。

| 问题 | 现象 | 常见方案 |
|------|------|----------|
| props 层层透传 | A → B → C → D 只为传一层 | Context / 状态库 |
| 跨组件共享 | 兄弟或远房组件读同一份状态 | 状态提升 / 全局 store |
| 更新范围失控 | 一个值变就重渲染整棵子树 | 细粒度订阅（Zustand / Jotai） |
| 服务端状态 | 接口数据要缓存、失效、共享 | TanStack Query 等 |

关键区分：**客户端状态**（主题、开关、表单草稿）和**服务端状态**（接口数据、缓存）适合不同的工具，别把接口数据硬塞进 Redux。

## Redux 的核心

Redux 有三条铁律：单一 store、state 只读、用纯函数 reducer 计算新 state。

```text
dispatch(action)
   ↓
store 用当前 state + action 调用 rootReducer
   ↓
reducer 返回新的 state（不可变，绝不修改旧对象）
   ↓
store 更新 state，通知所有订阅者
   ↓
订阅者（UI）读取新 state → 重渲染
```

```typescript
function createStore(reducer, preloadedState) {
  let currentState = preloadedState;
  let listeners: Array<() => void> = [];
  const getState = () => currentState;

  const dispatch = (action) => {
    currentState = reducer(currentState, action); // 纯函数产出新 state
    listeners.forEach((l) => l());                // 通知订阅者
    return action;
  };

  const subscribe = (listener) => {
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener); // 返回取消订阅
    };
  };

  dispatch({ type: '@@INIT' }); // 用初始 action 建立初值
  return { getState, dispatch, subscribe };
}
```

不可变更新的意义：新旧引用不同才能用 `Object.is` 快速判断是否变化，也才能做时间旅行与可靠 diff。

```typescript
// 错误：直接改原对象，引用没变，订阅者以为没更新
state.user.name = 'Tom';

// 正确：返回新对象
return { ...state, user: { ...state.user, name: 'Tom' } };
```

## Redux 中间件的原理

中间件本质是**包装 dispatch**：把 `store.dispatch` 换成一个链式调用的函数，每层调用 `next(action)` 交给下一层，形成洋葱模型。

```typescript
const thunk = ({ dispatch, getState }) => (next) => (action) => {
  if (typeof action === 'function') {
    return action(dispatch, getState); // 拦截函数型 action
  }
  return next(action);                 // 否则交给下一个中间件或真正的 dispatch
};
```

`applyMiddleware` 用 `compose` 把所有中间件串成一条链：

```text
dispatch
   ↓ 依次进入各层前置逻辑
middleware1  前置逻辑
   ↓ next(action)
middleware2  前置逻辑
   ↓ next(action)
真正的 store.dispatch → reducer 执行
   ↓ 返回值逐层回传
middleware2  后置逻辑
   ↓
middleware1  后置逻辑
```

洋葱模型的价值：进入时逐层执行前置逻辑，到达核心后逐层执行后置逻辑，因此能同时做「调用前」与「响应后」的事情（如日志、鉴权、错误上报）。

| 中间件 | 定位 | 差异 |
|--------|------|------|
| redux-thunk | 函数型 action | 轻量，异步逻辑直接写在函数里，无新概念 |
| redux-saga | generator | 声明式副作用，用 `take / put / call` 编排，适合复杂流程与取消 |
| redux-observable | RxJS | 以事件流为模型，适合事件序列处理 |

## react-redux：Provider 与订阅

`<Provider store={store}>` 把 store 放进 React Context（`ReactReduxContext`），但**组件并不通过 context 读 state**——context 只用来传 store 引用，真正读 state 靠订阅。

```tsx
<Provider store={store}>
  <App />
</Provider>

function Counter() {
  const count = useSelector((s) => s.count); // 订阅并取切片
  const dispatch = useDispatch();
  return <button onClick={() => dispatch({ type: 'add' })}>{count}</button>;
}
```

`useSelector` 的工作过程：

```text
useSelector(selector, equalityFn)
   ↓ 内部基于 useSyncExternalStore
   ├── subscribe：store.subscribe(listener)
   ├── getSnapshot：() => selector(store.getState())
   └── 新旧切片用 equalityFn（默认 Object.is / shallowEqual）比较
        结果变了才让该组件重渲染
```

要点：只有 `selector` 结果发生变化的组件才重渲染，没订阅的组件完全不受影响，这是性能关键；react-redux v8 起底层就是 `useSyncExternalStore`，因此在并发渲染下不会撕裂。

## Zustand 原理

Zustand 的 store 是一个闭包，暴露 `getState / setState / subscribe`；对应的 Hook 用 `useSyncExternalStore` 订阅，选择器决定重渲染粒度。

```typescript
import { create } from 'zustand';

const useStore = create((set) => ({
  count: 0,
  inc: () => set((s) => ({ count: s.count + 1 })), // 合并式更新
}));

function Counter() {
  const count = useStore((s) => s.count); // 只订阅 count
  const inc = useStore((s) => s.inc);
  return <button onClick={inc}>{count}</button>;
}
```

```text
create(config) → store（闭包持有 state 与 listeners）
   ↓ 返回的 useStore 本质是
useSyncExternalStore(store.subscribe, () => selector(store.getState()))
   ↓ selector 结果变化 → 仅该组件重渲染
```

特点：默认无需 Provider（单例 store，也可用 context 造多实例）、样板代码少、靠选择器控制更新范围。setState 默认浅合并，也可整体替换。

## 原子化：Jotai / Recoil

思想是**把状态拆成最小原子（atom），每个原子各自订阅**，组件只订阅它用到的原子，避免一个大 store 的更新放大到无关组件。

```typescript
import { atom, useAtom } from 'jotai';

const countAtom = atom(0);
const doubleAtom = atom((get) => get(countAtom) * 2); // 派生原子

function Counter() {
  const [count, setCount] = useAtom(countAtom);
  return <button onClick={() => setCount((c) => c + 1)}>{count}</button>;
}
```

- Jotai：自底向上，atom 即状态单元，派生原子自动追踪依赖。
- Recoil：Facebook 的早期方案，atom + selector，依赖 React context 与实验特性，维护趋于停滞。

## 各方案对比

| 方案 | 心智模型 | 重渲染粒度 | 样板代码 | 适用场景 |
|------|----------|------------|----------|----------|
| Redux | 单一 store + reducer + action | 选择器订阅 | 多 | 大型、需可回溯、团队规范统一 |
| Zustand | 闭包 store + 选择器 | 选择器订阅 | 少 | 中小型、想轻量灵活 |
| Jotai / Recoil | 原子化 | 原子级 | 少 | 派生状态多、要细粒度 |
| React Context | 组件树共享值 | 值变则全部消费者重渲染 | 少 | 低频全局值（主题、语言） |
| TanStack Query | 服务端状态缓存 | 按 key 订阅 | 中等 | 接口数据、缓存与失效 |

Context 只适合「低频变化、消费者不多」的全局值；一旦值频繁变化，所有消费者都会重渲染，正是状态库用选择器订阅要解决的问题。

## 面试答法

状态管理的本质是把状态放到组件树之外，再用订阅机制把变化精确通知给真正关心的组件，从而解决 props 层层透传、跨组件共享和更新范围失控的问题。Redux 是单一 store、state 只读、由纯函数 reducer 处理 action：dispatch 时用当前 state 和 action 调 reducer 得到新 state，再通知订阅者，且更新必须不可变，返回新对象才能让引用比对发现问题。中间件的本质是包装 dispatch，用 compose 把多层函数串成洋葱模型，每层调用 next 交到下一层，前置与后置逻辑都能执行，redux-thunk 用函数型 action 处理简单异步，redux-saga 用 generator 声明式编排复杂副作用。react-redux 用 Provider 通过 context 只传 store 引用，useSelector 内部用 useSyncExternalStore 订阅 store 并比较选择器结果，只有切片变化的组件才重渲染；Zustand 同样是闭包 store 加 useSyncExternalStore 订阅，靠选择器控制粒度；Jotai 这类则把状态拆成原子、各自独立订阅，做到更细。选型上大型规范场景用 Redux，轻量用 Zustand，派生状态多、要细粒度用 Jotai，接口数据交给 TanStack Query 这类服务端状态库，Context 只留给低频全局值。
