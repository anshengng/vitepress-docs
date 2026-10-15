# 事件循环（Event Loop）

## 题目

> 描述 JavaScript 的事件循环机制，宏任务与微任务的执行顺序是怎样的？

## 核心要点

```
调用栈清空
   ↓
执行全部微任务（microtask queue）
   ↓
取一个宏任务（macrotask）执行
   ↓
再清空微任务 → 循环
```

- **宏任务**：script 整体、setTimeout、setInterval、I/O、UI 渲染
- **微任务**：Promise.then/catch/finally、queueMicrotask、MutationObserver

经典输出顺序题：

```javascript
console.log(1)
setTimeout(() => console.log(2))
Promise.resolve().then(() => console.log(3))
console.log(4)
// 1 4 3 2
```

## 面试答法

（待补充：组织 30 秒版本 + 深入版本）
