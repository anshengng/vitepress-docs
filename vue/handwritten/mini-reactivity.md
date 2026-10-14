# 手写响应式系统（完整版）

## 开篇：常见简化版有两个 bug

网上流传的手写版通常长这样，能跑通"改数据自动更新"，但面试官只要追问两个场景就会翻车：effect 嵌套、分支切换。下面逐个复现，再给出完整修复。

```typescript
let activeEffect: Function | null = null

function effect(fn: Function) {
  const effectFn = () => {
    activeEffect = effectFn
    fn()
    activeEffect = null
  }
  effectFn()
  return effectFn
}
```

## bug 1：effect 嵌套——activeEffect 被内层覆盖

### 复现

```typescript
const obj = reactive({ ok: true, text: 'hello' })
effect(() => {              // 外层 effectFn
  effect(() => {            // 内层：立即执行
    obj.text                // text 挂到内层（没错）
  })                        // 内层结束：activeEffect 被置 null（或仍是内层）
  obj.ok                    // 此刻 activeEffect 已不是外层
})
obj.ok = false              // 外层不执行：ok 的依赖没收上来
```

原因：单个全局变量承载不了嵌套。内层执行完置 null，外层后续读取收集不到依赖；不置 null 则外层后续读取会把依赖错误挂到内层头上。两种写法都错。

### 修复：effectStack 栈

```
push(outer)   → 栈：[outer]
  push(inner) → 栈：[outer, inner]
  pop(inner)  → 栈：[outer]  → activeEffect 恢复为 outer
pop(outer)    → 栈：[]
activeEffect 永远 = 栈顶（栈顶才是"正在执行"的那个）
```

## bug 2：依赖不清理——分支切换后旧依赖残留

### 复现

```typescript
const state = reactive({ ok: true, text: 'a' })
effect(() => (state.ok ? state.text : ''))   // 初次执行：收集 ok + text
state.ok = false    // 重新执行，这次只读 ok；但 text 的 Set 里仍留着这个 effect
state.text = 'x'    // 仍触发 —— 尽管返回值已经和 text 无关
```

两个危害：一是无意义触发，改无关属性也重新执行 effect；二是内存泄漏，effect 永远滞留在不再使用的依赖 Set 里。

### 修复：cleanup + 反向记录 effect.deps

每次执行前，先把自己从所有依赖 Set 里删掉，重新执行时重新收集：

```typescript
// effect 上挂 deps：记录"我被收集进了哪些 Set"
function cleanup(effectFn) {
  for (const deps of effectFn.deps) deps.delete(effectFn)
  effectFn.deps.length = 0
}
// track 时双向记录
deps.add(activeEffect)
activeEffect.deps.push(deps)   // Set 记住 effect，effect 也记住 Set
```

### 修复引出的新 bug：trigger 死循环

```typescript
const data = reactive({ count: 0 })
effect(() => data.count)
data.count++
// trigger 就地遍历 Set 的同时，effect 执行会先把自己 delete 再 add 回去
// Set 遍历规则：期间"先删后加"的条目会被再次访问 → 无限循环
const effectsToRun = new Set(deps)   // 修复：拷贝一份快照再遍历
effectsToRun.forEach(fn => fn())
```

## 完整实现（逐块讲解）

### 依赖存储：targetMap

```
targetMap: WeakMap<对象, Map<key, Set<effect>>>
  例：{ ok, text } ──→ Map: { 'ok' → Set[e1, e2], 'text' → Set[e1] }
```

WeakMap 以对象为 key 且不阻止回收：对象销毁后，依赖结构可被垃圾回收自动清理。

### track / trigger

```typescript
const targetMap = new WeakMap<object, Map<string | symbol, Set<EffectFn>>>()

function track(target: object, key: string | symbol) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let deps = depsMap.get(key)
  if (!deps) depsMap.set(key, (deps = new Set()))
  if (!deps.has(activeEffect)) {
    deps.add(activeEffect)
    activeEffect.deps.push(deps)          // 反向记录：cleanup 用
  }
}

function trigger(target: object, key: string | symbol) {
  const deps = targetMap.get(target)?.get(key)
  if (!deps) return
  const effectsToRun = new Set(deps)      // 拷贝，防 cleanup + 重收集死循环
  effectsToRun.forEach(effectFn => {
    if (effectFn === activeEffect) return // 防自触发（fn 里直接 count++ 的场景）
    effectFn.options.scheduler
      ? effectFn.options.scheduler(effectFn)  // computed/watch 靠 scheduler 接管时机
      : effectFn()
  })
}
```

### effect：栈 + cleanup

options 扩展：{ lazy: 惰性执行; scheduler: 自定义调度; onStop: 停止回调 }。

```typescript
function effect(fn: Function, options = {}) {
  const effectFn = () => {
    if (!effectFn.active) return          // stop 后不再执行
    cleanup(effectFn)                     // 1. 先清空旧依赖（修 bug 2）
    effectStack.push(effectFn)            // 2. 入栈（修 bug 1）
    activeEffect = effectFn
    try {
      return fn()                         // 3. 执行，track 用栈顶收集
    } finally {
      effectStack.pop()                   // 4. 出栈，恢复上一层
      activeEffect = effectStack[effectStack.length - 1]
    }
  }
  effectFn.deps = []                      // 反向记录的依赖 Set 列表
  effectFn.active = true
  effectFn.options = options
  if (!options.lazy) effectFn()           // computed 会用 lazy
  return effectFn
}
```

真实源码差异：Vue3 不再显式用数组栈，而是在 ReactiveEffect.run 里保存/恢复上一个 activeEffect（try/finally），语义与栈等价；依赖清理也从"每次执行前全量删除"演进为"执行前截断 deps 记录、按需重建"，思想一致。

### stop / onStop（简化）

```typescript
function stop(effectFn: EffectFn) {
  effectFn.active = false
  cleanup(effectFn)              // 从所有依赖 Set 中移除
  effectFn.options.onStop?.()     // 通知外界（如 watch 的 teardown 逻辑）
}
```

### reactive / ref

```typescript
const reactiveMap = new WeakMap()
function reactive(target: object) {
  if (typeof target !== 'object' || target === null) return target
  if (reactiveMap.has(target)) return reactiveMap.get(target)  // 同一对象只代理一次
  const proxy = new Proxy(target, {
    get(target, key, receiver) {
      const res = Reflect.get(target, key, receiver)
      track(target, key)
      if (typeof res === 'object' && res !== null) return reactive(res)  // 懒代理
      return res
    },
    set(target, key, value, receiver) {
      trigger(target, key)
      return Reflect.set(target, key, value, receiver)
    }
  })
  reactiveMap.set(target, proxy)
  return proxy
}

function ref(value: unknown) {
  return reactive({ value })    // .value 的读写即 value 属性的读写
}
```

### computed（基于完整 effect）

```typescript
function computed(getter: Function) {
  let value: unknown
  let dirty = true
  const effectFn = effect(getter, {
    lazy: true,
    scheduler() {                       // 依赖变化：只置脏 + 通知，不重算
      if (!dirty) { dirty = true; trigger(wrapper, 'value') }
    }
  })
  const wrapper = {
    get value() {
      if (dirty) { value = effectFn(); dirty = false }  // 读时才求值 + 缓存
      track(wrapper, 'value')           // 收集"谁在用我"
      return value
    }
  }
  return wrapper
}
```

依赖变化 → scheduler 置脏 + trigger 订阅者 → 订阅者重新执行读 wrapper.value → 发现脏 → 重算一次并重新缓存。这正是 Vue3 computed 的脏值缓存语义。

## 完整测试用例

```typescript
// ① 嵌套场景：验证栈修复
const obj = reactive({ ok: true, text: 'hello' })
let outerRuns = 0
effect(() => {
  effect(() => { console.log(obj.text) })
  outerRuns++
  obj.ok
})
obj.ok = false   // 修复前：外层不触发（bug）；修复后：内外层都重新执行，outerRuns = 2

// ② 分支切换：验证 cleanup 修复
const state = reactive({ ok: true, text: 'a' })
let runs = 0
effect(() => { runs++; return state.ok ? state.text : '' })  // runs = 1
state.ok = false   // runs = 2，重新执行只依赖 ok，text 依赖被 cleanup 清除
state.text = 'b'   // 修复前：runs = 3（bug）；修复后：不触发，runs 仍为 2

// ③ computed 缓存
const m = ref(1)
let calcTimes = 0
const double = computed(() => { calcTimes++; return m.value * 2 })
double.value; double.value   // calcTimes = 1（第二次命中缓存）
m.value = 2
double.value                 // calcTimes = 2（置脏后重算）
```

## 面试答法

手写响应式最容易漏的三个点：一是嵌套，单个 activeEffect 变量会在内层 effect 执行后覆盖或清空外层，必须用栈（执行前 push、执行后 pop、activeEffect 取栈顶，或源码式的保存/恢复）保证外层依赖正确收集；二是分支切换后的旧依赖残留，要给 effect 加 deps 反向记录自己所在的依赖 Set，每次执行前 cleanup 从这些 Set 删除自己再重新收集，否则改无关属性也会触发且造成内存泄漏；三是 trigger 必须把依赖 Set 拷贝成快照再遍历，因为 effect 执行时会先删后加自己，就地遍历 Set 会死循环。在此之上，computed 用 lazy effect + 脏标记 + scheduler（置脏并通知订阅者）实现缓存，watch 用 scheduler 把 job 调度进微任务队列、执行时重跑 getter 得新值——两者都依赖完整版 effect 的 options 扩展点。
