# Vuex 为什么使用、怎么缓存（持久化）

## 为什么需要

两个考察点：① **为什么用 Vuex**——组件树深了之后 props/emit 逐层透传（prop drilling）难以维护，跨分支共享状态没有统一出口，需要集中式状态容器；② **怎么缓存/持久化**——Vuex 状态存在内存里，**刷新页面即丢失**，登录态、购物车等需要跨刷新保留的数据必须落盘到 localStorage/sessionStorage/Cookie，面试常问持久化原理和 vuex-persistedstate 插件做了什么。

## 核心要点

### 1. 为什么使用 Vuex

| 痛点（不用 Vuex） | Vuex 的解法 |
| --- | --- |
| 深层组件 props 逐层透传（prop drilling） | 任意组件直接 `store.state` / `useStore()` 取 |
| 兄弟/跨分支组件共享状态只能靠父组件中转 | 集中式 Store 作为唯一数据源 |
| 状态散落在各组件，改动来源难追踪 | 只能经 `mutations` 同步修改，变更可被 Devtools 记录回放 |
| 异步逻辑写在组件里，难以复用测试 | `actions` 统一承载异步，提交 mutation 收口 |

```
Vuex 单向数据流：

  组件 ──dispatch──► Actions(异步) ──commit──► Mutations(同步) ──修改──► State
   ▲                                                                  │
   └────────────── 响应式更新视图 ◄───── Getters(派生计算) ◄───────────┘
```

五大概念速记：**State**（唯一数据源，响应式）、**Getters**（派生计算属性，有缓存）、**Mutations**（唯一能同步改 state 的地方，`commit` 调用）、**Actions**（可异步，`dispatch` 调用）、**Modules**（分模块避免单文件膨胀）。

### 2. 缓存层级：先分清"内存态"和"持久层"

```
Vuex State ── 内存 ──────────── 最快，刷新即丢
     │  持久化（写入）
     ▼
浏览器存储层：
  localStorage  ── 永久，同源共享，约 5MB，存 token/用户信息/购物车
  sessionStorage ── 当前标签页，关页即清，适合一次性表单草稿
  Cookie        ── 4KB，随请求自动发给服务端，适合会话凭证（配合 SameSite）
```

### 3. 持久化方案与 vuex-persistedstate 原理

```
方案A 手写（核心就一个订阅）：
  store.subscribe((mutation, state) => {     // 每次 mutation 后触发
    localStorage.setItem('vuex', JSON.stringify(state))
  })
  初始化时回填：
  new Vuex.Store({ state: JSON.parse(localStorage.getItem('vuex')) || {} })

方案B 插件 vuex-persistedstate（原理相同，工程化封装）：

  ┌ store 创建 ┐──► getState() 从 storage 读快照 ──► replaceState 回填
  │            │
  │            └──► subscribe 监听 mutation ──► setState(JSON.stringify) 写回
  └ 可配置：paths: ['user','cart'] 只持久化部分模块
            storage: sessionStorage / webStorage
            rehydrated / mutator 钩子做加解密
```

```javascript
// 手写版示例（面试可现场写）
const STORAGE_KEY = 'app-vuex'
const store = new Vuex.Store({
  state: JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'), // 回填
  mutations: {
    setToken(state, token) { state.token = token },
  },
  plugins: [
    (store) => {
      store.subscribe((_, state) => {   // 变更后落盘
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      })
    },
  ],
})
```

注意：回填的 state 必须是**可序列化**数据（JSON 能表达）；函数、class 实例、响应式特殊对象不能直接存；敏感信息（完整用户对象）落盘有 XSS 泄露风险，通常只存 token。

## 面试答法

### 30 秒版本（可直接背诵）

> 用 Vuex 是为了解决组件树变大后的共享状态管理：props 逐层透传难维护，它提供集中式唯一数据源，state 响应式驱动视图，改动必须走 mutations 同步提交、异步逻辑放 actions，所有变更可被 Devtools 追踪，便于调试和解耦。但 Vuex 状态在内存里，刷新就丢，所以需要持久化：原理就是"初始化时从浏览器存储读快照回填 state + subscribe 订阅每次 mutation 把新 state 序列化写回存储"，vuex-persistedstate 插件就是这套逻辑的工程化封装，还能配置只持久化部分模块、选 localStorage 或 sessionStorage。选型上 localStorage 永久存 token/购物车，sessionStorage 关页即清，Cookie 小且随请求发送适合会话凭证。

### 深入展开

1. **先答"为什么用"**：prop drilling 的痛 → 集中管理 + 可预测变更（mutations 同步收口）+ Devtools 时间旅行调试 + 组件解耦
2. **画单向数据流图**：dispatch → actions → commit → mutations → state → view，强调"唯一数据源 + 变更可追溯"
3. **点出刷新丢失问题**：state 在内存，引出持久化需求（登录态、购物车）
4. **持久化原理**：subscribe 监听 mutation 落盘 + 初始化回填；vuex-persistedstate 的 paths/storage 配置
5. **缓存层级对比**：localStorage vs sessionStorage vs Cookie（生命周期、容量、是否随请求发送）
6. **收尾延伸**：Vue3 官方推荐 Pinia（去掉 mutations、天然 TS 推导、支持插件持久化 pinia-plugin-persistedstate），Vuex 已进维护模式

### 常见追问

- **为什么 mutations 必须同步？** → 异步提交会让 Devtools 无法把"变更"和"触发它的 mutation"对应起来，时间旅行调试失效；异步统一放 actions，await 后再 commit
- **持久化了整个 state 有什么坑？** → 体积超 localStorage 配额；回填脏数据（字段结构变了）；敏感数据明文落盘；应只持久化必要模块（paths）
- **vuex-persistedstate 什么时候回填？** → 插件在 store 创建时执行：先从 storage 读快照 replaceState，再注册 subscribe；所以刷新后首屏就是持久化数据
- **token 存 Vuex + localStorage，请求怎么带？** → 请求拦截器里 `config.headers.Authorization = 'Bearer ' + store.state.token`；刷新后靠持久化回填避免"内存空 token"
- **Pinia 和 Vuex 的区别一句话？** → Pinia 去掉 mutations、actions 同时支持同步异步、无模块样板代码、TS 推导更好、天然支持插件持久化；Vue3 推荐 Pinia
