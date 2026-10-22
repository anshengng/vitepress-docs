# var、let、const 的区别

## 为什么需要

ES5 及以前只有 `var`，带来三类顽疾：变量意外泄漏到全局、重复声明不报错互相覆盖、`for` 循环变量被异步回调"吃掉"（经典的全输出 5）。ES6 的 `let/const` 用**块级作用域 + 暂时性死区 + 禁止重复声明**逐一解决。本题考察的不只是背差异，而是对作用域、变量提升、TDZ、"常量到底什么不能变"的理解深度。

## 核心要点

### 1. 对比总表

| 维度 | var | let | const |
| --- | --- | --- | --- |
| 作用域 | 函数 / 全局作用域 | 块级作用域（`{}` 内） | 块级作用域（`{}` 内） |
| 同作用域重复声明 | 允许，后者覆盖前者 | ❌ SyntaxError | ❌ SyntaxError |
| 重新赋值 | 允许 | 允许 | ❌ 不允许 |
| 声明时初始化 | 不要求 | 不要求 | **必须** |
| 提升行为 | 声明提升，自动初始化为 `undefined` | 提升但**不初始化** | 提升但不初始化 |
| 暂时性死区（TDZ） | 无（提前访问得 `undefined`） | 有 | 有 |
| 全局声明是否挂 window | 是 | 否 | 否 |

### 2. 作用域差异（图解）

```
function demo() {
  if (true) {
    var a = 1        // var：只有函数/全局作用域，if 块困不住它
    let b = 2        // let：只在 { } 内有效
    const c = 3      // const：同上
  }
  console.log(a)     // ✅ 1（泄漏到函数作用域）
  console.log(b)     // ❌ ReferenceError: b is not defined
}
```

```
var 的经典泄漏事故：

function foo() {
  if (false) { var x = 1 }   // 条件根本不执行
  console.log(x)             // undefined —— 声明照样提升进函数作用域
}
```

### 3. 提升与暂时性死区（时间线图）

```
var 的声明+初始化时机：            let/const 的 TDZ：

console.log(a) → undefined          块开始 ┌──────── TDZ ────────┐
var a = 1                               console.log(a) → ❌ ReferenceError
   ↑ 实际等价于                          let a = 1  ← 越过这条线才可访问
   var a;        （声明提升到函数顶部）   原因：声明被提升但"未初始化"，
   console.log(a)                        访问处于"已登记未生效"状态的
   a = 1         （赋值留在原地）         绑定 → 直接报错
```

```javascript
// TDZ 代码验证
console.log(typeof undeclaredVar) // 'undefined' —— 未声明变量 typeof 安全
console.log(typeof tdzLet)        // ❌ ReferenceError —— TDZ 内 typeof 也救不了
let tdzLet = 1
```

### 4. const 的"不可变"针对绑定，不针对内容

```javascript
const user = { name: 'Li' }
user.name = 'Wang'      // ✅ 合法：改的是对象内部内容
user = {}               // ❌ TypeError：改变了绑定指向，禁止

// 想冻结内容用 Object.freeze（浅冻结，嵌套层仍可变）
Object.freeze(user)
```

### 5. for 循环：var 与 let 的本质区别

```javascript
for (var i = 0; i < 3; i++) setTimeout(() => console.log(i)) // 3 3 3
for (let i = 0; i < 3; i++) setTimeout(() => console.log(i)) // 0 1 2
```

```
var：全程一个 i，3 个回调共享最终值 3
let：每轮循环新建一个块作用域绑定（引擎特殊处理 TDZ），
     新 i 从上一轮 i 拷贝初值 → 每个回调拿到"当轮私有"的快照
```

### 6. 实践准则

> 默认 `const`，需要重新赋值才用 `let`，彻底告别 `var`。

## 面试答法

### 30 秒版本（可直接背诵）

> 三点核心差异：作用域上 var 是函数作用域，let/const 是块级作用域；重复性上 var 可重复声明、let 不可重复声明但可重赋值、const 既不可重复声明也不可重赋值且必须声明时初始化；提升上 var 提升后是 undefined，let/const 提升但未初始化，提前访问触发暂时性死区报 ReferenceError。另外 const 的不可变指的是绑定不能改，对象内部属性照样能改，要冻结得 Object.freeze。实战原则：优先 const，其次 let，禁用 var。

### 深入展开

1. **先给作用域图**：if 块困不住 var、能困住 let/const，顺带讲 var 泄漏事故
2. **提升时间线**：var"声明+undefined 一起提前"，let/const"只登记不初始化"，TDZ 从块头到声明行
3. **typeof 与 TDZ**：对未声明变量 typeof 返回 undefined，对 TDZ 变量照样抛错——体现细节掌握
4. **const 语义**：不可变的是"绑定"，对象内容可变；引出 Object.freeze 是浅冻结
5. **for 循环 var/let 差异**：每轮新块绑定 = 每轮快照，衔接闭包主题
6. **收尾**：全局 var 挂 window、let/const 不挂；工程规范 const 优先

### 常见追问

- **const 为什么还能改对象属性？** → 不可变的是变量与值的绑定关系，不是值本身；深冻结用递归 Object.freeze 或 Immutable
- **暂时性死区存在的意义？** → 把"声明前使用"从静默 undefined 变成显式报错，也保证块内声明不被外部同名变量干扰
- **TDZ 内访问一定报错吗？** → 是，包括 typeof；但 `typeof x` 中 x 完全未声明才返回 'undefined'
- **var 声明的函数作用域怎么理解？** → var 的归属是最近的函数（或全局）作用域，与代码写在哪个 if/for/try 块无关
- **for(let) 每轮是新变量还是同一个？** → 引擎规范上是每轮新建绑定并从上一轮取值，所以闭包各自捕获独立快照
