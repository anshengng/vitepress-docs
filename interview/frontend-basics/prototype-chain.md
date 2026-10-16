# 原型链与继承

## 题目

> 说说 prototype、`__proto__`、constructor 三者的关系？什么是原型链？`obj.toString()` 是怎么找到的？new 一个对象发生了什么？JS 有哪几种继承方式，组合继承有什么问题，寄生组合式继承怎么解决它？class 和原型是什么关系？

## 为什么需要原型

JS 的对象要共享方法：10000 个实例如果每个都自带一份 `say()` 函数，既浪费内存又无法统一修改。于是 JS 的设计是——**实例自己不存方法，方法放在一个公共对象上，实例通过一条"链接"去找**，这条链接就是 `__proto__`，公共对象就是 `prototype`，连起来就是原型链。

## 核心要点

### 1. prototype / `__proto__` / constructor 三角关系

```
  Person(构造函数) ──①prototype──► Person.prototype
       ▲                              │      ▲
       └────────③constructor─────────┘      │
                                            │ ②__proto__
  new Person('Tom')                          │
       │                                     │
       ▼                                     │
     p(实例) ─────────────────────────────────┘
  { name:'Tom' }   p.__proto__ === Person.prototype ✅
```

三条铁律（背下来）：

- `p.__proto__ === Person.prototype`（实例的隐式原型 = 构造函数的显式原型）
- `Person.prototype.constructor === Person`（原型反向指回构造函数）
- 函数都有 `prototype`，**除箭头函数**；实例都有 `__proto__`（规范名是内部槽 `[[Prototype]]`，用 `Object.getPrototypeOf()` 读更稳）

### 2. 原型链查找路径

`__proto__` 继续往上连：`Person.prototype.__proto__ === Object.prototype`，`Object.prototype.__proto__ === null`，链到此为止。

```
p ──► Person.prototype ──► Object.prototype ──► null
     (constructor,say)    (toString,hasOwnProperty,valueOf)

p.toString() 的查找过程：
① p 自己有没有 toString？            ❌ 只有 name
② Person.prototype 有没有？           ❌ 只有 constructor、say
③ Object.prototype 有没有？           ✅ 找到，停止查找并调用
（全链都没有 → 返回 undefined）
```

- 读属性：沿链往上找，找到为止
- 写属性：**不查链**，直接在实例自身写（可能遮蔽原型上的同名属性）

### 3. new 操作符手写实现

new 做四件事：建空对象 → 连原型 → 绑定 this 执行构造函数 → 处理返回值。

```javascript
function myNew(Fn, ...args) {
  const obj = Object.create(Fn.prototype) // ① 新对象，__proto__ 指向 Fn.prototype
  const ret = Fn.apply(obj, args)         // ②③ 执行构造函数，this 绑到 obj
  // ④ 构造函数返回对象就用它，否则返回新对象
  return ret !== null && (typeof ret === 'object' || typeof ret === 'function')
    ? ret
    : obj
}
```

追问点：构造函数 `return {}` 会覆盖 new 的结果；`return 1`（原始值）会被忽略。

### 4. 六种继承方式演进

```
① 原型链继承        Child.prototype = new Parent()
② 构造函数继承      Parent.call(this)
③ 组合继承          ①+② 都用 → 父构造函数执行两次 ❌
④ 原型式继承        Object.create(obj)
⑤ 寄生组合继承      Object.create(Parent.prototype) ✅ 最优解
⑥ class extends     语法糖，本质是⑤
```

| 方式 | 写法核心 | 致命问题 |
| --- | --- | --- |
| 原型链继承 | `Child.prototype = new Parent()` | 原型上的**引用类型被所有实例共享**（数组一起改）；创建子类时无法传参 |
| 构造函数继承 | `Parent.call(this, args)` | 只继承实例属性，**父类 prototype 上的方法子类用不到**，方法无法复用 |
| 组合继承 | 上面两者各来一遍 | 父构造函数执行两次，`Child.prototype` 上多出一份**冗余的父类实例属性** |
| 寄生组合继承 | `Child.prototype = Object.create(Parent.prototype)` | 无（标准答案） |

**组合继承的痛点图解**：

```
function Child(name, age) {
  Parent.call(this, name)   // 第 1 次调用 Parent：在实例上写 name
}
Child.prototype = new Parent()  // 第 2 次调用 Parent：在原型上又写了一份 name ❌

   Child.prototype 上：{ name: undefined, ... }  ← 这份被实例属性遮蔽，纯属浪费
```

**寄生组合式继承**（只借原型，不调用父构造函数）：

```javascript
function inheritPrototype(Child, Parent) {
  const proto = Object.create(Parent.prototype) // 拿到父类原型的一份"链接副本"
  proto.constructor = Child                     // 修正 constructor 指回子类
  Child.prototype = proto
}
function Parent(name) { this.name = name; this.colors = ['red'] }
Parent.prototype.say = function () { return this.name }
function Child(name, age) {
  Parent.call(this, name)   // 实例属性只在这里初始化一次
  this.age = age
}
inheritPrototype(Child, Parent)
Child.prototype.study = function () {}
```

结果：父构造函数只执行一次，引用类型属性在实例上各自独立，方法在原型上共享。

### 5. class 与原型的关系

class 不是新机制，是**原型链的语法糖**，但和手写函数继承有几点行为差异：

```javascript
class Person {
  constructor(name) { this.name = name }
  say() { return this.name }          // 自动挂在 Person.prototype 上
}
// 等价于 ↓
function Person(name) { this.name = name }
Person.prototype.say = function () { return this.name }
```

| 差异点 | class | 构造函数 |
| --- | --- | --- |
| 直接调用 | `Person('a')` 报错，**必须 new** | 可以当普通函数调用 |
| 方法可枚举性 | prototype 方法**不可枚举** | 可枚举 |
| 内部模式 | 强制严格模式 | 默认非严格 |
| 继承时机 | 子类 `this` 由父类构造产生，必须先 `super()` | `Parent.call(this)` 随时可调 |

## 面试答法

### 30 秒版（可背诵）

> JS 的继承靠原型链实现。每个函数有 prototype，每个实例有 `__proto__`，实例的 `__proto__` 指向构造函数的 prototype，prototype 的 `__proto__` 又指向上一层，一直到 Object.prototype 再到 null，这就是原型链。读属性时沿链一层层往上找，找不到返回 undefined。new 做了四步：创建空对象、连原型、绑定 this 执行构造函数、返回对象。继承方式里组合继承最大的问题是父构造函数执行两次、原型上留冗余属性，所以标准做法是寄生组合式：用 Object.create 把父类原型复制一份给子类原型，再修正 constructor。class 本质上就是这套写法的语法糖，区别是必须 new 调用、方法不可枚举、内部严格模式。

### 深入版（被追问时按编号展开）

1. **三角关系**：先画 `实例.__proto__ → 构造函数.prototype → .constructor 指回` 的闭环，强调两条等式
2. **查找过程**：拿 `p.toString()` 举例，从实例 → 父原型 → Object.prototype 逐层查
3. **手写 new**：四步 + `Object.create` + 返回值处理（返回对象才覆盖）
4. **继承演进**：原型链继承（引用共享）→ 构造函数继承（方法不复用）→ 组合继承（执行两次）→ 寄生组合（Object.create 只借原型）
5. **class 差异**：必须 new、不可枚举、严格模式、extends 要先 super()
6. **收尾加分**：`hasOwnProperty` 判自身属性、`Object.create(null)` 造纯净字典对象

### 常见追问

- **如何区分实例自身属性和原型属性？** → `obj.hasOwnProperty(k)` 只查自身；`k in obj` 会查整条原型链
- **`Child.prototype = Parent.prototype` 行不行？** → 不行，两个原型是同一个对象，给 Child 加方法会污染 Parent
- **为什么修正 constructor？** → `Object.create` 出来的原型上 constructor 还指向 Parent，不指回 Child，`new p.constructor` 会构造错类型
- **`__proto__` 和 `Object.getPrototypeOf` 的区别？** → 前者是历史遗留的非标准访问器（有性能与覆盖问题），后者是标准读法，推荐后者
- **class 的 extends 能直接换成 `Parent.call(this)` 吗？** → 不能，class 的 this 由父类构造返回，调用 super() 前访问 this 会报 ReferenceError
