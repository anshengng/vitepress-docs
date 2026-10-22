# Function 参数：arguments、形参/实参、默认参数、剩余参数

## 为什么需要

函数参数机制是手写工具函数的地基：柯里化要收集参数、防抖节流要透传 `(...args)`、通用包装器要借 `arguments`。考察点是形参/实参的绑定关系、arguments 的"类数组"本质、默认参数的求值时机、剩余参数与 arguments 的取舍。

## 核心要点

### 1. 形参 vs 实参

| 概念 | 定义位置 | 本质 | 示例 |
| --- | --- | --- | --- |
| 形参 | 函数声明的括号里 | 占位变量，接收实参；不传则为 `undefined` | `function f(a, b)` 的 a、b |
| 实参 | 调用处传入 | 实际的值/引用 | `f(1, obj)` 的 1、obj |

- 实参个数**可以多也可以少**于形参：多了不报错（可从 arguments 拿），少了形参为 `undefined`
- 对象/数组实参传的是**引用**：函数内改属性会影响外部，重新赋值形参不会

### 2. arguments 对象（仅非箭头函数有）

```javascript
function show() {
  console.log(arguments)            // { '0': 1, '1': 2, length: 2 } 类数组
  console.log(arguments.length)     // 2
  console.log([...arguments])       // [1, 2] 展开成真数组
  console.log(Array.from(arguments))// [1, 2] 同上
  // arguments.map(...)             // ❌ TypeError：它没有数组方法
}
show(1, 2)
```

关键事实：

- **类数组**：有数字下标和 `length`，`[[Prototype]]` 指向 `Object.prototype`（不是 Array），所以没有 `map/filter`；但它有 `Symbol.iterator`，能被展开/`for...of`
- `arguments.callee` 指回当前函数，**严格模式禁用**
- 非严格模式下 `arguments[i]` 与形参是**联动别名**（改一个影响另一个）；一旦出现默认参数/剩余参数，或严格模式，联动关系断开
- **箭头函数没有自己的 arguments**，内部引用会取到外层函数的 arguments
- `fn.length` 只统计"第一个默认/剩余参数之前"的形参个数

### 3. 默认参数

```javascript
function add(x, y = 10) {   // y 的默认值在每次调用时求值
  return x + y
}
add(1)        // 11
add(1, undefined) // 11 —— 只有 undefined 才触发默认值，null 不触发

let a = 1
function f(x = a, a = 99) { return x } // 参数作用域隔离：x 取外层 a=1 → 1
function g(x = y, y = 2) {}            // ❌ ReferenceError：默认值引用后面的参数（TDZ）
```

- 默认值**惰性求值**：每次调用重新计算（`f(arr = [])` 每轮拿到新数组）
- 触发条件是实参为 `undefined`；`null / 0 / ''` 都不会触发
- 参数列表自身构成一个作用域，后面的参数对默认值是 TDZ

### 4. 剩余参数（rest）

```javascript
const myFunction = (...args) => console.log(args)
const myFunction2 = (name, ...args) => console.log(args)
myFunction(1, 2, 3)               // [1, 2, 3]
myFunction()                      // []
myFunction2('liuk', 2, 'ez')      // [2, 'ez'] —— 收集除 name 外的所有实参
```

- 必须是**最后一个**参数，`(...a, b)` 报 SyntaxError（解构模式内部的 rest 如 `([x, ...ys])` 不受此限）
- 拿到的是**真数组**，可直接 map/filter/reduce
- 箭头函数收集不定参数的唯一手段（它没有 arguments）

### 5. arguments vs 剩余参数

| 维度 | arguments | 剩余参数 `...args` |
| --- | --- | --- |
| 存在范围 | 非箭头函数都有 | 需显式声明 |
| 类型 | 类数组对象 | 真 Array |
| 是否含已命名形参的值 | 含全部实参 | 只含"剩余"的实参 |
| 与形参联动 | 非严格模式联动（坑） | 无联动，干净 |
| 箭头函数可用 | ❌ | ✅ |
| 建议 | 维护老代码 | **新代码首选** |

## 面试答法

### 30 秒版本（可直接背诵）

> 形参是声明处的占位变量，实参是调用处传的值，个数不必匹配，缺的为 undefined。非箭头函数里可以用 arguments 拿到全部实参，它是有下标和 length 的类数组对象，不是数组，没有 map 这些方法，要 Array.from 或展开转一下；严格模式或带默认参数时它与形参的联动会断。默认参数在调用时惰性求值，只有 undefined 才触发，引用后面的参数会踩 TDZ。剩余参数必须放最后，收集其余实参为真数组，箭头函数没有 arguments，收集不定参数只能靠它。现代写法优先剩余参数，arguments 只在读老代码时认识。

### 深入展开

1. **形参/实参绑定**：传引用与重新赋值的区别（改属性影响外部，重绑定不影响）
2. **arguments 解剖**：类数组证据链——有 length、无数组方法、`__proto__` 是 Object.prototype、有 Symbol.iterator
3. **联动别名坑**：非严格模式 `arguments[0]=9` 会改掉形参；默认参数/剩余参数自动断开
4. **默认参数三规则**：调用时求值、只认 undefined、参数作用域 TDZ
5. **rest 优势**：真数组 + 不与形参纠缠 + 箭头函数唯一解
6. **收尾**：`fn.length` 与 `arguments.length` 的区别（声明的形参数 vs 实际传入数）

### 常见追问

- **arguments 是数组吗？** → 不是，是类数组对象；可用 `Array.from` / 展开运算符转成真数组
- **为什么箭头函数没有 arguments？** → 设计上避免歧义，词法继承外层反而容易出错，规范直接取消，用 rest 参数替代
- **`f(1, null)` 时默认参数生效吗？** → 不生效，只有实参为 `undefined`（或干脆没传）才触发默认值
- **怎么判断传了几个参数？** → `arguments.length`；具名函数里也可用 `fn.length` 看声明的形参个数
- **剩余参数和展开运算符怎么区分？** → 同一个 `...` 在形参位置是"收集"（rest），在实参/字面量位置是"展开"（spread）
