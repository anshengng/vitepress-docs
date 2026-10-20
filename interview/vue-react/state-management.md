# 状态管理对比（Pinia vs Redux vs Vuex）

## 题目

> 为什么需要状态管理库？props 逐层传递有什么问题？Pinia、Vuex、Redux 各自的核心机制是什么？Redux 为什么强制 reducer 是纯函数？三者的概念怎么一一对应？新项目怎么选？Pinia 怎么做持久化？

## 为什么需要

组件内部状态用 `useState`/`ref` 就够了。但当**多个不相邻的组件共享同一份状态**（登录用户、购物车、主题）时，靠组件树传递会出问题：

类比：**家族群传话**。爷爷要告诉孙子一件事，只能爷爷→爸爸→叔叔→爸爸→孙子一路转达，中间每个人都得"复读一遍"哪怕跟自己毫无关系（prop drilling）；而且孙子想直接回话，得原路传回去。状态管理库相当于**建一个家庭公共白板**：谁需要谁直接看、直接写，白板本身保证"改了就通知所有在看的人"。

```
没有状态库（prop 钻链 + 事件回传）：
App ─ userInfo ─► Layout ─ userInfo ─► Nav ─ userInfo ─► Avatar
                                                      ◄─ emit 改名字
                                    ▲ 中间层被迫"过路"，
Layout ─ cart ─► Page ─ cart ─► CartList ─ cart ─► Item   改了也要逐层 emit
      └ 组件重命名/删一层，全链路 props 都要改 → 脆弱

有状态库（外部 store 订阅）：
            ┌─────────── Store（白板）───────────┐
            │  user: {...}   cart: [...]  theme  │
            └──▲────────▲──────────▲─────────────┘
        useStore 读/写  useStore   useStore
          Avatar       CartList     Header
      → 任意深度组件直接连接，中间层零感知
```

另外三个硬需求：**跨路由状态存活**（组件卸载状态还在）、**时间旅行调试**（Redux DevTools）、**复杂变更逻辑集中收口**（避免十个组件各写一份改 cart 的逻辑）。

## 核心要点

### 1. Pinia 核心机制：reactive store + 组合式，没有 mutation

```javascript
// stores/user.js —— Pinia 的定义方式就是"写一个组合式函数"
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useUserStore = defineStore('user', () => {
  const name = ref('张三')                 // state：一个 ref 就是一个响应式字段
  const isLogin = computed(() => !!name.value)  // getter：computed

  async function login(pay) {              // action：普通函数，天生支持 async
    const res = await api.login(pay)
    name.value = res.data.name             // 直接改，没有 mutation
  }

  return { name, isLogin, login }
})

// 任意组件里：
const user = useUserStore()
user.login({ code: 123 })                  // 读写都是属性访问，像本地 reactive 对象
```

机制拆解：

```
defineStore 内部：
  state 的 ref/reactive ──► 存进一个全局 reactive 对象（按 storeId 注册）
  组件 useStore()        ──► 返回同一对象的代理 → Vue 依赖收集自动追踪
  修改 name.value        ──► 触发响应式 → 所有用到的组件自动重渲染
  （所以 Pinia 不需要 $subscribe 也能更新视图，靠的是 Vue 响应式本身）
```

对比 Vuex 的三大简化：

- **没有 mutation**：action 里直接改 state，异步逻辑不再被拆成"commit 一个同步 mutation"
- **没有嵌套 module**：一个 store 一个文件，天然模块化，store 之间互相 `use` 即可
- **没有 getters 配置对象**：computed 就是 getter

### 2. Redux 核心机制：单向数据流 + 纯 reducer + 中间件

```
        ┌───────────────────────────────────────────┐
        │                    View（React 组件）      │
        │   useSelector 读 store ──► 渲染            │
        └───────────┬───────────────────────────────┘
                    │ dispatch(action)   ① 唯一入口：发"描述变化"的普通对象
                    ▼
        ┌───────────────────────────────────────────┐
        │  Middleware 层（thunk/saga）               │ ② 副作用只准在这
        │  拦截 action：异步活干完再 dispatch 真 action│     进主流程
        └───────────┬───────────────────────────────┘
                    ▼
        ┌───────────────────────────────────────────┐
        │  Reducer：(state, action) => newState     │ ③ 纯函数，不许改旧 state
        │  switch(action.type) 返回全新对象          │
        └───────────┬───────────────────────────────┘
                    ▼
        ┌───────────────────────────────────────────┐
        │  Store（持有唯一 state 树）                │ ④ 变了指向新对象
        │  通知订阅者 ──► useSelector 比对切片 ──► 重渲染（回到①）
        └───────────────────────────────────────────┘
```

```javascript
// reducer：纯函数示范
function cartReducer(state = { items: [] }, action) {
  switch (action.type) {
    case 'cart/add':
      // 返回新数组新对象，绝不 state.items.push(...)
      return { ...state, items: [...state.items, action.payload] }
    default:
      return state
  }
}

// thunk：副作用待在中间件，不进 reducer
const fetchCart = () => async (dispatch) => {   // dispatch 一个函数而非对象
  const res = await api.getCart()
  dispatch({ type: 'cart/set', payload: res.data })  // 干完异步再发真 action
}
```

**为什么 reducer 必须纯函数？**（高频追问）

1. **时间旅行调试**：DevTools 靠 `(旧state, action) → 新state` 重放任意历史节点；有副作用则重放结果不可复现
2. **变化可检测**：React-Redux 用 `===` 比较新旧 state 引用来决定要不要重渲染；原地 mutate 引用不变，UI 不更新
3. **可预测**：同样输入必得同样输出，状态变化变成可枚举的"action 日志"，方便定位"谁改的"

### 3. 三者概念对照表

| 概念 | Vuex | Pinia | Redux | 说明 |
| --- | --- | --- | --- | --- |
| 状态容器 | `state` | `ref/reactive` | `store.getState()` | 数据本体 |
| 读派生值 | `getters` | `computed` | selector 函数 | 派生/筛选 |
| 同步变更 | `mutations` | 无（action 直改） | reducer | Redux 靠 reducer 同步算新 state |
| 异步/业务 | `actions` | `actions` | action + 中间件 | thunk/saga 承载副作用 |
| 触发变更 | `commit`/`dispatch` | 直接调函数/改值 | `dispatch(action)` | 入口 |
| 模块化 | modules 嵌套树 | 平铺多个 store | combineReducers 拼一棵树 | Pinia 无嵌套 |
| 订阅更新 | Vue 响应式 | Vue 响应式 | store.subscribe + useSelector | Redux 手动比引用 |
| DevTools | 有 | 有 | 最完善（时间旅行） | |

### 4. 选型建议

```
Vue 3 新项目 ──────────────────► Pinia（官方推荐，Vuex 已进入维护模式）
Vue 2 老项目 ──────────────────► Vuex 4 / 维持现状，迁移成本高别硬迁
React 中小应用 ────────────────► 先问要不要库：Context+useReducer 可能就够
React 中大型/复杂状态流 ───────► Redux Toolkit（别手写原始 Redux 样板）
服务端数据为主（列表/详情缓存）─► 考虑 TanStack Query 接管，store 只留客户端状态
跨框架/极简诉求 ───────────────► Zustand / Jotai（了解即可，面试提一句是加分）
```

Redux Toolkit 的补充：现代 Redux 用 `createSlice`，内部用 Immer 写"可变风格"代码自动生成不可变更新，样板代码大幅减少——面试说"Redux 样板多"时记得补这句。

### 5. Pinia 持久化方案

```
方案 A：官方插件 pinia-plugin-persistedstate（最常用）
  main.ts:  pinia.use(piniaPluginPersistedstate)
  store:    defineStore('user', () => {...}, { persist: true })
            // 可配 key / storage: sessionStorage / paths: ['token']
  原理：    内部 $subscribe 订阅 store 变化 → 序列化写 localStorage；
            初始化时读缓存回填 state

方案 B：手动一行（面试手撕友好）
  watch(state, s => localStorage.setItem('user', JSON.stringify(s)), { deep: true })
  // 创建 store 时先 Object.assign 读回来的缓存

注意：SSR 场景 persist 要 pick 只存必要字段；localStorage 存的是明文，
     token 可接受、密码类绝不入本地存储。
```

## 面试答法

### 30 秒版（可背诵）

> 状态管理解决的是"跨组件树共享状态"问题：props 逐层钻链让无关中间层被迫转发、事件回传链路脆弱，组件卸载状态就丢。共同思路是把状态提到组件树之外的响应式仓库，谁用谁订阅。Pinia 是 Vue3 官方方案，用组合式函数定义 store，state 就是 ref、getter 就是 computed，没有 mutation、没有嵌套 module，改了直接触发视图更新。Redux 是 React 生态，核心是单向数据流：view 发 action，中间件处理副作用，纯函数 reducer 算出全新 state，store 通知订阅者——reducer 强制纯函数是为了时间旅行调试和引用比较更新。新项目选型：Vue3 用 Pinia，React 复杂状态用 Redux Toolkit，简单场景 Context 就够。

### 深入版（被追问时按编号展开）

1. **先画钻链图**：中间层"过路"转发 + emit 回传 → 脆弱；白板图 → 任意组件直连
2. **Pinia 机制**：defineStore 返回组合式函数；ref 即 state、computed 即 getter；底层靠 Vue 响应式，无需显式订阅
3. **Redux 环图**：dispatch → 中间件 → reducer → store → 订阅 → 重渲染，画单向环
4. **纯函数三理由**：可重放（DevTools 时间旅行）、引用比较才能触发更新、可预测
5. **对照表**：mutation↔reducer 是同步变更、action 在 Pinia 里合并了同步+异步
6. **收尾**：RTK 的 createSlice + Immer 消样板；Pinia 持久化用 persistedstate 插件（本质 $subscribe + localStorage）

### 常见追问

- **Redux 为什么要求 reducer 纯函数？** → 时间旅行重放依赖确定性；React-Redux 用 `===` 比引用决定是否重渲染，原地 mutate 引用不变 UI 不更新；副作用会让"state+action→新state"不可预测
- **Pinia 如何做持久化？** → `pinia-plugin-persistedstate`：插件里 `$subscribe` 监听变化写 localStorage，初始化回填；也可手写 deep watch
- **Vuex 为什么被 Pinia 取代？** → 去掉 mutation 和嵌套 module 两大样板、天然组合式 + TS 推导、体积更小；Pinia 是 Vue 官方文档推荐
- **Context 能替代 Redux 吗？** → 小应用可以；但 Context 值变化会重渲染所有消费者（没有细粒度订阅），大量高频更新或需要 DevTools/中间件时不如专用库
- **selector 和 computed 的区别？** → 目的相同（派生+缓存）；computed 由 Vue 依赖系统自动缓存，Redux 需 `createSelector` 手动做引用相等才重算
- **为什么 Redux 把副作用隔离到中间件？** → 保证进入 reducer 的永远是"描述已发生事实"的普通对象，主流程保持同步纯函数；异步失败、竞态、取消都在中间件层统一处理
