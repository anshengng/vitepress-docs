# Vue2 vs Vue3 响应式原理对比

## Vue2 的实现：Object.defineProperty 逐属性劫持

### 核心实现

```typescript
// src/core/observer/index.js（简化）
function defineReactive(data, key, val) {
  const dep = new Dep()               // 每个属性对应一个 dep（依赖集合）
  let childOb = observe(val)          // 属性值是对象则递归观测

  Object.defineProperty(data, key, {
    enumerable: true,
    configurable: true,
    get() {
      if (Dep.target) dep.depend()    // get 时收集依赖（当前正在运行的 Watcher）
      return val
    },
    set(newVal) {
      if (newVal === val) return
      val = newVal
      childOb = observe(newVal)       // 新值是对象也要递归观测
      dep.notify()                    // 通知所有依赖该属性的 Watcher 更新
    }
  })
}
```

`defineProperty` 只能对**已存在的属性**定义 getter/setter，所以 Vue2 必须在初始化时先递归遍历整个 data，把每个属性都执行一遍 defineReactive。

### 初始化时递归 observe 所有层级

```typescript
class Observer {
  constructor(value) {
    if (Array.isArray(value)) {
      value.__proto__ = arrayMethods   // 数组：改走重写原型（见缺陷二）
      this.observeArray(value)
    } else {
      this.walk(value)
    }
  }
  walk(obj) {
    // 对象：遍历自身 key，逐个劫持
    for (const key of Object.keys(obj)) defineReactive(obj, key)
  }
  observeArray(arr) {
    // 数组元素是对象也要递归
    for (const item of arr) observe(item)
  }
}
```

```
new Observer(data)
    ↓ walk
defineReactive(data, 'a') → observe(data.a) → walk → defineReactive(a, 'x') → ...
defineReactive(data, 'b') → observe(data.b) → ...
    ↓
不论 data 多深，初始化时一次性递归到最深层，全部劫持完毕
```

## Vue2 的三个缺陷

### 缺陷一：新增 / 删除属性监听不到

劫持发生在初始化阶段，之后新增的属性没有经过 defineReactive，自然没有 getter/setter：

```typescript
this.data.newKey = 1    // 不触发更新：newKey 没有被劫持
delete this.data.a      // 不触发更新
```

补救方案：$set / $delete，本质是"手动补一次劫持再通知"：

```typescript
// Vue.prototype.$set（简化）
function set(target, key, val) {
  if (Array.isArray(target)) return target.splice(key, 1, val) // 数组：借 splice 触发
  if (key in target) { target[key] = val; return val }          // 已有属性：本身已被劫持
  defineReactive(target, key, val)   // 新属性：手动补劫持
  target.__ob__.dep.notify()         // 手动通知
  return val
}
```

### 缺陷二：数组下标赋值与 length 修改监听不到

两个事实（都源于 defineProperty 的能力边界）：

```typescript
arr[0] = 1        // 不触发：给不存在的 key 赋值，没有 setter 可拦
arr.length = 0    // 不触发：length 无法被 defineReactive 劫持
arr.push(1)       // 不触发：push 内部改下标和 length，Vue 看不见
```

Vue2 的 hack：**重写 7 个变更方法**，在原型链上插一层：

```typescript
const arrayMethods = Object.create(Array.prototype)
;['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'].forEach(method => {
  const original = Array.prototype[method]
  def(arrayMethods, method, function (...args) {
    const result = original.apply(this, args)   // 1. 先调原生，保证行为一致
    const ob = this.__ob__
    let inserted
    switch (method) {
      case 'push': case 'unshift': inserted = args; break
      case 'splice': inserted = args.slice(2); break
    }
    if (inserted) ob.observeArray(inserted)     // 2. 新插入的元素补递归观测
    ob.dep.notify()                             // 3. 手动通知更新
    return result
  })
})
```

挂载方式：支持 `__proto__` 时直接 `value.__proto__ = arrayMethods`；不支持则把 7 个方法逐个定义到数组实例上。所以 Vue2 数组的响应式依赖数组上挂着的 `__ob__`（Observer 实例），仅这 7 个方法能触发更新，直接用下标赋值仍然不行。

### 缺陷三：深层递归初始化开销大

初始化时不论数据是否被用到，都要递归劫持到最深层：data 越大越深，首屏越慢；纯展示的大列表、静态配置全部白白建立 getter/setter。

## Vue3 的实现：Proxy 代理整个对象

### 核心实现

```typescript
// @vue/reactivity（简化）
function reactive(target) {
  return new Proxy(target, {
    get(target, key, receiver) {
      track(target, key)                          // 读：收集依赖
      const res = Reflect.get(target, key, receiver)
      if (typeof res === 'object' && res !== null) {
        return reactive(res)                       // 懒代理：用到才递归
      }
      return res
    },
    set(target, key, value, receiver) {
      const res = Reflect.set(target, key, value, receiver)
      trigger(target, key)                         // 写：触发更新
      return res
    }
  })
}
```

关键差别：Vue2 劫持的是"一个个属性"，Vue3 代理的是"整个对象的读写操作本身"。属性是新增还是删除、下标还是 length，Proxy 都能拦截，不再需要逐属性预先定义。

### 常用拦截器

| 拦截器 | 对应操作 | 响应式用途 |
|---|---|---|
| get | obj.key | track：依赖收集 |
| set | obj.key = v | trigger：触发更新 |
| has | 'key' in obj | track：以 HAS 类型收集该 key 的依赖 |
| deleteProperty | delete obj.key | trigger：触发删除类型的更新 |
| ownKeys | for...in / Object.keys | track：关联 ITERATE_KEY |

## Proxy 的优势

```
Vue2：new Observer(data) → 初始化时递归全部层级（不管用不用）
Vue3：reactive(data)    → 只建一层 Proxy（O(1)）
        ↓
      get 到子对象 → reactive(child) 建下一层 → 用到哪层建哪层（懒代理）
```

| 能力 | Vue2 defineProperty | Vue3 Proxy |
|---|---|---|
| 新增 / 删除属性 | 监听不到，需 $set / $delete | deleteProperty / ownKeys 拦截，原生支持 |
| 数组下标 / length | 监听不到，靠重写 7 个方法 | set / get 直接拦截，原生支持 |
| Map / Set | 不支持 | 原生支持（方法重写，见下文） |
| 深层对象 | 初始化时一次性递归 | 懒代理，访问到才建 |
| 劫持粒度 | 属性级（每个属性一个 Dep） | 对象级（一个 Proxy 管全部操作） |

## Proxy 也做不到的：原始类型

```typescript
const n = 1
reactive(n)   // 做不到：Proxy 只能代理对象
```

原始类型按值传递，无法被代理劫持其读写。所以 Vue3 保留了 ref 的设计：把值包进 `{ value }` 对象，劫持 value 属性的读写，模板中自动解包。Vue2 同样无法代理原始类型，data 里的原始值也是靠"宿主对象属性级劫持"实现的。

## Vue3 数组与 Map/Set 的响应式

数组：

- 下标赋值 `arr[0] = 1`、`arr.length = 0` 直接被 set 拦截，原生支持
- 迭代操作（for...of、展开、keys/values 等）会 track 与迭代相关联的键（数组场景关联 length），保证增删后依赖迭代的副作用能更新
- push/pop 等会改 length 的方法做了方法级拦截优化：执行前暂停对 length 的追踪，执行后只 trigger 一次，避免一次 push 触发多轮更新

Map/Set：

Proxy 只能拦 `map.get` 这个函数属性的读取，拦不住方法调用的内部过程，所以 Vue3 重写了常用方法（instrumentations）：get / has / set / add / delete / clear / forEach / keys / values / entries 等。

```
map.get(key)   → track(key)                        收集 key 的依赖
map.set(k, v)  → k 已有则 trigger SET，没有则 ADD
map.delete(k)  → k 存在则 trigger DELETE
forEach / 迭代 → track ITERATE_KEY（与整体结构变更关联）
```

## 对比总结

| 维度 | Vue2 | Vue3 |
|---|---|---|
| 核心原理 | Object.defineProperty 逐属性劫持 | Proxy 代理整个对象 |
| 初始化 | new Observer 递归全部层级，一次性开销 | 懒代理，访问到才递归 |
| 新增 / 删除属性 | 监听不到，$set / $delete 补救 | 原生支持 |
| 数组 | 下标 / length 不行，重写 7 个方法 | 原生支持 + 方法拦截优化 |
| Map / Set | 不支持 | 原生支持 |
| 原始类型 | 不支持（靠宿主属性劫持） | 不支持，由 ref 包装解决 |
| 依赖存储 | 属性 Dep + Watcher 订阅 | targetMap：WeakMap → Map → Set |
| 兼容性 | IE9+ | 不支持 IE（Proxy 无法 polyfill） |

## 面试答法

Vue2 用 Object.defineProperty 在初始化时递归劫持 data 的每个属性，getter 收集 Watcher、setter 通知 Watcher 更新；它有三个缺陷：新增和删除属性监听不到，只能用 $set/$delete 手动补救；数组下标和 length 修改监听不到，只能重写 push 等 7 个变更方法借道通知；初始化必须递归到最深层，数据量大时开销高。Vue3 改用 Proxy 代理整个对象，get/set/has/deleteProperty/ownKeys 等拦截器天然覆盖新增删除属性、数组下标、length 甚至 Map/Set，同时采用懒代理——只有访问到子对象才递归创建代理，初始化成本从一次性全量变成按需增量。但 Proxy 依然代理不了原始类型，所以 Vue3 保留了 ref，把原始值包进对象再劫持 .value 的读写。依赖收集结构也从"属性 Dep + Watcher"演进为 targetMap（WeakMap→Map→Set）加 activeEffect，WeakMap 让对象销毁后依赖可被自动回收。
