# 组合式 API 与逻辑复用

## 从 mixins 到 composables 的演进

Options API 时代复用逻辑的主要手段是 `mixins`，但它有几个硬伤：

| 问题 | mixins | 组合式函数 |
|------|--------|-----------|
| 来源不清晰 | 属性来自哪个 mixin 得靠翻源码 | 函数调用点即来源，显式 |
| 命名冲突 | 多个 mixin 同名属性后者覆盖前者，静默 | 变量名自己控制，冲突可见 |
| 复用粒度 | 只能整块复用选项 | 可只复用一段逻辑 |
| 数据来源链 | this 上隐式合并，难追踪 | 返回值显式声明 |
| 类型推导 | TS 下 this 类型脆弱 | 函数返回值类型清晰 |

```text
mixins：隐式合并到 this
      this.data / this.methods 来源不可见，冲突难查
    ↓
composables：显式返回
      const { x, y } = useXxx()  ← 用什么都看得见
```

## 什么是组合式函数

组合式函数（composable）的定义很简单：**一个利用响应式 API 封装有状态逻辑的普通函数**。约定用 `use` 前缀命名。

核心特征：

| 特征 | 说明 |
|------|------|
| 是普通函数 | 不是类、不是特殊 API，随时可调用 |
| 有状态 | 内部持有 ref / reactive，多次调用互不干扰 |
| 返回响应式 | 返回 ref / computed / 函数，交给调用方 |
| 在 setup 同步期调用 | 内部若注册生命周期钩子则必须同步调用 |

```typescript
// useMouse：封装鼠标坐标
import { ref, onMounted, onUnmounted } from 'vue'

export function useMouse() {
  // 内部状态：每个调用者拿到独立的一份
  const x = ref(0)
  const y = ref(0)

  function update(event: MouseEvent) {
    x.value = event.pageX
    y.value = event.pageY
  }

  onMounted(() => window.addEventListener('mousemove', update))
  onUnmounted(() => window.removeEventListener('mousemove', update))

  return { x, y }
}
```

在组件中使用，来源一目了然：

```typescript
const { x, y } = useMouse()
```

## 响应式 API 在组合式函数里的配合

| API | 在 composable 中的典型职责 |
|------|--------------------------|
| ref | 承载单个可变状态（可解构传递） |
| reactive | 承载一组相关状态对象 |
| computed | 由状态派生的只读结果 |
| watch | 侦听状态变化引发副作用（可异步、可精确控制） |
| watchEffect | 自动收集依赖，立即执行，适合聚合副作用 |

```typescript
import { ref, computed, watch, watchEffect } from 'vue'

export function useTodos() {
  const todos = ref<{ text: string; done: boolean }[]>([])
  // computed：派生未完成数量
  const remaining = computed(() => todos.value.filter(t => !t.done).length)

  // watch：只有 todos 变化时才写日志
  watch(todos, (list) => console.log('变化后长度', list.length), { deep: true })

  // watchEffect：自动追踪依赖，立即执行一次
  watchEffect(() => {
    localStorage.setItem('todos', JSON.stringify(todos.value))
  })

  function add(text: string) {
    todos.value.push({ text, done: false })
  }

  return { todos, remaining, add }
}
```

选择原则：

```text
需要知道"变化前后的值"、需要精确控制时机 → watch
只需在依赖变化后重新执行一段副作用         → watchEffect
```

## effectScope：批量收集 effect

`watch` / `computed` / `watchEffect` 创建的响应式副作用都绑定在一个 scope 上。`effectScope` 允许**把一组 effect 收集到同一个作用域，之后一次性停止**。

```typescript
import { effectScope, ref, computed, watch } from 'vue'

// 创建一个游离作用域
const scope = effectScope()

scope.run(() => {
  const count = ref(0)
  const double = computed(() => count.value * 2)
  watch(count, () => console.log('count 变了'))
  watch(double, () => console.log('double 变了'))
  // 以上三个 effect 都归属于 scope
})

// 一次性停掉作用域内所有 effect
scope.stop()
```

内部用 `getCurrentScope()` / `onScopeDispose()` 在 composable 里做清理：

```typescript
export function useFeature() {
  const scope = effectScope()
  const state = scope.run(() => {
    const data = ref(null)
    watchEffect(() => { /* 拉取数据 */ })
    return { data }
  })
  // 外部可选择 stop，全部 effect 一起销毁
  return { ...state!, stop: () => scope.stop() }
}
```

组件内的 effect（setup 中创建的那些）会挂到一个隐式的组件 scope 上，**组件卸载时自动全部停止**——这正是 effectScope 的默认应用。它对外的重要性在于：独立发布的库、或需要反复创建/销毁大批响应式副作用的场景（如大表格列、批量图表），可以直接用 effectScope 包住，避免为每个 effect 单独管理生命周期。

## 生命周期钩子必须在同步阶段注册

组合式 API 的生命周期注册依赖一个"当前活跃实例"的全局变量。执行 `setup` 时这个变量指向当前组件，setup 执行完就被清空。

```typescript
export function useInterval(callback: () => void, ms: number) {
  let timer: number
  // 必须在 setup 同步阶段调用 onMounted，才能绑定到当前实例
  onMounted(() => { timer = setInterval(callback, ms) })
  onUnmounted(() => clearInterval(timer))
}
```

错误用法：

```typescript
export function useInterval(callback: () => void, ms: number) {
  // 错误：异步/事件回调里调用时，已脱离 setup 上下文，钩子不会被注册
  setTimeout(() => {
    onMounted(() => { /* 报错或静默失效 */ })
  }, 0)
}
```

```text
setup 同步执行期间  → currentInstance 存在 → onMounted 可注册
setup 执行完毕     → currentInstance 置空 → 再调用 onMounted 无效
```

除非该 composable 显式接收一个 effectScope，在 scope 内注册。

## 与 Options API 混用注意点

| 场景 | 说明 |
|------|------|
| setup 中可访问 this | 不要用，setup 的 this 是 undefined（组合式函数同理） |
| setup 与 data 同名 | setup 返回值优先，但应避免混淆 |
| Options 钩子与组合式钩子 | 同名钩子都会执行，Options 的先生效 |
| 复用方式 | 两者可在同一组件内共存，但逻辑尽量收敛到组合式函数 |

```vue
<script>
import { ref } from 'vue'
export default {
  setup() {
    const count = ref(0)
    // 这里不拿 this，直接返回响应式状态给模板
    return { count }
  },
  data() {
    return { message: 'hello' }
  },
  mounted() {
    // Options 的 mounted 会先于 setup 中注册的 onMounted
  }
}
</script>
```

## 面试答法

组合式 API 的复用载体是组合式函数，也就是一个用响应式 API 封装有状态逻辑的普通函数，约定用 use 前缀命名。它相对 mixins 的优势在于来源清晰、不会隐式命名冲突、复用粒度更细、类型推导也更稳，因为它用显式返回值代替了往 this 上隐式合并。内部通常用 ref 承载状态、computed 派生结果、watch 或 watchEffect 处理副作用，选择上需要在变化前后取值或精确控制时机就用 watch，只需依赖变化后重跑副作用就用 watchEffect。effectScope 的作用是把一组响应式 effect 收集到一个作用域里，之后可以一次性 stop，组件内的 effect 会挂到隐式的组件作用域上随卸载自动清理，而独立库或大量批量副作用场景就适合自己创建 scope 来集中管理。需要注意生命周期钩子依赖当前活跃实例，必须在 setup 同步阶段调用才有效，异步回调里注册会失效。跟 Options API 混用时 setup 里没有 this，同名钩子会都执行且 Options 的先生效，逻辑应尽量收敛到组合式函数里。
