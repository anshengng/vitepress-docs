# Pinia 原理

## 为什么取代 Vuex

| 问题 | Vuex | Pinia |
|------|-------|-------|
| 改状态 | 必须通过 mutation 提交 | 直接改 state 或调用 action 都行 |
| 类型推导 | 依赖字符串常量，TS 支持差 | 原生 TS，自动推断 |
| 模块化 | 嵌套 modules + namespaced 繁琐 | 每个 store 独立扁平，天然隔离 |
| 组合式 API | 只能 mapState / mapActions | 就是函数与 computed，天然配合 setup |

核心一句话：**Vuex 的 mutation 是"为了 devtools 追踪而强制加的中间层"，Pinia 直接把这层去掉，靠 action 与订阅实现追踪。**

## defineStore 的两种写法

### setup 风格（推荐，贴近组合式 API）

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useCounterStore = defineStore('counter', () => {
  // state：就是 ref / reactive
  const count = ref(0)

  // getters：就是 computed
  const double = computed(() => count.value * 2)

  // actions：就是普通函数
  function increment() {
    count.value++
  }

  // 必须把所有要暴露的返回出去，未返回的不会被 store 收集
  return { count, double, increment }
})
```

### options 风格（贴近 Vuex 心智）

```typescript
export const useCounterStore = defineStore('counter', {
  state: () => ({ count: 0 }),
  getters: {
    double: (state) => state.count * 2
  },
  actions: {
    increment() {
      this.count++
    }
  }
})
```

两种写法创建出的 store 完全等价，区别只在书写方式。

## state / getters / actions 的映射

`defineStore` 内部把两种写法归一化成同一份结构：

| 概念 | 归一化产物 | 说明 |
|------|-----------|------|
| state | reactive 对象 | setup 里 ref 被 unwrap 后挂到 store 上 |
| getters | computed | 惰性求值 + 缓存，依赖不变不重算 |
| actions | 普通函数 | 通过 apply/包装挂到 store，可直接改 state |

```text
defineStore(id, setup 或 options)
    ↓
store = reactive(reactive 化的 state)
store.$$state = ...            ← 供 devtools 记录快照
getters → 定义为 computed
actions → 绑定到 store 上（包装后触发订阅）
    ↓
useStore() 返回这个 store
```

为什么 Pinia 里可以直接 `store.count++`：因为 state 本身就是 reactive 对象，**不存在"必须走 mutation 才能改"的限制**。

## 为什么天然响应式且解构安全

在 setup 风格里，state 就是 `ref`，getters 就是 `computed`，所以整个 store 由 `reactive` 包裹：

```typescript
const store = reactive({
  count: ref(0),      // ref 展开为 .value
  double: computed(() => count.value * 2),
  increment
})
```

关键点：

| 行为 | 结果 |
|------|------|
| `store.count++` | 生效，直接改到内部 ref |
| 组件里 `store.count` | 自动追踪依赖 |
| `const { count } = store` | **直接解构会丢失响应式**（ref 的值被展开成普通数字） |

解构保持响应式的正确做法：

```typescript
import { storeToRefs } from 'pinia'

const store = useCounterStore()
// storeToRefs 把 state 与 getters 变成 ref，保持响应式
const { count, double } = storeToRefs(store)
// actions 是普通函数，直接解构即可
const { increment } = store
```

`storeToRefs` 的本质：遍历 store 上所有是 ref / computed 的属性，用 `toRef` 包一层再返回，因此响应式链路不丢。

## store 单例机制

每个 Pinia 实例内部维护一个 Map 缓存已创建的 store：

```typescript
// 简化示意
class Pinia {
  _s = new Map<string, Store>()   // key 是 store id

  _createSetupStore(id, setup) {
    const existing = this._s.get(id)
    if (existing) return existing        // 命中缓存，直接复用
    const store = createStore(...)
    this._s.set(id, store)
    return store
  }
}
```

```text
useCounterStore()
    ↓ 拿到当前 app 注入的 pinia 实例
pinia._s.get('counter')
    ├── 命中 → 直接返回同一个 store（单例）
    └── 未命中 → 创建并写入 _s
```

因此同一组件树内多次调用 `useCounterStore()` 拿到的是**同一个 store 对象**，状态天然共享。应用级单例的前提是：同一个 app 上只 install 一个 pinia 实例（SSR 里每个请求要新建 pinia，避免状态串场）。

## 插件系统与持久化

```typescript
pinia.use((context) => {
  const { store, app, options } = context
  // 可以往 store 上挂东西、订阅、读取 options
  if (options.persist) { /* ... */ }
})
```

插件的典型能力：

| 能力 | 说明 |
|------|------|
| 扩展 store | 往 store 实例上挂自定义属性/方法 |
| 订阅变更 | `store.$subscribe` 监听 state 变化 |
| 监听 action | `store.$onAction` 在 action 前后做埋点 |

### 持久化插件的思路

```typescript
pinia.use(({ store, options }) => {
  const key = `pinia:${store.$id}`

  // 1. 初始化时从 localStorage 恢复
  const saved = localStorage.getItem(key)
  if (saved) store.$patch(JSON.parse(saved))

  // 2. 订阅变化写回
  store.$subscribe((_mutation, state) => {
    localStorage.setItem(key, JSON.stringify(state))
  }, { detached: true })   // detached：组件卸载后订阅仍保留
})
```

`$patch` 用于批量改 state：对象形式做浅合并，函数形式接收 state 直接改，且只触发一次订阅。

## 与 Vuex 的对比

| 维度 | Vuex | Pinia |
|------|------|--------|
| 改 state | 必须 commit mutation | 直接改 / action 均可 |
| mutation | 必备层 | 已移除 |
| state 组织 | 单一 state + 嵌套 modules | 扁平多 store，各自独立 |
| 命名空间 | 需要 namespaced: true | 每个 store 天然独立 |
| TS 支持 | 需手工声明类型，推断弱 | 自动推断，开箱即用 |
| 组合式配合 | mapState 等 mapper | 就是普通函数，直接解构 |
| 体积 | 更大 | 更小（约 1KB 级） |

## 面试答法

Pinia 取代 Vuex 的出发点是去掉冗余：Vuex 强制用 mutation 改状态，本质是为了让 devtools 能追踪变更，但写起来多一层样板，而且基于字符串常量的类型推导很弱，模块化还要嵌套加 namespaced。Pinia 把 mutation 直接删掉，改 state 和调用 action 都可以，靠 action 包装和 $subscribe 订阅来做追踪。它支持 setup 与 options 两种 defineStore 写法，内部把 state 映射成 reactive、getters 映射成 computed、actions 就是普通函数，所以整个 store 天生响应式，也就天然支持组合式 API，唯一的坑是直接解构会丢失响应式，要用 storeToRefs 才能安全解构。store 之所以是单例，是因为每个 pinia 实例内部有一个 _s 的 Map 按 id 缓存，useStore 命中了就复用同一个对象，所以状态是跨组件共享的。扩展方面通过 pinia.use 注册插件，持久化插件就是在初始化时用 $patch 恢复 localStorage，再用 $subscribe 把变更写回去。
