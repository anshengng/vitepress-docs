# 为什么需要使用箭头函数

## 为什么需要

普通函数有三个痛点：`this` 在**调用时**才确定，回调里动不动丢失主语；函数声明既能 `a()` 又能 `new a()`，用途二义；`function` 关键字写法啰嗦。箭头函数用"**词法 this + 不可 new + 简洁语法**"一次性解决这三件事。本题考察你是否清楚箭头函数"少了什么"——很多误用恰恰源于它缺少的能力。

## 核心要点

### 1. 使用箭头函数的三大理由

| 理由 | 普通函数的问题 | 箭头函数的行为 |
| --- | --- | --- |
| 消除函数二义性 | `function a(){}` 既可 `a()` 也可 `new a()`，一个函数两种身份 | **不能 new**（TypeError），明确"只是函数，不是构造器" |
| 语法简洁 | `function (x) { return x * 2 }` | `x => x * 2`，单表达式隐式 return |
| 避免 this 指向问题 | this 取决于怎么调用，回调/定时器里主语丢失 | this 在**定义时**从外层词法作用域捕获，终身不变 |

```javascript
// 二义性：同一个函数两种用法
function Task() {}
Task()        // 当普通函数调用（this = window，非严格下隐式建全局）
new Task()    // 当构造器调用（得到实例）
// 箭头函数直接堵死第二条路：
const Task2 = () => {}
new Task2()   // ❌ TypeError: Task2 is not a constructor
```

### 2. this 词法捕获图解

```
普通函数：this 看"谁调用"            箭头函数：this 看"谁定义"

function fn() { console.log(this) }   const fn = () => console.log(this)
obj.fn()  → this = obj                定义时外层是谁，this 就是谁，
fn()      → this = window  ❌         call/bind/换宿主统统改不动
setTimeout(fn, 0) → this = window ❌
```

```javascript
// 面经示例：回调中 this 的经典修复
function Timer() {
  this.seconds = 0
  // 普通函数写法：必须 self 备份或 bind
  // setInterval(function () { this.seconds++ }, 1000) // ❌ this = window
  setInterval(() => {
    this.seconds++ // ✅ this 捕获自 Timer 构造执行时的实例
  }, 1000)
}
```

### 3. 箭头函数"没有"的东西（误用高发区）

| 缺少的能力 | 后果 / 替代方案 |
| --- | --- |
| 自己的 `this` | 对象字面量里当方法用会指错：`{ say: () => this }` 的 this 是外层，不是对象 |
| `arguments` | 用剩余参数 `...args` 代替 |
| `prototype` 属性 | 没有原型，自然不能当构造器 |
| `new.target` | 同上 |
| `super` | 类内部依赖 super 的方法别写成箭头函数 |
| 生成器语法 | 不能写 `function*` |

```javascript
const obj = {
  name: 'Li',
  greet: () => console.log(this?.name), // ⚠️ this 不是 obj，而是定义处的外层
  hi() { console.log(this.name) },      // ✅ 方法用简写普通函数
}
```

### 4. 简洁语法形态

```javascript
const square = x => x * x                 // 单参数省括号，单表达式省 return
const sum = (a, b) => a + b               // 多参数要括号
const log = () => console.log('hi')       // 无参要空括号
const toObj = x => ({ v: x })             // 直接返回对象字面量要包 ()
```

## 面试答法

### 30 秒版本（可直接背诵）

> 用箭头函数有三个原因：一是消除函数的二义性——普通函数既能直接调用又能 new，箭头函数不能 new，身份唯一；二是语法简洁，单表达式还能隐式返回；三是最关键的，箭头函数没有自己的 this，定义时从外层词法作用域捕获、终身不变，解决了回调里 this 丢失的问题。代价是它没有 arguments、没有 prototype、不能当构造器，也不适合写成对象方法，这些场景要用普通函数或剩余参数替代。

### 深入展开

1. **二义性切入**：`a()` vs `new a()` 两种语义混在一个 function 上，class 和箭头函数分别把"构造器"和"纯函数"职责拆开
2. **this 词法机制**：定义时捕获外层 this，画"普通函数看调用 / 箭头看定义"对比图
3. **回调修复实战**：setTimeout/数组回调里 self 备份 → bind → 箭头函数三种写法的演进
4. **能力缺失清单**：arguments/prototype/new.target/super 都没有，对象方法误用例
5. **收尾**：箭头函数是"匿名纯函数 + 词法 this"，不是普通函数的语法糖替代品

### 常见追问

- **call/bind 能改箭头函数的 this 吗？** → 不能，第一个参数被忽略，this 定义时已定死
- **箭头函数能当对象方法用吗？** → 语法上可以，但 this 不是该对象（对象字面量不构成作用域），需要 this 时写普通函数
- **没有 arguments 怎么办？** → 用剩余参数 `(...args)`，它还是真数组，比 arguments 更好用
- **箭头函数有 prototype 吗？** → 没有，`fn.prototype === undefined`，这也是它不能 new 的原因之一
- **class 字段里写箭头函数有什么好处？** → `handler = () => {...}` 让 this 绑死实例，React/Vue 事件解绑时引用稳定
