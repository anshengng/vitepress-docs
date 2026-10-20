# JS 高频手写题：call/apply/bind、new、instanceof、柯里化

## 题目

> 能手写 call、apply、bind 吗？bind 返回的函数被 new 调用时怎么处理 this？手写一个 new 操作符，它内部做了哪几步？instanceof 的原理是什么，Symbol.hasInstance 能改变判断结果吗？什么是柯里化，如何实现一个通用的 curry 函数？

## 为什么需要

这几道题是手写题里的"基本功套餐"，考察的不是背代码，而是你对 **this 绑定规则、原型链、函数式编程**这三块底层机制的理解是否成体系：

- `call/apply/bind`：this 不会凭空来，本质是"**把函数挂到对象上再调用**"这一条规则的三种包装。
- `new`：把"创建对象 → 连原型 → 绑定 this → 返回结果"四步黑盒拆开给你看。
- `instanceof`：原型链查找的具象化——沿着 `__proto__` 一路找 `prototype`。
- `柯里化`：把"一次给全参数"变成"攒够参数再执行"，是函数组合和参数复用的基础。

```
this 的四种绑定优先级（手写题全部围绕它）：

  new 绑定  >  显式绑定(call/apply/bind)  >  隐式绑定(谁调用)  >  默认绑定(window/undefined)

柯里化的直觉：
  add(1,2,3)          一次给全     ──►  死板
  add(1)(2)(3)        攒够 3 个才算 ──►  add1 = add(1) 可复用"已加 1"这件事
```

## 核心要点

### 1. 手写 call / apply

核心思想：**把传入的函数临时设为目标对象的方法并调用，调用完删掉**。用 Symbol 做临时属性名，避免覆盖对象原有属性。

```javascript
Function.prototype.myCall = function (context = globalThis, ...args) {
  const fn = this                          // this 是调用 myCall 的函数本身
  const key = Symbol('fn')                 // 唯一键，防止覆盖 context 已有属性
  context[key] = fn                        // 临时"挂"到对象上 → 触发隐式绑定
  const result = context[key](...args)     // 以对象为调用者执行，this 即 context
  delete context[key]                      // 用完擦除痕迹
  return result
}

// apply 唯一区别：参数以数组形式传入
Function.prototype.myApply = function (context = globalThis, argsList = []) {
  const fn = this
  const key = Symbol('fn')
  context[key] = fn
  const result = context[key](...argsList) // 展开数组调用
  delete context[key]
  return result
}
```

```
执行流程 ASCII：

obj.myFn.myCall(ctx, a, b)
   │
   ▼
ctx[Symbol] = myFn      ← 挂载：函数成为 ctx 的"临时方法"
   │
   ▼
ctx[Symbol](a, b)       ← 调用：隐式绑定使 this === ctx
   │
   ▼
delete ctx[Symbol]      ← 擦除：ctx 恢复原样
   │
   ▼
return 返回值
```

注意两个细节：context 传 `null/undefined` 时按默认规则指向全局；原始值要 `Object()` 包装（严格模式下 call 传原始值也能工作，因为不再自动装箱，手写时可不深究）。

### 2. 手写 bind（含 new 兼容）

bind 返回一个**永久绑定 this 的新函数**。难点是：`new Bound()` 时 this 应指向新实例而不是绑定目标——规范规定 new 绑定优先级更高。

```javascript
Function.prototype.myBind = function (context, ...outerArgs) {
  const fn = this
  function bound(...innerArgs) {
    // 关键判断：new 调用时 this 是 bound 的实例
    const isNew = new.target === bound
    return fn.apply(isNew ? this : context, [...outerArgs, ...innerArgs])
  }
  // 维持原型链：new bound() 生成的实例要能挂到原函数的 prototype 上
  bound.prototype = Object.create(fn.prototype)
  return bound
}
```

```
两种调用路径对比：

f.bind(ctx)          普通调用 bound(2)
                     └► new.target === undefined → this 用 ctx
                        等价于 f.apply(ctx, [1, 2])

                     new 调用 new bound(2)
                     └► new.target === bound     → this 用【新实例】
                        忽略 ctx，等价于 new f(1, 2)
```

追问点：为什么 `bound.prototype = Object.create(fn.prototype)`？因为 `new bound()` 创建实例时读取的是 `bound.prototype`，若不桥接，`原函数.prototype` 上的方法就丢失了。原生 bind 对箭头函数返回的"bound"其实无效（箭头函数无 prototype），这里也可顺带提。

### 3. 手写 new

new 的四步：创建空对象 → 连原型 → 执行构造（绑 this）→ 处理返回值。

```javascript
function myNew(Ctor, ...args) {
  const obj = Object.create(Ctor.prototype) // ① 创建对象并连原型
  const result = Ctor.apply(obj, args)      // ② 构造函数以 obj 为 this 执行
  // ③ 构造若显式返回对象/函数，用该返回值；否则返回 obj
  return (result !== null && (typeof result === 'object' || typeof result === 'function'))
    ? result
    : obj
}
```

```
new Foo('a') 内部时间线：

 Object.create(Foo.prototype)   ──►  obj = {}，obj.__proto__ === Foo.prototype
        │
 Foo.apply(obj, ['a'])          ──►  obj 上被赋属性（this.name = 'a' 生效处）
        │
 返回值判断                      ──┬─ return {x:1} → 用这个对象（原型链也换成 {x:1} 的）
                                  └─ return 1 / 无 → 忽略，返回 obj
```

易错点：**构造函数返回原始值会被忽略，返回对象才生效**——这是第 ③ 步存在的全部意义。

### 4. 手写 instanceof 与 Symbol.hasInstance

instanceof 沿左操作数的原型链，查找是否出现右操作数的 prototype。

```javascript
function myInstanceof(left, right) {
  if (typeof right !== 'function') throw new TypeError('Right must be callable')
  let proto = Object.getPrototypeOf(left)          // 即 left.__proto__
  const target = right.prototype
  while (proto) {
    if (proto === target) return true              // 原型链上命中
    proto = Object.getPrototypeOf(proto)           // 继续向上
  }
  return false                                     // 直到 null 都没找到
}
```

```
原型链查找示意：

new Map() instanceof Map

map.__proto__ ──► Map.prototype ✔ 命中
              （若右值是 Object：
               Map.prototype ──► Object.prototype ✔ 依然 true）
```

`Symbol.hasInstance` 是钩子：`a instanceof b` 实际先调用 `b[Symbol.hasInstance](a)`，自定义它可完全接管判断（如 React 元素判定、`class Foo { static [Symbol.hasInstance]() { return false } }`）。

### 5. 柯里化与通用 curry

柯里化：把 `f(a,b,c)` 变成可以 `f(a)(b)(c)` 或任意"分批喂参"的形式，**参数攒够 arity 个才真正执行**。

```javascript
// 通用 curry：靠收集参数与 fn.length 比较来决定"继续等"还是"执行"
function curry(fn) {
  return function collected(...args) {
    if (args.length >= fn.length) {
      return fn.apply(this, args)        // 攒够 → 真正执行
    }
    return (...more) => collected.call(this, ...args, ...more) // 不够 → 继续收集
  }
}

const add = (a, b, c) => a + b + c
const curriedAdd = curry(add)
curriedAdd(1)(2)(3)      // 6
curriedAdd(1, 2)(3)      // 6
curriedAdd(1)(2, 3)      // 6
```

```
curry(add)(1)(2)(3) 收集过程：

collected(1)      args=[1]  1 < 3  ──► 返回新函数，记住 [1]
   │
collected(2)      args=[1,2] 2 < 3 ──► 返回新函数，记住 [1,2]
   │
collected(3)      args=[1,2,3] 3 ≥ 3 ─► 执行 add(1,2,3) → 6
```

柯里化的实用价值：参数复用（`const add1 = curriedAdd(1)`）、延迟执行、配合 compose 做函数式管道。注意 `fn.length` 对含默认值/剩余参数的函数不可靠（默认值之后的参数不计入 length）。

## 面试答法

### 30 秒版（可背诵）

> call/apply/bind 本质都是"把函数临时挂到对象上调用"来改变 this，区别是 call 逐个传参、apply 传数组、bind 返回永久绑定的新函数；bind 的手写难点是 new 兼容——用 new.target 判断，new 调用时 this 指向新实例而非绑定目标，还要桥接 prototype。手写 new 四步：Object.create 连原型、apply 绑 this、构造返回对象则用返回值否则返回新对象。instanceof 就是沿 __proto__ 找 right.prototype，Symbol.hasInstance 可以劫持这个判断。柯里化是把多参函数变成分批喂参、攒够 fn.length 个才执行，通用 curry 用闭包收集参数实现。

### 深入版（被追问时按编号展开）

1. **call/apply**：Symbol 临时属性挂载 → 调用 → 删除；apply 只是展开数组
2. **bind**：外层存 context 和预置参数，返回 bound；`new.target === bound` 时改用实例 this；`bound.prototype = Object.create(fn.prototype)` 保原型链
3. **new**：三步之外强调"返回原始值被忽略、返回对象生效"
4. **instanceof**：`Object.getPrototypeOf` 循环上溯；提一句对原始值失效（`'a' instanceof String` 为 false，因基本类型无原型链包装）
5. **柯里化**：curry 实现 + `fn.length` 陷阱 + 参数复用/延迟执行两个价值
6. **收尾加分**：这些 API 全部围绕 this 绑定优先级（new > 显式 > 隐式 > 默认）和原型链两条主线

### 常见追问

- **bind 后再 bind 一次，this 是谁？** → 第一次 bind 的结果；原生 bind 返回的函数再 bind 无效（this 已锁定）
- **为什么 new bound() 时 ctx 会失效？** → 规范规定 new 绑定优先级最高，this 必须是新创建实例，手写用 `new.target` 识别该场景
- **箭头函数能 bind 吗？** → 语法上可调用但无效：箭头函数没有 [[ThisMode]]，this 由定义时词法作用域决定，且它没有 prototype
- **instanceof 和 Object.getPrototypeOf 判断原型有何区别？** → instanceof 查整条链上是否出现 right.prototype（可被 hasInstance 劫持）；getPrototypeOf 只看直接原型
- **Function.prototype.bind 原生实现返回的函数有 name 吗？** → 有，形如 "bound foo"，手写版可加 `bound.name = 'bound ' + fn.name` 加分
- **curry 和 partial application 区别？** → 柯里化是逐层一元化链；偏应用是固定部分参数返回更 arity 小的函数；curry 是"全或无"的链式收集
