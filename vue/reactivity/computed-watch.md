# computed 与 watch 实现原理

## computed：effect + 脏值缓存

### 核心机制

computed 的底层就是一个带特殊调度器的 effect，外加两层包装：**懒执行**（不读不算）与**缓存**（脏值检查）。

| 机制 | 说明 |
|---|---|
| 懒执行 | 创建时不执行 getter，首次读取 .value 时才 run |
| 缓存 | 结果存 _value，重复读取直接返回 |
| 脏值标记 _dirty | true 才重算；重算后置 false |
| 特殊调度器 | 依赖变化不立即重算，只置 _dirty = true 并通知订阅者 |

### 依赖变更时发生什么

```
依赖变化
    ↓
computed 的 scheduler：_dirty = true（只置脏，不重算）+ trigger 订阅该 computed 的 effect
    ↓
订阅者（组件渲染 effect）重新执行，读取 computed.value
    ↓
发现 _dirty === true → effect.run() 重算 → 缓存 → _dirty = false
    ↓
后续读取发现 _dirty === false → 直接返回缓存，不重算
```

### 链式依赖演示

```typescript
const count = ref(1)
const double = computed(() => count.value * 2)
const quadruple = computed(() => double.value * 2)

// 依赖链：quadruple → double → count
count.value = 2
// ① count 的 trigger 唤醒 double 的 effect（经调度器）
// ② double 的 scheduler：置 double._dirty = true，trigger 订阅 double 的 effect
// ③ quadruple 的 scheduler：置 quadruple._dirty = true，trigger 订阅 quadruple 的组件
// ④ 组件重新渲染读 quadruple.value → 重算 quadruple → 读 double.value → 重算 double
// 真正的计算只发生在第④步被读取时，且每个 computed 只算一次
```

### ComputedRefImpl 简化版实现

```typescript
class ComputedRefImpl {
  _value: unknown
  _dirty = true
  dep?: Set<Function>          // 订阅了"我"的 effect 集合
  effect: { run(): unknown }   // 内部：ReactiveEffect(getter, scheduler)

  constructor(getter: () => unknown) {
    this.effect = createEffect(getter, () => {
      // 调度器：依赖变了不重算，只置脏 + 通知
      if (!this._dirty) {
        this._dirty = true
        triggerRef(this)       // 让订阅我的 effect 失效并重新执行
      }
    })
  }

  get value() {
    trackRef(this)             // 收集"谁在用我"
    if (this._dirty) {
      this._dirty = false
      this._value = this.effect.run()   // 真正求值 + 收集我对上游的依赖
    }
    return this._value
  }
}
```

## watch 实现原理

### source 的三种形式

| source | 转换成的 getter | 行为 |
|---|---|---|
| ref | () => source.value | 监听 .value |
| getter 函数 | 直接使用 | 监听函数返回值 |
| reactive 对象 | () => source，并默认深度监听 | 深度监听对象全部属性 |

### deep 选项的本质：traverse

```typescript
// traverse：递归访问对象所有属性，唯一目的是触发每个属性的 get，收集全量依赖
function traverse(value: unknown, seen = new Set()) {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value
  seen.add(value)                          // 防循环引用
  for (const key of Object.keys(value)) traverse(value[key], seen)
  return value
}
```

传 reactive 对象时不用写 deep: true——内部自动 traverse；deep 也支持数字控制递归层数（deep: 1 只遍历一层，避免大对象全量遍历）。

### 新旧值的获取原理

watch 里真正执行 getter 的也是一个 effect，旧值是上一次执行保存的结果：

```
创建时   oldValue = effect.run()          跑一次 getter，存下初始值
依赖变化 → scheduler 把 job 调度进微任务队列
job 执行  newValue = effect.run()          重跑 getter 得新值
          cb(newValue, oldValue)           用保存的旧值调回调
          oldValue = newValue              滚动更新保存值
```

### 调度：job 进微任务队列

watch 的 cb 不在依赖变化时同步执行，而是被包成 job 进调度队列（与组件更新共用一套队列，Promise.then 微任务 flush），一轮事件里多次修改合并为一次回调执行。

| flush | 时机 | 场景 |
|---|---|---|
| pre（默认） | 组件更新之前 | 常规逻辑 |
| post | 组件更新之后（DOM 已更新） | 回调里要读新 DOM |
| sync | 不排队，依赖变化立即同步执行 | 少用，失去批量合并能力 |

immediate: true：创建时立即执行一次 job，此时 oldValue 为 undefined（首次没有旧值）。

### 简化版实现

```typescript
function watch(source, cb, options = {}) {
  let getter: () => unknown
  if (isRef(source)) getter = () => source.value
  else if (isReactive(source)) { getter = () => source; options.deep = true }
  else getter = source

  let oldValue: unknown
  const job = () => {
    const newValue = effect.run()
    if (options.deep || newValue !== oldValue) {   // 深度监听恒触发；浅监听比较引用
      cb(newValue, oldValue)
      oldValue = newValue
    }
  }

  // 调度器：接管执行时机；pre 模式下 queueJob 进微任务队列
  const effect = createEffect(
    () => (options.deep ? traverse(getter()) : getter()),
    () => queueJob(job)
  )

  oldValue = effect.run()
  if (options.immediate) job()
  return () => stopEffect(effect)    // 返回停止函数
}
```

## watchEffect

```typescript
const count = ref(0)

watchEffect(() => {
  console.log(count.value)   // 创建时立即执行一次；此后 count 变化重新执行
})
```

与 watch 的三点差别：

| | watchEffect | watch |
|---|---|---|
| 执行时机 | 创建时立即执行一次 | 依赖变化才执行（immediate 除外） |
| 旧值 | 无（回调没有旧值参数） | 有 |
| 依赖来源 | 函数体内自动收集 | source 显式声明 |

### onCleanup：防止请求竞态

```typescript
const keyword = ref('')

watch(keyword, async (kw, _, onCleanup) => {
  const controller = new AbortController()
  onCleanup(() => controller.abort())          // 注册清理：下次回调执行前先调用
  const res = await fetch(`/api/search?q=${kw}`, { signal: controller.signal })
  list.value = await res.json()
})
```

竞态问题：输入 "js" 触发请求 A，快速改成 "json" 触发请求 B；A 网络更慢后返回，把 B 的结果覆盖掉。onCleanup 注册的清理函数会在 job 每次重新执行前被调用，用 abort 掐掉 A，过期响应永远到不了回调里。watchEffect 的回调同样支持 onCleanup（第一个参数）。

## computed / watch / watchEffect 对比

| | computed | watch | watchEffect |
|---|---|---|---|
| 懒执行 | 读 .value 才算 | cb 懒（依赖变化才执行） | 立即执行一次 |
| 缓存 | 有（脏值检查） | 无 | 无 |
| 旧值 | 无 | 有 | 无 |
| 依赖收集 | getter 内自动 | source 显式声明 | 函数体内自动 |
| 返回值 | ref | 停止函数 | 停止函数 |
| 本质 | effect + 脏缓存 + 通知 | effect + job 调度 + 新旧值 | effect 封装 |
| 场景 | 派生数据 | 需要旧值、异步副作用 | 依赖集中在一段逻辑的副作用 |

## 面试答法

computed 的本质是一个带脏值缓存的 effect：get value 时如果 _dirty 为 true 就 run 一次求值并缓存、置回 false，否则直接返回缓存；它的调度器在依赖变化时不立即重算，只把 _dirty 置为 true 并通知订阅者，订阅者重新读取时才真正计算，所以链式依赖下每次变更每个 computed 只算一次。watch 的核心是"跑 getter 的 effect + 调度执行的 job"：source 会被归一化成 getter（ref 取 .value，reactive 对象默认深度 traverse 收集全量依赖），job 执行时重跑 getter 得到新值，旧值是上次保存的结果，再经调度器进微任务队列，具备批量合并和 pre/post/sync 三种时机。watchEffect 是 effect 的直接封装，立即执行并自动收集依赖，没有旧值概念；两者都支持 onCleanup，在回调重新执行前调用，典型用途是 abort 旧请求解决竞态。
