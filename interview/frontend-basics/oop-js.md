# JS 实现封装、继承、多态

## 为什么需要

面向对象三大特征是 OOP 面试的固定考题。JS 没有 Java 式的访问修饰符和编译期重载，三大特征全靠语言特性"拼"出来：封装靠**闭包 / #私有字段 / 存取器**，继承靠**原型链 / extends**，多态靠**方法重写 + 鸭子类型**。考察的是你能否把概念落到可运行代码上。

## 核心要点

### 1. 总览表

| 特征 | 传统语言实现 | JS 实现 |
| --- | --- | --- |
| 封装 | private 关键字 | 闭包隐藏变量、`#` 私有字段、get/set 存取器、约定 `_` 前缀 |
| 继承 | extends（类为基础） | 原型链（寄生组合式）、ES6 `class extends` |
| 多态 | 重写 + 抽象方法/接口 | 原型链动态派发（方法重写）、鸭子类型；无原生重载，靠参数判断模拟 |

### 2. 封装：隐藏内部状态，只暴露接口

```javascript
// 方式一：闭包 —— count 外部完全摸不到
function createCounter() {
  let count = 0                       // 私有状态：藏在闭包里
  return {
    increment() { count++ },
    decrement() { count-- },
    getCount() { return count },      // 只能通过接口读写
  }
}
const c = createCounter()
c.increment()
console.log(c.getCount()) // 1
console.log(c.count)      // undefined —— 外部无法直接访问

// 方式二：ES6 私有字段 —— # 是运行时强制的，不是约定
class Person {
  #age                                // 私有属性
  constructor(name, age) {
    this.name = name
    this.#age = age
  }
  getAge() { return this.#age }
  setAge(v) { if (v > 0) this.#age = v } // 校验逻辑收口在类内
}
const p = new Person('John', 30)
p.getAge()    // 30
p.#age        // ❌ SyntaxError：私有字段只能类内访问

// 方式三：存取器 —— 把赋值变成受控操作
class Temp {
  #c = 0
  set celsius(v) { if (v < -273.15) throw new Error('低于绝对零度'); this.#c = v }
  get celsius() { return this.#c }
}
```

### 3. 继承：原型链是底座，extends 是语法糖

```javascript
// 寄生组合式继承（面经示例的真实身份——它不是"原型链继承"）
function Animal(name) { this.name = name }
Animal.prototype.sayName = function () { return `My name is ${this.name}` }

function Dog(name, breed) {
  Animal.call(this, name)             // ① 借构造函数：继承实例属性
  this.breed = breed
}
Dog.prototype = Object.create(Animal.prototype) // ② 只借原型，不执行父构造
Dog.prototype.constructor = Dog                  // ③ 修正 constructor 指回子类
Dog.prototype.bark = function () { return 'Woof!' }

const dog = new Dog('Buddy', 'Labrador')
dog.sayName() // 'My name is Buddy'（来自父类原型）
dog instanceof Animal // true

// ES6 等价写法
class Animal2 {
  constructor(name) { this.name = name }
  sayName() { return `My name is ${this.name}` }
}
class Dog2 extends Animal2 {
  constructor(name, breed) {
    super(name)                      // 必须先 super() 拿到父类构造的 this
    this.breed = breed
  }
  bark() { return 'Woof!' }
}
```

> 注意：面经把上面第一段标成"原型链继承"其实不准确——纯原型链继承是 `Dog.prototype = new Animal()`；示例用了 `Animal.call(this)` + `Object.create`，是**寄生组合式继承**（标准最优解），演进细节见原型链专题页。

### 4. 多态：同一消息，不同响应

```javascript
// ① 方法重写 + 动态派发：调用同一个方法名，执行到各自实现
class Animal { makeSound() { return 'Some generic sound' } }
class Dog extends Animal { makeSound() { return 'Woof!' } }
class Cat extends Animal { makeSound() { return 'Meow!' } }

const animals = [new Animal(), new Dog(), new Cat()]
animals.forEach(a => console.log(a.makeSound()))
// 'Some generic sound' / 'Woof!' / 'Meow!' —— 运行时沿实例原型链找到各自版本

// ② 鸭子类型：不关心类型，只关心"有没有这个方法"
function makeSound(animal) { animal.sound() } // 有 sound() 就能传，无需继承同一父类
makeSound({ sound: () => console.log('Woof!') })  // Woof!
makeSound({ sound: () => console.log('Meow!') })  // Meow!

// ③ "重载"模拟：JS 同名函数后定义覆盖前者，没有编译期重载，只能运行时判参
class Calc {
  add(...args) {
    if (args.length === 1) return args[0] * args[0]      // 单参：平方
    return args.reduce((a, b) => a + b, 0)               // 多参：求和
  }
}
```

## 面试答法

### 30 秒版本（可直接背诵）

> JS 支持面向对象但没有 Java 那套关键字，三大特征各有落地方式。封装靠闭包把私有变量藏进作用域只暴露方法，或用 class 的 # 私有字段做运行时强制私有，再用 get/set 存取器收口读写校验。继承底座是原型链，最优手写是寄生组合式——Object.create 借父类原型再修正 constructor，配合父构造 call(this) 拿实例属性；ES6 的 extends 就是这套写法的语法糖。多态靠方法重写：子类覆写同名方法，运行时沿实例原型链动态派发到各自实现；JS 没有接口，鸭子类型也实现多态——不看类型只看有没有方法。重载 JS 不原生支持，只能 arguments.length 或类型判断模拟。

### 深入展开

1. **封装三档**：`_` 约定（伪私有）→ 闭包（真私有，配合模块模式）→ `#` 字段（语言级）→ 存取器加校验
2. **继承演进**：原型链继承（引用共享）→ 构造函数继承（方法不复用）→ 组合（执行两次）→ 寄生组合（标准答案）→ extends；纠正面经对示例代码的归类
3. **多态本质**：同一接口不同实现，JS 的动态派发 = 属性查找沿原型链走到"谁调用取谁的原型方法"
4. **鸭子类型**："走起来像鸭子就是鸭子"，无继承耦合，是 JS/TS 结构化类型的思想源头
5. **收尾**：JS 是原型为核、class 为壳——三大特征最终都落在原型链和动态查找上

### 常见追问

- **JS 有真正的私有吗？** → 有，`#` 私有字段是运行时强制的，外部访问直接语法错误；老方案用闭包或 WeakMap 模拟
- **JS 支持函数重载吗？** → 不支持，同名函数后定义覆盖前者；TS 有重载签名但运行时仍要判参；模拟靠 arguments.length/typeof 分支
- **extends 和 Parent.call(this) 的核心区别？** → extends 同时继承实例成员、原型成员和**静态成员**，且子类 this 由父类构造产生，必须先 super()
- **多态和 this 指向有什么关系？** → 重写方法靠"谁调用"把 this 绑到实例，再沿该实例原型链找到最具体的实现，二者共同完成动态派发
- **super 在方法里和构造函数里作用分别是什么？** → 构造里 super() 执行父构造拿到 this；方法里 super.m() 从父类原型开始查找，跳过当前类的重写
