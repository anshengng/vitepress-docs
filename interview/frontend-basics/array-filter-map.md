# filter 和 map 的区别

## 为什么需要

两者都是"遍历数组、返回**新数组**、不改原数组"的迭代方法，是列表数据转换与筛选的日常主力，也是手写题（手写 map/filter）、链式调用和性能话题（链式多次遍历）的基础。考察点：回调返回值如何决定结果、新数组长度、稀疏数组空洞、常见误用。

## 核心要点

### 1. 对比总表

| 维度 | map | filter |
| --- | --- | --- |
| 用途 | **转换**：对每个元素做加工 | **筛选**：保留通过测试的元素 |
| 回调返回值的作用 | 直接成为新数组对应位置的元素 | 真值→保留该元素，假值→丢弃 |
| 新数组长度 | **恒等于**原数组 | ≤ 原数组 |
| 回调忘写 return | 得到全 `undefined` 数组 ⚠️ | 等价于全丢弃，得到 `[]` |
| 典型场景 | id 列表→对象列表、格式化、取字段 | 搜索过滤、条件剔除 |

```javascript
const numbers = [1, 2, 3, 4]
const doubled = numbers.map(n => n * 2)            // [2, 4, 6, 8]
const even = numbers.filter(n => n % 2 === 0)      // [2, 4]

// 面经对比点：同一个回调函数，两个方法"用法"不同
numbers.map(n => n % 3 === 0)    // [false, false, true, false] ← 布尔值被当"元素"收集
numbers.filter(n => n % 3 === 0) // [3]                         ← 布尔值当"判据"用
```

### 2. 回调签名与 thisArg

```javascript
arr.map((item, index, array) => { /* ... */ }, thisArg)
//    元素    下标    原数组引用    回调内的 this
```

- 三个参数依次是：当前元素、下标、**原数组本身**（不是拷贝）
- 第二个位置参数 thisArg 决定回调里的 `this`（箭头函数忽略它）

### 3. 关键行为与坑

```javascript
// ① 不改原数组，但元素是引用拷贝——嵌套对象仍共享
const src = [{ n: 1 }]
const copy = src.map(o => ({ ...o }))  // 想独立必须再浅拷贝一层

// ② 稀疏数组的空洞会被跳过并保留
const sparse = [1, , 3]                // 中间是 hole
sparse.map(x => x * 2)                 // [2, empty, 6] —— hole 不执行回调
sparse.filter(x => x > 1)              // [3]

// ③ map 里忘 return（箭头函数带花括号却没写 return）
[1, 2].map(x => { x * 2 })             // [undefined, undefined] ⚠️ 高频错误

// ④ map 异步陷阱：回调是 async 得到的是 Promise 数组
[1, 2].map(async x => x + 1)           // [Promise, Promise] → 要 await Promise.all(...)
```

- filter 判的是**真值**而非严格 `true`：`filter(x => x)` 可顺手去掉 `0/''/null/NaN`
- 无匹配时 filter 返回 `[]`（不是 null），可放心链式

### 4. 手写实现（可运行）

```javascript
// 手写 map：对每个元素调用回调，结果按位放入新数组
Array.prototype.myMap = function (cb, thisArg) {
  const res = new Array(this.length)
  for (let i = 0; i < this.length; i++) {
    if (i in this) res[i] = cb.call(thisArg, this[i], i, this) // 跳过空洞
  }
  return res
}

// 手写 filter：回调为真值才保留
Array.prototype.myFilter = function (cb, thisArg) {
  const res = []
  for (let i = 0; i < this.length; i++) {
    if (i in this && cb.call(thisArg, this[i], i, this)) res.push(this[i])
  }
  return res
}

console.log([1, 2, 3].myMap(x => x * 2))        // [2, 4, 6]
console.log([1, 2, 3, 4].myFilter(x => x % 2 === 0)) // [2, 4]
```

### 5. 链式组合示例

```javascript
const users = [
  { name: 'A', age: 20, active: true },
  { name: 'B', age: 17, active: true },
  { name: 'C', age: 25, active: false },
]
// 先筛选成年活跃用户，再只取名字：filter 决定"有哪些"，map 决定"变成什么"
const names = users.filter(u => u.active && u.age >= 18).map(u => u.name) // ['A']
```

## 面试答法

### 30 秒版本（可直接背诵）

> map 和 filter 都遍历数组并返回新数组、都不修改原数组。区别在回调返回值的用途：map 的返回值直接作为新元素，所以新数组长度和原数组一样，适合做转换；filter 的返回值只作真值判断，通过才保留原元素，长度可能变短，适合做筛选。回调签名都是 (元素, 下标, 原数组)。常见坑有两个：map 的箭头函数带花括号忘 return 会得到全 undefined 数组；两者对稀疏数组的空洞都是跳过回调。手写实现就是 for 循环加 `i in this` 判洞，map 按位收集返回值、filter 判真值 push。

### 深入展开

1. **一句话定位**：map 管"变成什么"，filter 管"留下哪些"，长度差异是本质区别
2. **回调签名**：三参数 + thisArg，指出第三个参数是原数组引用
3. **引用语义**：返回新数组但元素仍是引用拷贝，嵌套对象要再拷一层
4. **稀疏数组**：hole 不执行回调、map 结果保留 hole，体现规范级理解
5. **手写实现**：`i in this` 跳洞 + `cb.call(thisArg, ...)` 透传 this
6. **收尾**：链式 `filter().map()` 的惯用顺序；多次链式会多次遍历，大数据可合并为一次 reduce

### 常见追问

- **map 和 forEach 的区别？** → forEach 恒返回 undefined，只为执行副作用；map 收集返回值用于转换
- **filter 没匹配到时返回什么？** → 空数组 `[]`，不是 null，可继续链式
- **回调里能修改原数组吗？** → 第三个参数就是原数组引用，技术上可以，但会造成"边遍历边改"的混乱，不要做
- **为什么 `[1,2].map(x => { x * 2 })` 全是 undefined？** → 花括号让箭头函数体变成代码块，没有 return 就返回 undefined
- **map 一个 async 函数会发生什么？** → 得到 Promise 数组，需 `await Promise.all(arr.map(async ...))`
