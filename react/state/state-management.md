# 状态管理：为什么改一个开关要写四个文件

## 先说一个真实场景

页面顶部有个主题切换按钮，状态定义在最外层的 `<App>`，真正用到它的却是第五层的 `<Button>`。中间每一层都得写一遍 `props.theme`，改个字段名要翻五个文件。再比如"侧边栏是否展开"这种状态，兄弟组件也要用，最后只能往上提，父组件被迫变成状态中转站。

于是去搜方案，找到 Redux，跟着教程写了个计数器，结果冒出 `store.js`、`actions.js`、`reducer.js`、`Counter.jsx` 四个文件。第一反应是：我就想加个 1，为什么要写这么多？

这一篇就是回答这个问题的。

先把底牌亮出来：所有状态管理库干的是同一件事——**把状态从组件的局部变量里搬到组件树外面，再让关心的组件"订阅"变化**。差别只有三处：仓库长什么样、谁能改、通知有多精确。

## 把状态搬进仓库：三种租法

用仓库打比方，三种做法对应三种方案：

| 做法 | 现实体验 | 对应方案 |
|---|---|---|
| 每人抽屉里放一份 | 想借给别人只能一层层手递手 | props 透传 |
| 走廊挂一块公告板 | 谁都能看，但换公告全楼抬头 | Context |
| 独立仓库 + 领料单 | 集中存放，按需订阅，改一处只通知相关人 | Redux / Zustand / Jotai |

需要解决的问题可以列成一张表：

| 问题 | 现象 | 常见方案 |
|------|------|----------|
| props 层层透传 | A → B → C → D 只为传一层 | Context / 状态库 |
| 跨组件共享 | 兄弟或远房组件读同一份状态 | 状态提升 / 全局 store |
| 更新范围失控 | 一个值变就重渲染整棵子树 | 细粒度订阅（Zustand / Jotai） |
| 服务端状态 | 接口数据要缓存、失效、共享 | TanStack Query 等 |

这里要先划一条线：**客户端状态**（主题、开关、表单草稿）和**服务端状态**（接口数据、缓存）适合不同工具。把接口数据硬塞进 Redux，等于让仓库管理员兼职跑腿送快递，最后两头都累。

## Redux 为什么写这么多：因为仓库有制度

Redux 的三条铁律，说白了就是仓库的三条管理规定：

1. **只有一个仓库**（单一 store），不许各组件私开小仓；
2. **货物只读**，谁都不能伸手进去直接改；
3. **改货必须填领料单**（action），仓管（reducer）照着单子算出一批**全新的货**。

流程是这样的：

```text
dispatch(action)                              // 递上一张领料单
   ↓
store 用当前 state + action 调用 rootReducer  // 仓管拿现存货物和单子核算
   ↓
reducer 返回新的 state（不可变，绝不修改旧对象） // 产出一批新货，旧货原封不动
   ↓
store 更新 state，通知所有订阅者               // 换上新货，广播
   ↓
订阅者（UI）读取新 state → 重渲染
```

代码本身不长，难点在于"为什么要这么绕"：

```typescript
function createStore(reducer, preloadedState) {
  let currentState = preloadedState;          // 仓库当前库存
  let listeners: Array<() => void> = [];      // 订阅广播名单
  const getState = () => currentState;        // 查库存，且只给看不给改

  const dispatch = (action) => {
    currentState = reducer(currentState, action); // 拿单子算出新库存
    listeners.forEach((l) => l());                // 挨个通知订阅者该重渲染
    return action;
  };

  const subscribe = (listener) => {
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener); // 返回一张"退订凭据"
    };
  };

  dispatch({ type: '@@INIT' }); // 空跑一次，让 reducer 把初始库存建出来
  return { getState, dispatch, subscribe };
}
```

"不可变"这条规矩的价值，看两行代码就懂：

```typescript
// 错误：直接改原对象，引用没变，订阅者以为没更新
state.user.name = 'Tom';

// 正确：返回新对象
return { ...state, user: { ...state.user, name: 'Tom' } };
```

仓库里还是原来那个箱子，箱子编号没变，门口保安（`Object.is`）就认为"没换货"，不放行。只有整箱换新、引用变了，才能一眼判断有没有更新；时间旅行、可靠的 diff 也全建立在这个前提上。

## 中间件：领料单为什么要过好几道岗

中间件的本质是**包装 dispatch**：把 `store.dispatch` 换成一个链式调用的函数，每层调用 `next(action)` 交给下一层，形成洋葱模型。

```typescript
const thunk = ({ dispatch, getState }) => (next) => (action) => {
  if (typeof action === 'function') {
    return action(dispatch, getState); // 单子不是标准格式而是"办事流程"，直接照做
  }
  return next(action);                 // 标准单子，交给下一道岗，最终到仓管
};
```

`applyMiddleware` 用 `compose` 把所有中间件串成一条链：

```text
dispatch（递单）
   ↓ 依次进入各层前置逻辑
middleware1  门卫：先查单子格式（前置）
   ↓ next(action)
middleware2  质检：记录、鉴权（前置）
   ↓ next(action)
真正的 store.dispatch → reducer 执行（仓管入库）
   ↓ 返回值逐层回传
middleware2  质检：处理结果（后置）
   ↓
middleware1  门卫：盖章放行（后置）
```

洋葱模型的价值：进入时逐层执行前置逻辑，到达核心后逐层执行后置逻辑，所以能同时做"调用前"和"响应后"的事，比如日志、鉴权、错误上报。常见中间件的差别：

| 中间件 | 定位 | 差异 |
|--------|------|------|
| redux-thunk | 函数型 action | 轻量，异步逻辑直接写在函数里，只多一个概念 |
| redux-saga | generator | 声明式副作用，用 `take / put / call` 编排，适合复杂流程与取消 |
| redux-observable | RxJS | 以事件流为模型，适合事件序列处理 |

## react-redux：公告板上只挂钥匙

`<Provider store={store}>` 把 store 放进 React Context（`ReactReduxContext`），但**组件并不通过 context 读 state**——context 只用来传 store 这把"钥匙"，真正取货走的是订阅窗口。

```tsx
<Provider store={store}>
  <App />
</Provider>

function Counter() {
  const count = useSelector((s) => s.count); // 只订阅自己关心的那一格货
  const dispatch = useDispatch();
  return <button onClick={() => dispatch({ type: 'add' })}>{count}</button>;
}
```

`useSelector` 的工作过程：

```text
useSelector(selector, equalityFn)
   ↓ 内部基于 useSyncExternalStore
   ├── subscribe：store.subscribe(listener)          // 登记：仓库有变动叫我
   ├── getSnapshot：() => selector(store.getState()) // 取货：只要我这一格
   └── 新旧切片用 equalityFn（默认 Object.is / shallowEqual）比较
        结果变了才让该组件重渲染                     // 货没变就别惊动我
```

要点：只有 `selector` 结果发生变化的组件才重渲染，没订阅的组件完全不受影响，这是性能关键；react-redux v8 起底层就是 `useSyncExternalStore`，因此在并发渲染下不会撕裂。

## Zustand：一间自助仓

Zustand 的 store 是一个闭包，暴露 `getState / setState / subscribe`；对应的 Hook 用 `useSyncExternalStore` 订阅，选择器决定重渲染粒度。它相当于把 Redux 那套制度撤了，钥匙直接给员工，谁要货自己进去拿。

```typescript
import { create } from 'zustand';

const useStore = create((set) => ({
  count: 0,
  inc: () => set((s) => ({ count: s.count + 1 })), // 合并式更新，返回新对象
}));

function Counter() {
  const count = useStore((s) => s.count); // 只订阅 count 这一格
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

特点：默认无需 Provider（单例 store，也可用 context 造多实例）、样板代码少、靠选择器控制更新范围。`setState` 默认浅合并，也能整体替换。

## Jotai：把货拆进一个个小格子

原子化方案换个思路：不再守一个大仓库，而是**把状态拆成最小原子（atom），每个原子各自订阅**。组件只订阅它用到的那个格子，邻格变动跟它无关，更新自然缩到最小。

```typescript
import { atom, useAtom } from 'jotai';

const countAtom = atom(0);
const doubleAtom = atom((get) => get(countAtom) * 2); // 派生原子，自动追踪依赖

function Counter() {
  const [count, setCount] = useAtom(countAtom);
  return <button onClick={() => setCount((c) => c + 1)}>{count}</button>;
}
```

- Jotai：自底向上，atom 即状态单元，派生原子自动追踪依赖。
- Recoil：Facebook 的早期方案，atom + selector，依赖 React context 与实验特性，维护趋于停滞。

## Context：公告板只适合贴不常改的东西

Context 是 React 自带的"走廊公告板"，值一变，**所有消费者都会重渲染**。所以它只适合低频变化、消费者不多的全局值，比如主题、语言。真遇到频繁变化的状态，就得靠状态库的选择器订阅，把通知范围收窄到真正关心的人。

| 方案 | 心智模型 | 重渲染粒度 | 样板代码 | 适用场景 |
|------|----------|------------|----------|----------|
| Redux | 单一 store + reducer + action | 选择器订阅 | 多 | 大型、需可回溯、团队规范统一 |
| Zustand | 闭包 store + 选择器 | 选择器订阅 | 少 | 中小型、想轻量灵活 |
| Jotai / Recoil | 原子化 | 原子级 | 少 | 派生状态多、要细粒度 |
| React Context | 组件树共享值 | 值变则全部消费者重渲染 | 少 | 低频全局值（主题、语言） |
| TanStack Query | 服务端状态缓存 | 按 key 订阅 | 中等 | 接口数据、缓存与失效 |

一句话选型：大型且要规范统一用 Redux，中小项目想轻快用 Zustand，派生多、要极细粒度用 Jotai，接口数据交给 TanStack Query，Context 只留低频全局值。

## 面试答法

状态管理的本质，是把状态从组件内部搬到组件树外的仓库，再用订阅把变化精确通知给真正关心的组件，解决 props 层层透传、跨组件共享和更新失控三个问题。Redux 是单一 store、state 只读、由纯函数 reducer 处理 action：dispatch 时用当前 state 和 action 算出新 state 再广播，必须返回新对象才能靠引用比对发现变化。中间件的本质是包装 dispatch，用 compose 串成洋葱模型，每层 next 交下去，前置后置逻辑都能跑，thunk 处理函数型 action，saga 用 generator 编排复杂副作用。react-redux 用 Context 只传 store 引用，useSelector 内部基于 useSyncExternalStore，比较选择器结果决定是否重渲染；Zustand 也是闭包 store 加同样的订阅，靠选择器控制粒度；Jotai 把状态拆成原子各自订阅。选型上，大型规范用 Redux，轻量用 Zustand，细粒度用 Jotai，接口数据用 TanStack Query，Context 只放低频全局值。
