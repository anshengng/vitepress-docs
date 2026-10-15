# 闭包与 this 指向

## 题目

> 什么是闭包？闭包有哪些应用场景和副作用？`this` 的指向规则是什么？

## 核心要点

### 闭包

```javascript
function outer() {
  let count = 0
  return function inner() {
    count++          // 访问了外层函数的变量
    return count
  }
}
const fn = inner()   // inner 就是闭包
```

- 闭包 = 函数 + 其词法作用域的引用
- 场景：防抖节流、模块化（IIFE）、柯里化、缓存（memoize）
- 副作用：被引用的变量无法回收，可能造成内存泄漏

### this 指向四条规则（优先级从高到低）

1. **new 绑定**：`new Fn()` → this 指向新对象
2. **显式绑定**：`call / apply / bind` 指定
3. **隐式绑定**：`obj.fn()` → this 指向 obj
4. **默认绑定**：独立调用，严格模式为 undefined，否则为 window

箭头函数没有自己的 this，沿词法作用域向外查找。

## 面试答法

（待补充：组织 30 秒版本 + 深入版本）
