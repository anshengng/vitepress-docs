# 高频手写题进阶（二）：EventEmitter、柯里化进阶、flat、Promise 组合子

## 题目

> 手写一个 EventEmitter，支持 on/off/once/emit，once 怎么实现？maxListeners 是干什么的？发布订阅和观察者模式有什么区别？柯里化怎么支持占位符和惰性求值？手写数组扁平化，空位怎么处理？instanceof、new、call/apply/bind 的进阶写法（bind 要同时支持参数柯里化与 new 构造场景）？手写 Promise.all / race / allSettled / any，各自语义是什么？

## 为什么需要

本篇是 [js-handwriting.md](./js-handwriting.md)（基础套餐）的进阶篇，考察点从"知不知道"升级为"**写得严不严谨**"：

- `EventEmitter`：Vue 的响应式、Node 的流、前端的组件通信都建立在事件机制上，once 与 emit 的快照遍历是真正的区分度。
- `柯里化进阶`：占位符和惰性求值考察闭包收集参数的掌控力。
- `flat`：递归 / reduce / 迭代栈三种写法对应"深度、函数式、性能"三种取舍，空位处理是隐藏考点。
- `Promise 组合子`：all 的下标回填、race 的空数组行为、any 的 AggregateError，全是"背代码"和"真理解"的分水岭。

```
本篇手写题的共同骨架：

  收集/记录状态（闭包、Map、栈、计数器）──► 判断触发条件（攒够参数？全部落定？）──► 执行/结算

  写之前先想清楚这两件事，代码就不会跑偏。
```

## 核心要点

### 1. 手写 EventEmitter（on / off / once / emit）

**题目要求**：实现事件发射器，`on` 注册、`off` 移除、`once` 只触发一次、`emit` 按注册顺序触发；支持 `maxListeners` 内存泄漏告警。

```javascript
class EventEmitter {
  constructor() {
    this.events = new Map()   // 事件名 -> 监听器数组
    this.maxListeners = 10    // 同一事件监听器数量告警阈值，0 表示不限制
  }

  on(type, fn) {
    if (!this.events.has(type)) this.events.set(type, [])
    const list = this.events.get(type)
    list.push(fn)
    // 超过阈值告警：大量重复注册往往是"忘了 off"的内存泄漏信号
    if (this.maxListeners > 0 && list.length > this.maxListeners) {
      console.warn(`[EventEmitter] 事件 "${type}" 监听器超过 ${this.maxListeners} 个，可能内存泄漏`)
    }
    return this // 返回 this 支持链式调用
  }

  off(type, fn) {
    if (!fn) { this.events.delete(type); return this } // 不传 fn 清空该事件
    const list = this.events.get(type)
    if (!list) return this
    // 同时匹配原始函数和 once 包装器（包装器上记录了 raw 指回原函数）
    this.events.set(type, list.filter(f => f !== fn && f.raw !== fn))
    return this
  }

  once(type, fn) {
    const wrapper = (...args) => {
      this.off(type, wrapper) // ① 先注销，保证只触发一次
      fn.apply(this, args)    // ② 再执行：即使 fn 抛错，监听器也已移除
    }
    wrapper.raw = fn // 标记原函数，让 off(type, fn) 也能移除这个 once
    return this.on(type, wrapper)
  }

  emit(type, ...args) {
    const list = this.events.get(type)
    if (!list || list.length === 0) return false
    // 关键：遍历副本。若监听器内部调用 off/on 修改原数组，会导致漏触发或重复触发
    ;[...list].forEach(fn => fn.apply(this, args))
    return true
  }
}

// 验证
const ee = new EventEmitter()
const sayHi = (name) => console.log('hi', name)
ee.once('greet', sayHi)
ee.emit('greet', 'a') // hi a
ee.emit('greet', 'b') // 无输出，once 已注销
```

**坑点**：

- `once` 必须**先注销再执行**：反过来写，若 fn 抛异常，监听器永远留在表里，下次 emit 又触发。
- `emit` 必须遍历**快照副本**：原生 Node EventEmitter 文档明确允许监听器内调用 `removeListener`，靠的就是副本遍历。
- `off(type, fn)` 要能移除 once 注册的包装器（Node 用 `listener.listener` 属性记录原函数，本质相同）。
- `maxListeners` 只是**告警**不阻止注册；`emitter.setMaxListeners(0)` 表示不限制。
- emit 是**同步**触发监听器的，异步语义要靠监听器自己（或 `emit` 外包一层 `process.nextTick`）。

### 2. 发布订阅 vs 观察者（简要带过）

| 维度 | 观察者模式 | 发布订阅模式 |
| --- | --- | --- |
| 耦合度 | 目标（Subject）**直接持有**观察者列表并通知 | 双方只认识**中间的事件通道**，互不知情 |
| 通信方向 | 目标 → 观察者，一对一广播 | 发布者 → 通道 → 订阅者，多对多 |
| 典型实现 | Vue2 的 Dep/Watcher、DOM 事件流 | 上面的 EventEmitter、消息队列（Kafka） |

一句话：观察者里被观察者知道"我通知了谁"，发布订阅里发布者不知道谁在听。详细的六大设计模式与前端应用见主站设计模式专页，这里不展开。

### 3. 函数柯里化进阶：占位符 + 惰性求值

**题目要求**：实现通用 curry，支持占位符 `_`（`add(1, '_', 3)('_', 2)` 也能正确执行），并实现惰性版本——参数收集完不立即执行，显式空调用才触发。

```javascript
// ① 带占位符的 curry：非占位符参数攒够 fn.length 个才执行，后续参数优先填坑
function curry(fn, placeholder = '_') {
  return function base(...args) {
    const filled = args.filter(a => a !== placeholder).length // 有效参数个数
    if (filled >= fn.length) {
      return fn(...args.slice(0, fn.length)) // 多余参数截断
    }
    return (...next) => {
      let i = 0
      const merged = []
      for (const a of args) {
        // 占位符位置优先被下一批参数填补，填不上的原样保留
        merged.push(a === placeholder && i < next.length ? next[i++] : a)
      }
      while (i < next.length) merged.push(next[i++]) // 剩余参数追加到尾部
      return base(...merged)
    }
  }
}

const add = (a, b, c) => a + b + c
const cAdd = curry(add)
cAdd(1)(2)(3)            // 6
cAdd(1, '_', 3)(2)       // 6：2 填进占位符 → add(1, 2, 3)
cAdd('_', '_')(1, 2, 3)  // 6：依次填充 → add(1, 2, 3)

// ② 惰性柯里化：调用只收集参数，空调用 () 才是"执行信号"
function lazyCurry(fn) {
  let collected = []
  const base = (...args) => {
    if (args.length === 0) {
      const result = fn(...collected)
      collected = [] // 执行后重置，支持复用
      return result
    }
    collected = collected.concat(args)
    return base
  }
  return base
}

const sum = lazyCurry((...nums) => nums.reduce((a, b) => a + b, 0))
sum(1)(2, 3)(4)   // 只收集，不计算
sum(1, 2, 3, 4)() // 10：空调用才触发求值
```

**坑点**：

- `fn.length` 对**带默认值 / 剩余参数**的函数不可靠（默认值及其后参数不计入 length，剩余参数不计），lazyCurry 用"空调用"终止正是为了绕开 arity 判断。
- 占位符若用 `undefined` 会与"真的传了 undefined"冲突，所以惯用独立符号值（`_` 字符串或 `Symbol`）。
- 惰性版的 `collected` 放在闭包里，**多个实例互不干扰**，但同一个实例连续两次 `sum(...)()` 之间要重置，否则参数累积。
- 柯里化返回的函数丢失 this：`base` 若用箭头函数定义则无法转发调用者的 this，严格场景用 `fn.apply(this, args)`。

### 4. 数组扁平化 flat（递归 / reduce / 迭代栈 + 空位）

**题目要求**：实现 `flat(arr, depth)`，支持指定深度（depth 为 Infinity 时全平），并说明对**空位**（`[1, , 2]`）的处理。

```javascript
// ① 纯递归：for...of 会把空位读成 undefined（迭代器协议不跳过空位）
function flatRecursive(arr, depth = 1) {
  const res = []
  for (const item of arr) {
    if (Array.isArray(item) && depth > 0) res.push(...flatRecursive(item, depth - 1))
    else res.push(item)
  }
  return res
}

// ② reduce 版：一行流，concat 遇数组自动摊一层，配合递归控制深度
const flatReduce = (arr, depth = 1) =>
  depth > 0
    ? arr.reduce((acc, item) => acc.concat(Array.isArray(item) ? flatReduce(item, depth - 1) : item), [])
    : arr.slice()

// ③ 迭代栈：无递归深度限制，适合超大/超深数组（默认全平，等价 depth = Infinity）
function flatStack(arr) {
  const stack = arr.slice().reverse() // 反转后 pop 出来的顺序与原数组一致
  const res = []
  while (stack.length) {
    const item = stack.pop()
    if (Array.isArray(item)) stack.push(...item.slice().reverse())
    else res.push(item)
  }
  return res
}

flatRecursive([1, [2, [3, [4]]]], 2) // [1, 2, 3, [4]]
flatStack([1, [2, [3, [4]]]])        // [1, 2, 3, 4]
```

| 写法 | 时间 | 额外空间 | 特点 |
| --- | --- | --- | --- |
| 递归 | O(n) | O(n) + 调用栈 O(深度) | 最直观，深度过大爆栈 |
| reduce | O(n) | O(n)，concat 反复拷贝 | 函数式一行流 |
| 迭代栈 | O(n) | O(n) | 无爆栈风险，天然支持无限深度 |

**坑点（空位处理）**：

- 原生 `[1, , 2].flat()` 的结果是 `[1, 2]`——**空位被直接丢弃**，不会变成 undefined。
- 但 `for...of` / 展开 / `concat` 都会把空位**读成 undefined**，上面三种手写实现若不做处理会输出 `[1, undefined, 2]`；要严格对齐原生语义，遍历时用 `i in arr` 判断跳过空位。
- `forEach` 会**跳过**空位，用它收集反而"碰巧"和原生一致，但要能说清原因。
- 递归版若数组自引用（`a.push(a)`）会死循环，原生 flat 不会——可提一句 WeakSet 防环是加分项。

### 5. 手写 instanceof（含 Symbol.hasInstance 劫持）

**题目要求**：实现 instanceof，并支持 `Symbol.hasInstance` 钩子优先。

```javascript
function myInstanceof(left, right) {
  if (typeof right !== 'function') {
    throw new TypeError('Right-hand side of instanceof is not callable')
  }
  // ① 钩子优先：right 自定义了 hasInstance 就完全交给它判断
  const hook = right[Symbol.hasInstance]
  if (hook) return !!Reflect.apply(hook, right, [left])
  // ② 默认逻辑：沿 left 的原型链找 right.prototype
  let proto = Object.getPrototypeOf(left)
  const target = right.prototype
  while (proto !== null) {
    if (proto === target) return true
    proto = Object.getPrototypeOf(proto)
  }
  return false
}

class Foo { static [Symbol.hasInstance]() { return false } }
myInstanceof(new Foo(), Foo) // false：钩子接管了判断
```

**坑点**：

- 原始值左操作数：`'a' instanceof String` 为 false（基本类型没有原型链包装），`Object.getPrototypeOf('a')` 返回 String.prototype 才是 true 的来源，手写版按规范对原始值直接走原型链即可。
- 跨 realm 失效：iframe 里创建的数组 `instanceof` 主环境的 Array 为 false（两个 Array.prototype 不是同一个引用），此时用 `Object.prototype.toString.call` 或鸭子类型。
- `class Foo {}` 的 hasInstance 默认是 `non-writable` 静态方法，自定义时直接 `static [Symbol.hasInstance](x)` 覆盖即可。

### 6. 手写 new（分四步）

**题目要求**：实现 `myNew`，分步体现：创建对象 → 原型链接 → 执行构造 → 返回值判断。

```javascript
function myNew(Ctor, ...args) {
  if (typeof Ctor !== 'function') throw new TypeError('Ctor 必须是函数')

  // ① 创建对象 + ② 原型链接：Object.create 一步完成
  const obj = Object.create(Ctor.prototype)

  // ③ 执行构造：以新对象为 this 调用构造函数
  const result = Reflect.apply(Ctor, obj, args)

  // ④ 返回值判断：构造显式返回"对象或函数"才生效，否则忽略返回 obj
  if (result !== null && (typeof result === 'object' || typeof result === 'function')) {
    return result
  }
  return obj
}

function Person(name) { this.name = name }
Person.prototype.say = function () { return this.name }
const p = myNew(Person, 'Tom')
p instanceof Person // true：p 的原型链上确实有 Person.prototype
```

**坑点**：

- 第 ④ 步是本题全部区分度：`return 1` / `return 'a'` / 无返回 → 被忽略；`return {}` → 生效且**原型链随之更换**（`myNew(Foo) instanceof Foo` 变 false）。
- 用 `new.target` 可以区分函数是否被 new 调用；箭头函数没有 `[[Construct]]`，new 会直接 TypeError。
- 生成器函数（`function*`）也不能 new。
- `Object.create(Ctor.prototype)` 与 `new Ctor()` 的差异：前者不执行构造体，只搭骨架——这正是分步拆解想让你展示的机制。

### 7. 手写 call / apply / bind（bind 支持参数柯里化 + 构造场景）

**题目要求**：三个都手写；bind 返回的函数要能**分批喂参**（柯里化），且被 `new` 调用时 this 指向新实例。

```javascript
Function.prototype.myCall = function (context = globalThis, ...args) {
  const key = Symbol('fn')
  context[key] = this // this 即被调用的函数
  const result = context[key](...args)
  delete context[key]
  return result
}

Function.prototype.myApply = function (context = globalThis, argsList = []) {
  const key = Symbol('fn')
  context[key] = this
  const result = context[key](...argsList)
  delete context[key]
  return result
}

Function.prototype.myBind = function (context, ...outerArgs) {
  const fn = this
  function bound(...innerArgs) {
    // 参数柯里化：bind 预置参数 + 调用时参数，按顺序拼接
    const allArgs = outerArgs.concat(innerArgs)
    // 构造场景：new bound() 时 this 必须是新实例，忽略绑定的 context
    if (new.target === bound) {
      return Reflect.apply(fn, this, allArgs)
    }
    return Reflect.apply(fn, context, allArgs)
  }
  // 桥接原型：new bound() 的实例要能访问 fn.prototype 上的方法
  bound.prototype = Object.create(fn.prototype)
  return bound
}

// 验证
function log(a, b, c) { return [this.tag, a, b, c] }
log.prototype.tag = 'proto'
const partial = log.bind({ tag: 'ctx' }, 1) // 预置第一个参数
partial(2, 3)      // ['ctx', 1, 2, 3]：柯里化拼参
new partial(2, 3)  // ['proto', 1, 2, 3]：this 是新实例，tag 沿原型链从 log.prototype 继承

function Point(x, y) { this.x = x; this.y = y }
Point.prototype.norm = function () { return Math.hypot(this.x, this.y) }
const P3 = Point.myBind(null)
const pt = new P3(3, 4)
pt instanceof Point // true：原型桥接生效
pt.norm()           // 5：能访问原函数 prototype 上的方法
```

**坑点**：

- `bound.prototype = Object.create(fn.prototype)` 不能漏：`new bound()` 读的是 `bound.prototype`，不桥接则原函数原型上的方法全丢。
- 原生 bind 的 `name` 是 `"bound foo"`，`length` 是原 length 减去已预置参数数——手写版可顺带补上，是加分项。
- 对 bind 结果再 bind：this 永远是**第一次**绑定的 context（bound 内部 new.target 判断只看直接调用者），但参数会继续累积。
- 箭头函数没有 prototype，bind 它语法不报错但 this 不变——能主动指出这点说明理解到位。

### 8. Promise 系列手写：all / race / allSettled / any

**题目要求**：基于原生 Promise 手写四个组合子，语义与原生一致。

| 组合子 | 何时 fulfilled | 何时 rejected | 空数组输入 | 结果顺序 |
| --- | --- | --- | --- | --- |
| all | **全部**成功 | 任意一个失败（快速失败） | 立即成功 `[]` | 与输入一致（非完成顺序） |
| race | 第一个落定的成功 | 第一个落定的失败 | **永不结算**（挂死） | 单值 |
| allSettled | 永远成功 | 永不失败 | 立即成功 `[]` | 与输入一致，元素为状态对象 |
| any | 第一个成功 | **全部**失败（AggregateError） | 立即失败（AggregateError） | 单值 |

```javascript
// ① all：下标回填保证顺序，计数器判断"全部落定"
function promiseAll(promises) {
  return new Promise((resolve, reject) => {
    const items = Array.from(promises)
    if (items.length === 0) return resolve([])
    const results = new Array(items.length)
    let remaining = items.length
    items.forEach((p, i) => {
      Promise.resolve(p).then( // Promise.resolve 包装：兼容非 Promise / thenable
        value => {
          results[i] = value   // 关键：按下标写，不是 push——push 会变成完成顺序
          if (--remaining === 0) resolve(results)
        },
        reject // 任意一个失败立即整体失败（后续 resolve 因状态已锁被忽略）
      )
    })
  })
}

// ② race：谁先结算谁赢，空数组不挂任何处理器 → 永不结算（与原生一致）
function promiseRace(promises) {
  return new Promise((resolve, reject) => {
    Array.from(promises).forEach(p => Promise.resolve(p).then(resolve, reject))
  })
}

// ③ allSettled：先把每个 promise "洗成" 永远成功，再交给 all
function promiseAllSettled(promises) {
  return promiseAll(
    Array.from(promises).map(p =>
      Promise.resolve(p).then(
        value => ({ status: 'fulfilled', value }),
        reason => ({ status: 'rejected', reason })
      )
    )
  )
}

// ④ any：第一个成功就赢；全部失败才输，错误按输入下标收进 AggregateError
function promiseAny(promises) {
  return new Promise((resolve, reject) => {
    const items = Array.from(promises)
    if (items.length === 0) return reject(new AggregateError([], 'All promises were rejected'))
    let remaining = items.length
    const errors = new Array(items.length)
    items.forEach((p, i) => {
      Promise.resolve(p).then(resolve, err => {
        errors[i] = err
        if (--remaining === 0) reject(new AggregateError(errors, 'All promises were rejected'))
      })
    })
  })
}
```

**坑点**：

- `results[i] = value` vs `push`：push 得到的是**完成顺序**，原生 all 保证**输入顺序**——这是最高频的翻车点。
- all 的"快速失败"**不取消**其余 pending 的 promise，它们照常执行，只是结果被忽略；需要取消要自己配 AbortController。
- race 传空数组返回的 promise 永远 pending，面试问"为什么"要能答：没有任何 then 处理器被注册。
- any 依赖 `AggregateError`（ES2021），老环境要 polyfill；空数组**立即 reject** 而不是永不结算，与 race 相反。
- 四个实现全部用 `Promise.resolve(p)` 包装，兼容 thenable（鸭子类型的 promise）和原始值。

## 面试答法

### 30 秒版本

> 手写题的通用应答套路是三步：**先说思路再写码，写完主动讲边界和复杂度**。开口先报数据结构（"用 Map 存事件名到监听器数组"、"用计数器 + 下标回填"），确认思路没问题再动手；写的过程边写边点关键行；收尾主动补边界——once 先注销再执行、emit 遍历副本、all 按下标回填不是 push、race 空数组永不结算。这样即使代码有小瑕疵，展示出的工程严谨性也足够过关。

### 深入展开

1. **EventEmitter**：Map 存表 → on 追加并告警 → once 用 wrapper + raw 标记 → emit 快照遍历；maxListeners 只告警不拦截
2. **发布订阅 vs 观察者**：一句话区分"目标直接通知"与"经中间通道解耦"，细节留给设计模式页
3. **柯里化**：非占位符计数决定执行时机，占位符位置优先被后续参数填补；惰性版用空调用做执行信号，绕开 fn.length 不可靠问题
4. **flat**：递归看深度、reduce 一行流、栈防爆栈；空位原生是丢弃、手写默认读成 undefined，用 `i in arr` 对齐
5. **instanceof**：hasInstance 钩子优先，否则沿原型链找 right.prototype；点跨 realm 失效
6. **new**：四步拆解，重点在第④步返回值判断（对象/函数生效，原始值忽略）
7. **bind**：outerArgs.concat(innerArgs) 实现参数柯里化，new.target 判断构造场景，prototype 桥接保 instanceof
8. **Promise 组合子**：先报语义表再写码；all 下标回填、race 空挂死、allSettled 洗成永远成功复用 all、any 配 AggregateError

### 常见追问

- **once 为什么先注销再执行 fn？** → 反过来写，fn 抛异常时注销逻辑执行不到，监听器残留导致重复触发；先注销保证"至多一次"。
- **emit 为什么遍历副本？** → 监听器内部可能 off 自己或别人，直接遍历原数组会因下标错位漏触发；原生 Node 同样如此。
- **Promise.all 一个失败会取消其他的吗？** → 不会，其余照常执行完毕，只是结果被忽略；要真取消需 AbortController 或封装 cancel 逻辑。
- **Promise.race 传空数组什么结果？** → 返回的 promise 永不结算，因为没有任何处理器被注册；对比 any 空数组是立即 reject。
- **allSettled 能基于 all 实现吗？** → 能，先把每个 promise 映射成永远 fulfilled 的状态对象，再交给 all，这正是手写版的写法。
- **AggregateError 是什么？** → ES2021 引入，errors 属性收集所有失败原因，any 全败时抛出；老环境需 polyfill。
- **curry 后怎么拿到原函数长度？** → `fn.length` 只统计首个默认值前的形参，含默认值/剩余参数时不可靠，惰性柯里化用显式终止信号替代。
- **flat 的 depth 传 0 什么行为？** → 返回浅拷贝（`slice()`），一层都不平；传 Infinity 全平到最深层。
- **bind 一个箭头函数会怎样？** → 不报错但无效：箭头函数 this 由词法作用域决定且没有 prototype，bind 改变不了它。
- **手写题被指出 bug 怎么办？** → 别慌，承认边界漏了，现场补：面试官考察的是"发现边界 → 修复"的思维过程，不是完美背诵。
