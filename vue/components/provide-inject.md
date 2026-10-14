# provide 与 inject

## 解决的问题

props 只能父传子，跨层级传递要逐层透传（prop drilling）：中间层组件被迫声明并转发自己根本不用的 props，耦合深、改一处要改一路。

```text
祖先 A ──props──► 中间层 B ──props──► 中间层 C ──props──► 后代 D
                  （B、C 只是搬运工，被迫声明与转发）
```

provide/inject 让祖先直接把数据「投放」进依赖树，后代在任意深度按 key 取用，中间层完全不参与。

## 基本用法

祖先组件：

```vue
<script setup>
import { provide, ref, readonly } from 'vue'

// key 可以是字符串或 Symbol（推荐 Symbol，避免命名冲突）
const ThemeKey = Symbol('theme')
const theme = ref('dark')

provide(ThemeKey, readonly(theme))    // 提供只读的响应式值
provide('appConfig', { version: '3.4' })
</script>
```

后代组件：

```vue
<script setup>
import { inject } from 'vue'

const ThemeKey = Symbol('theme')
const theme = inject(ThemeKey)                  // 无默认值，找不到返回 undefined
const locale = inject('missing', 'zh-CN')       // 提供默认值
const api = inject('api', () => createApi())    // 默认值也可以是工厂函数
</script>
```

| 形式 | 作用 |
|------|------|
| provide(key, value) | 在当前实例的 provides 上写入 |
| inject(key) | 沿 parent 链向上查找，找不到返回 undefined 并开发环境告警 |
| inject(key, default) | 找不到时返回 default |
| inject(key, () => factory()) | default 为函数时会被当作工厂调用，每次取到新对象 |

## 实现原理：沿 parent 链查找

每个组件实例在创建时就带一个 `provides` 对象；`inject` 从当前实例出发，沿 `parent` 一层层向上找，命中即返回。

```typescript
// createComponentInstance（简化）
const instance = {
  // 关键：子实例的 provides 以父实例的 provides 为原型
  provides: parent ? parent.provides : Object.create(appContext.provides),
  parent,
  // ...
}
```

```typescript
// runtime-core/src/apiInject.ts
export function provide(key, value) {
  if (!currentInstance) return
  let provides = currentInstance.provides
  const parentProvides = currentInstance.parent && currentInstance.parent.provides
  // 首次在当前实例 provide 时，才复制出自己的一层，避免污染父级
  if (parentProvides === provides) {
    provides = currentInstance.provides = Object.create(parentProvides)
  }
  provides[key] = value
}

export function inject(key, defaultValue, treatDefaultAsFactory = false) {
  const instance = currentInstance || currentRenderingInstance
  if (instance) {
    const provides =
      instance.parent == null
        ? instance.vnode.appContext && instance.vnode.appContext.provides
        : instance.parent.provides
    if (provides && key in provides) {
      return provides[key]                        // 原型链命中
    } else if (arguments.length > 1) {
      return treatDefaultAsFactory && isFunction(defaultValue)
        ? defaultValue.call(instance.proxy)        // 工厂函数
        : defaultValue
    }
  }
}
```

查找过程可视化：

```text
inject(key) in D
    │
    ▼
D.parent.provides（C 的 provides）
    ├─ 命中 → 返回
    └─ 未命中 → 沿原型链到 __proto__ = B.provides
            ├─ 命中 → 返回
            └─ 未命中 → ... 直到 A.provides
                    └─ 仍未命中 → app.provides（应用级注入）
```

关键机制：`provides` 之间用 `Object.create` 串成原型链，provide 不需要逐层复制，查找就是一次原型链属性访问（`key in provides`）。这也解释了为什么子组件能读到祖先的注入，却看不到兄弟组件的注入。

## 响应式问题

provide 本身不做响应式包装——它只是把值放进对象。下游能否响应式更新，取决于 provide 的值本身是不是响应式对象。

| provide 的值 | 下游是否响应更新 | 原因 |
|-------------|----------------|------|
| 原始值（字符串 / 数字 / 布尔） | 不会 | 值被复制进 provides，后续改祖先变量无感 |
| ref | 会 | 传下去的是同一个 ref 对象，`.value` 变化能触发 |
| reactive 对象 | 会 | 代理对象共享，属性变化能触发 |
| 普通对象内嵌 ref | 会 | 访问 `obj.count.value` 时仍走 ref 的依赖追踪 |

```vue
<!-- 推荐：provide ref / reactive，下游保持响应式 -->
<script setup>
import { provide, ref, reactive } from 'vue'

const count = ref(0)
const state = reactive({ theme: 'dark' })
provide('count', count)
provide('state', state)
// 不要 provide(count.value)：传下去的是快照，不会更新
</script>
```

需要「只读、防篡改」时用 computed 或 readonly 再 provide：

```typescript
// composables/useTheme.ts
export function useTheme() {
  const theme = ref('dark')
  provide('theme', readonly(theme))    // 下游只能读，修改由内部负责
  return { theme }
}
```

## 注意事项

| 事项 | 说明 |
|------|------|
| 不要 provide 组件实例 | 会暴露内部状态、破坏封装；需要交互时 provide 方法或事件回调 |
| key 用 Symbol | 字符串 key 在大型项目里易冲突，Symbol 保证唯一 |
| inject 只在 setup 中调用 | 依赖 `currentInstance`，放到 setup 外的异步回调会拿不到 |
| 应用级 provide | `app.provide(key, value)` 对所有组件可见，等价于全局注入 |
| 响应式要自己保证 | 传原始值等于传快照，下游不会更新 |

应用级注入：

```typescript
// main.ts
const app = createApp(App)
app.provide('api', createApi())
app.mount('#app')
```

`app.provide` 写入 `appContext.provides`，是根实例 provides 的原型，因此任何组件都能 inject 到。

## 与 Pinia 的取舍

| 维度 | provide/inject | Pinia |
|------|----------------|-------|
| 定位 | 一个祖先与后代之间的局部依赖传递 | 全局状态管理 |
| 可见范围 | 仅该祖先的子树 | 整个应用 |
| 跨组件通信 | 兄弟组件、无父子关系的组件不适用 | 任意组件可见 |
| 调试能力 | 无 devtools、无时间旅行 | devtools、可追踪、SSR 友好 |
| 响应式 | 需自己 provide 响应式值 | store 本身就是响应式 |
| 适用场景 | 主题、i18n、表单上下文、组件库上下文 | 用户信息、购物车、缓存等共享业务状态 |

结论：跨层级传「局部依赖」用 provide/inject 更轻；需要全局共享、可调试、跨模块读写时用 Pinia。

## 面试答法

provide/inject 是为了解决 props 逐层透传的问题，让祖先直接把数据投放到依赖树里，后代在任意深度取值，中间层完全不用参与。底层上每个组件实例都有一个 provides 对象，子实例的 provides 以父实例的 provides 为原型，provide 首次写入时会用 `Object.create` 复制出自己的一层，inject 就是沿 parent 链做一次原型链属性查找，所以子组件能看到祖先的注入、却看不到兄弟组件的。要注意 provide 本身不做响应式包装，传原始值等于传快照，想让下游跟随更新必须 provide ref 或 reactive 对象，或者用 readonly、computed 做只读封装，inject 的第二个参数可以给默认值、传函数时会当作工厂调用。工程上它适合传递主题、i18n、表单上下文这类局部依赖，而需要全局共享、可调试的状态用 Pinia 更合适；同时不要 provide 组件实例，key 尽量用 Symbol，应用级的 `app.provide` 会写进根 context、对所有组件可见。
