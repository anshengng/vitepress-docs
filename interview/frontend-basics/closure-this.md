# 闭包与 this 指向

## 题目

> 什么是闭包？它是怎么形成的？有哪些应用场景和坑？this 的绑定规则是什么、优先级如何？call/apply/bind 有什么区别？

## 为什么需要

- **闭包**像「背包」：函数离开出生地（外层函数已执行完）后，仍背着装外层变量的背包随时取用。
- **this** 像代词「我」："我"指谁取决于谁在说——看**调用**，不看定义。不懂它，回调里 `this.name` 全是 undefined。

## 核心要点

### 一、闭包形成原理（作用域链穿透图）

闭包 = 内层函数 + 它引用的外层词法环境。函数在**定义时**就绑死了出生地的作用域链：

```
全局作用域
  └─ outer 的作用域 ─────── 定义了 count
       └─ inner 的作用域 ── 引用了 count

inner 查找 count：自己没有 → 沿词法作用域链向上 → 在 outer 中找到 ✅
outer() 执行完，栈帧本该销毁，但 inner 仍引用 count
→ GC 看到活跃引用不敢回收 → 变量被 inner 的"背包"带走 → 闭包
```

```javascript
function outer() {
  let count = 0                    // 外层变量
  return function inner() {
    count++                        // 引用外层变量 → 闭包形成
    return count
  }
}
const fn = outer()   // outer 已弹栈，count 仍活着
fn()  // 1
fn()  // 2  ← 同一个 count 在累加；再调 outer() 会生成全新独立的一套
```

### 二、经典题：for + var 全输出 5（时间线推演）

```javascript
for (var i = 0; i < 5; i++) {
  setTimeout(() => console.log(i))
}
// 输出：5 5 5 5 5（不是 0 1 2 3 4）
```

| 时刻 | 同步世界（调用栈） | 异步世界（宏任务队列） |
| --- | --- | --- |
| t1 | 循环开始；var 只有全局唯一一个 i | - |
| t2 | 5 个回调入队，记住的是"i 这个变量"，不是当时的值 | 队列：[cb1..cb5] |
| t3 | 循环结束，i === 5 | - |
| t4 | 栈空，事件循环开始取宏任务 | cb1 → 读 i → **5** |
| t5~ | 依次出队 | cb2~cb5 → 读同一个 i → **5 5 5 5** |

let 修复原理——**每轮循环创建新的块作用域**，相当于每轮拍快照：

```
var：全程一个作用域，5 个回调共享同一个 i
  cb1  cb2  cb3  cb4  cb5
   ↘    ↘    ↘    ↘    ↙
        → 同一个 i（最终 = 5）

let：每轮一个块作用域（每轮一个独立"背包"）
  第 1 轮 → { i=0 } ← cb1 只引用这一份
  第 2 轮 → { i=1 } ← cb2 只引用这一份
  ...每个回调拿到的是"当轮私有的 i" → 输出 0 1 2 3 4
```

### 三、闭包的应用与内存泄漏坑

| 应用 | 闭包保存了什么 | 一句话原理 |
| --- | --- | --- |
| 防抖/节流 | timer / 上次执行时间 | 多次调用共用一份"状态" |
| 柯里化 | 已传入的参数 | add(1)(2)：先攒参数，够数再算 |
| 私有变量 | 私有变量本身 | 外部摸不到，只能走暴露的方法 |
| 模块/IIFE | 私有成员 | 私有数据 + 定向暴露接口 |

```javascript
function debounce(fn, delay) {
  let timer = null                        // 闭包变量：跨多次调用共享
  return function (...args) {
    clearTimeout(timer)
    timer = setTimeout(() => fn.apply(this, args), delay)
  }
}
// 私有变量同理：createCounter 里 let count = 0，只返回 inc/get 方法
```

内存泄漏：闭包变量 = 活跃引用 → GC 永不回收。

```javascript
function bind() {
  const bigData = new Array(1e6).fill('x')              // 大对象
  document.onclick = function () { console.log('hi') }  // 回调与 bigData 同链
}
// onclick 不解绑 → 回调一直活着，作用域链带着 bigData 一起活着；修复：用完置 null
```

### 四、this 五种绑定规则

this 在**调用时**确定（箭头函数除外），与定义位置无关。

| 规则 | 调用形式 | this 指向 |
| --- | --- | --- |
| 默认绑定 | fn() 裸调用 | 非严格 window / 严格 undefined |
| 隐式绑定 | obj.fn() | 点前面的 obj |
| 显式绑定 | call / apply / bind | 手动指定的对象 |
| new 绑定 | new Fn() | 新创建的实例 |
| 箭头函数 | 不看调用，看定义 | 定义时外层的 this |

```javascript
function f() { console.log(this.name) }   // 1 默认绑定：window.name（严格报错）
f()
const obj = { name: '隐式', say: f }        // 2 隐式绑定
obj.say()                                 // '隐式'
f.call({ name: '显式' })                    // 3 显式绑定 → '显式'
function Person(name) { this.name = name } // 4 new 绑定：this = 新实例
new Person('我')
const timer = { n: 0,                       // 5 箭头函数：拿外层 start 的 this
  start() { setInterval(() => { this.n++ }, 1000) } }
```

### 五、绑定优先级流程图（new > 显式 > 隐式 > 默认）

```
函数被调用 → 判定 this：
  new 调用？ ─── 是 ──► this = 新实例                （最高）
      │ 否
  被 call/apply/bind 指定？ ── 是 ──► this = 指定对象
      │ 否
  有 xx.fn() 前缀？ ─── 是 ──► this = xx（点前面那个）
      │ 否
  this = window / undefined（严格模式）               （最低）
  ★ 箭头函数：无视以上全部！定义时定死，call 也改不动
```

### 六、call / apply / bind 三者对比

| 方法 | 传参方式 | 是否立即执行 | 典型用途 |
| --- | --- | --- | --- |
| call(this, a, b) | 逐个传 | 是 | 借原型方法：Array.prototype.slice.call(伪数组) |
| apply(this, [a, b]) | 数组打包 | 是 | Math.max.apply(null, arr) |
| bind(this, a, b) | 逐个传，可预置 | 否，返回新函数 | 固定回调 this、柯里化 |

```javascript
function add(a, b) { console.log(this.x + a + b) }
add.call({ x: 1 }, 2, 3)      // 6
add.apply({ x: 1 }, [2, 3])   // 6
add.bind({ x: 1 }, 2)(3)      // 6（bind 返回新函数 + 可预置参数）
```

### 七、箭头函数 this：取定义处外层（一句图解）

```
const arrow = () => this
                     └─ 定义瞬间"咔嚓"拍下外层作用域的 this，终身不变

const obj = { name: 'X', say: () => console.log(this.name) }
obj.say()   // undefined ❌ 高频错误！
// 对象字面量不构成作用域 → 箭头看到的外层是全局 → this = window
// 方法里想用 this 就写普通函数：say() { ... }
```

### 八、隐式绑定丢失：赋值给变量 / 作为回调

```
obj.say()                       → 有主语：this = obj ✅
const f = obj.say                → 只拷贝了"裸函数"，主语丢失
f()                             → 退化默认绑定：this = window ❌
setTimeout(obj.say, 0)          → 引擎拿到裸函数再调用 ❌ 同上
setTimeout(() => obj.say(), 0)  ✅ 修复：包一层保住主语
```

## 面试答法

### 30 秒版

闭包就是函数加上它引用的外层词法环境：内层函数引用了外层变量，外层函数执行完后这些变量也不会被回收，相当于被打包进背包带走。典型应用是防抖节流、柯里化和私有变量，副作用是引用不及时断开会内存泄漏。this 看调用时：优先级是 new > call/apply/bind 显式 > obj.fn() 隐式 > 默认 window，箭头函数是特例——没有自己的 this，取定义时外层的 this，call 也改不动。最常见坑是隐式绑定丢失：方法赋给变量或作为回调传出去，主语没了就退化成 window。

### 深入版

1. **给定义 + 图**：作用域链穿透图，说明"定义时绑定、执行完仍存活"
2. **经典题佐证**：for+var 全输出 5 的时间线推演，讲 let 每轮新块作用域 = 每轮新闭包
3. **应用与坑**：防抖存 timer、私有变量走方法；泄漏点在"回调不解绑、缓存无上限"
4. **转 this**：调用时确定 → 按优先级逐条举例（new / 显式 / 隐式 / 默认）
5. **箭头函数**：定义时定死；对象字面量里写箭头函数是高频错误
6. **收尾**：隐式绑定丢失两大场景（赋值 / 回调）与修复手法

### 常见追问

- **闭包一定导致内存泄漏吗？** → 不是，只是延长生命周期；不解绑事件、缓存无上限才演变为泄漏，用完置 null
- **不用 let 怎么修复 for+var？** → IIFE 每轮传值：把 i 作为实参拷贝进一个全新的函数作用域
- **手写 bind 的要点？** → 返回新函数，内部 fn.apply(thisArg, 预置参数.concat(新参数))；被 new 调用时 this 要指向新实例
- **箭头函数能被 call 改 this 吗？** → 不能，call 第一个参数被忽略，this 不变
- **obj.fn.call(obj2) 输出什么？** → 显式 > 隐式，this 是 obj2
