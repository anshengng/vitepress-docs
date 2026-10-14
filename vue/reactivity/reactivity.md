# 响应式系统

## 核心概念

```typescript
import { reactive, ref, computed, effect } from 'vue'

// 1. reactive — 对象响应式
const state = reactive({ count: 0 })

// 2. ref — 基本类型响应式（本质也是 reactive）
const count = ref(0)           // { value: 0 } 的 reactive

// 3. computed — 计算属性（缓存 + 懒执行）
const double = computed(() => count.value * 2)

// 4. effect — 副作用函数（自动追踪依赖）
effect(() => {
  console.log(count.value) // count 变化时自动重新执行
})
```

## 响应式原理流程

```
1. 创建 reactive/ref 对象
       ↓
2. 使用 Proxy 劫持 get/set
       ↓
3. get 时：收集依赖（track）
       ↓
4. set 时：触发更新（trigger）
       ↓
5. 重新执行 effect 函数
```

## reactive 的原理

### 核心：Proxy 代理

```typescript
// 简化版实现
function reactive(target) {
  return new Proxy(target, {
    get(target, key, receiver) {
      track(target, key)  // 收集依赖
      return Reflect.get(target, key, receiver)
    },
    set(target, key, value, receiver) {
      const result = Reflect.set(target, key, value, receiver)
      trigger(target, key) // 触发更新
      return result
    }
  })
}
```

### 使用示例

```typescript
const state = reactive({ count: 0 })

// 读取 → 触发 get → track
console.log(state.count)

// 修改 → 触发 set → trigger
state.count++
```

### 图解

```
原始对象          Proxy
{ count: 0 }  →  Proxy { count: 0 }
                       ↓
                   拦截 get/set
                       ↓
              track() / trigger()
```

## ref 的原理

### 核心：一个带 `.value` 的 reactive 对象

```typescript
// 简化版实现
function ref(value) {
  // 包装成对象，用 .value 访问
  const refObject = {
    get value() {
      track(refObject, 'value')  // 收集依赖
      return value
    },
    set value(newVal) {
      value = newVal
      trigger(refObject, 'value') // 触发更新
    }
  }
  return refObject
}
```

### 本质

```typescript
const count = ref(0)

// 实际上是
const count = {
  get value() { ... },
  set value(v) { ... }
}

// 读取
count.value  // 触发 get

// 修改
count.value = 1  // 触发 set
```

## ref vs reactive 对比

| | `ref` | `reactive` |
|---|---|---|
| 实现方式 | `get/set` 访问器属性 | `Proxy` 代理 |
| 基本类型 | ✅ 支持 | ❌ 不支持 |
| 对象 | ✅ 支持 | ✅ 支持 |
| 解构 | 需要 `.value` | 可直接解构 |

### 为什么 reactive 不能用于基本类型

```typescript
// 基本类型是值传递，不是引用
let count = 0
// 无法用 Proxy 劫持，因为没有"对象"可以代理

// ref 用 .value 包装成对象，所以可以
const count = ref(0)  // { value: 0 }
```

## effect 是什么

`effect` 是 Vue3 响应式系统的**底层 API**，业务代码中很少直接用，但它**无处不在**。

```typescript
import { effect, ref } from 'vue'

const count = ref(0)

// effect 会在内部执行一次函数
effect(() => {
  console.log(count.value) // 读取 count.value → 收集依赖
})

count.value++  // 修改 count → 触发 effect 重新执行
count.value++  // 再次触发
```

输出：`0` `1` `2`

### 为什么你没直接用过

因为 `effect` 被封装在了更高级的 API 里：

| 高级 API | 本质 |
|----------|------|
| `computed()` | `effect` + 缓存 + 懒执行 |
| `watch()` | `effect` + 调度器 + 新旧值 |
| `watchEffect()` | 就是 `effect` 的封装 |
| 模板 render | 编译后也是一个 `effect` |

### watchEffect 就是 effect

```typescript
import { watchEffect, ref } from 'vue'

const count = ref(0)

// 这个你肯定用过
watchEffect(() => {
  console.log(count.value) // 自动收集依赖，count 变化时重新执行
})
```

`watchEffect` = `effect` + 生命周期钩子集成 + 开发环境调试支持

## 底层原理

```typescript
// effect 做了什么（简化版）
function effect(fn) {
  const effectFn = () => {
    activeEffect = effectFn  // 标记当前正在执行的 effect
    fn()                      // 执行函数，触发 get
    activeEffect = null       // 清除标记
  }
  
  effectFn()  // 立即执行一次
  return effectFn
}

// reactive 的 get 里
function get(target, key) {
  track(target, key)  // 把 activeEffect 收集到依赖
}

// reactive 的 set 里
function set(target, key, value) {
  trigger(target, key) // 找到这个 key 的所有 effect，执行它们
}
```

## 依赖收集过程

```
effect 执行 fn()
    ↓
fn 读取 count.value（触发 get）
    ↓
get 里 track() 收集：这个 effect 依赖了 count
    ↓
count.value++ （触发 set）
    ↓
set 里 trigger() 找到依赖 count 的所有 effect
    ↓
重新执行这些 effect
```

## 深层响应式

### reactive 深层代理

```typescript
const state = reactive({ 
  nested: { count: 0 } 
})

// 嵌套对象也会被代理（懒代理，访问时才创建）
state.nested.count++  // 触发更新
```

实现方式：

```typescript
function reactive(target) {
  return new Proxy(target, {
    get(target, key) {
      const value = Reflect.get(target, key)
      // 如果是对象，递归代理
      if (typeof value === 'object' && value !== null) {
        return reactive(value)
      }
      return value
    }
  })
}
```

### ref 也是深层的

```typescript
const data = ref({ nested: { count: 0 } })
data.value.nested.count++  // 触发更新
```

## toRef 和 toRefs

### 问题：reactive 解构丢失响应式

```typescript
const state = reactive({ count: 0, name: 'test' })

// ❌ 解构后丢失响应式
const { count, name } = state
// count 和 name 是普通值，不是响应式的
```

### toRef — 单个属性转 ref

```typescript
import { toRef } from 'vue'

const state = reactive({ count: 0 })

// ✅ 创建一个与 state.count 同步的 ref
const countRef = toRef(state, 'count')

countRef.value++       // state.count 也会变
state.count++          // countRef.value 也会变
```

实现：

```typescript
function toRef(object, key) {
  return {
    get value() {
      return object[key]
    },
    set value(newVal) {
      object[key] = newVal
    }
  }
}
```

### toRefs — 所有属性转 ref

```typescript
import { toRefs } from 'vue'

const state = reactive({ count: 0, name: 'test' })

// ✅ 所有属性变成 ref
const { count, name } = toRefs(state)

count.value++  // state.count 也变
```

## 总结图

```
┌─────────────────────────────────────────────────┐
│                  ref(value)                     │
│  ┌───────────────────────────────────────────┐  │
│  │  {                                        │  │
│  │    get value() { track(); return value }  │  │
│  │    set value(v) { value=v; trigger() }    │  │
│  │  }                                        │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│               reactive(target)                  │
│  ┌───────────────────────────────────────────┐  │
│  │  new Proxy(target, {                      │  │
│  │    get() { track(); return value }        │  │
│  │    set() { value=new; trigger() }         │  │
│  │  })                                       │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

| API | 适用场景 |
|-----|---------|
| `ref` | 基本类型、需要整体替换的对象 |
| `reactive` | 复杂对象、不需要整体替换 |
| `toRef` | 从 reactive 中提取单个响应式属性 |
| `toRefs` | 解构 reactive 保持响应式 |
