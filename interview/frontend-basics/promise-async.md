# Promise 状态机与 async/await 原理

## 题目

> Promise 有几种状态，状态能不能变回去？手写一个简化的 then / Promise.all。链式调用时 then 的返回值有几种情况？下面这段代码输出顺序是什么（宏微任务题）？async/await 的本质是什么，和 Generator 什么关系？

## 为什么需要

回调写法解决异步，但带来"回调地狱"：逻辑被切碎、错误要每层单独处理、结果无法用返回值传递。Promise 把异步抽象成一台**状态机**：先给你一个"凭证"（pending），事成了 resolve，事败了 reject，之后随时可以 then 订阅结果——异步代码第一次有了"对象化的结果"。

## 核心要点

### 1. 状态流转图（单向、不可逆）

```
                    resolve(value)
        ┌────────────────────────────────► fulfilled
   pending                                    （✅ 已兑现）
        │
        │           reject(reason)
        └────────────────────────────────► rejected
                                            （❌ 已拒绝）

规则：
① 只有三种状态，pending 是起点，fulfilled/rejected 是终点
② 状态一旦改变不可逆：fulfilled 后再 reject 无效
③ 状态改变后，值就固定了，后续 then 拿到的永远是那个值
```

### 2. 手写简化版 Promise（then + 回调队列）

```javascript
class MyPromise {
  constructor(executor) {
    this.status = 'pending'
    this.value = undefined
    this.onResolved = []            // pending 期间把 then 的回调先存起来
    this.onRejected = []
    const resolve = v => {
      if (this.status !== 'pending') return
      this.status = 'fulfilled'; this.value = v
      this.onResolved.forEach(fn => fn())
    }
    const reject = e => {
      if (this.status !== 'pending') return
      this.status = 'rejected'; this.value = e
      this.onRejected.forEach(fn => fn())
    }
    try { executor(resolve, reject) } catch (e) { reject(e) }
  }
  then(onFulfilled, onRejected) {
    return new MyPromise((resolve, reject) => {   // 返回新 Promise → 链式
      const fulfilled = () => setTimeout(() => {  // 异步化 + 错误穿透
        try {
          const ret = onFulfilled(this.value)
          ret instanceof MyPromise ? ret.then(resolve, reject) : resolve(ret)
        } catch (e) { reject(e) }
      })
      const rejected = () => setTimeout(() => {
        try {
          const ret = onRejected(this.value)
          ret instanceof MyPromise ? ret.then(resolve, reject) : resolve(ret)
        } catch (e) { reject(e) }
      })
      if (this.status === 'fulfilled') fulfilled()
      else if (this.status === 'rejected') rejected()
      else { this.onResolved.push(fulfilled); this.onRejected.push(rejected) }
    })
  }
}
```

（完整版还要处理 then 回调本身是"类 thenable 对象"的递归解包，面试写到这个程度即可。）

### 3. 链式调用返回值三规则

```
p.then(v => { ... return X }) 中 X 的三种去向：

① X 是普通值/Promise 之外 → 下一个 then 直接收到 X
② X 是 Promise          → 下一个 then 等这个 Promise 出结果再拿值
③ X 是抛出的错误         → 跳过后续成功回调，直达最近的 catch

       .then(A)          .then(B)          .catch(C)
p ──►  return 1   ────►  return 报错 ────►  收到错误
       收到 1            （B 不再执行）      C 兜底
```

### 4. 宏任务 / 微任务经典例题（带推演）

```javascript
console.log(1)
setTimeout(() => console.log(2), 0)
Promise.resolve()
  .then(() => console.log(3))
  .then(() => console.log(4))
console.log(5)
// 输出：1 5 3 4 2
```

逐步推演（执行模型：同步栈跑完 → 清空微任务 → 取一个宏任务 → 再清空微任务）：

```
时刻  动作                                微任务队列        宏任务队列     输出
 t1   log(1)                              []              []            1
 t2   setTimeout 注册                      []              [timer2]
 t3   .then(3cb) 入队                      [3cb]           [timer2]
 t4   log(5)                               [3cb]           [timer2]      5
 t5   同步代码结束，开始清微任务：
      执行 3cb → log(3)，其返回值让下一个
      then 的 4cb 入队                     [4cb]           [timer2]      3
 t6   继续清微任务，执行 4cb                []              [timer2]      4
 t7   微任务空了，取宏任务 timer2 → log(2)  []              []            2

口诀：同步先跑；微任务（then/queueMicrotask）在每条宏任务结束后立即清空；
      setTimeout/Promise 是"注册时机"决定入队顺序，不是执行时机。
```

### 5. async/await 本质 = Generator + 自动执行器

```javascript
async function main() {
  const a = await queryA()
  const b = await queryB(a)
  return b
}

// 完全等价于 ↓
function* gen() {
  const a = yield queryA()     // yield ≈ await：交出 Promise，函数在此挂起
  const b = yield queryB(a)
  return b
}
const it = gen()
function step(val) {                       // 自动执行器 ≈ async 语法糖本身
  const { value, done } = it.next(val)     // 把上一个结果塞回去继续执行
  if (done) return value
  value.then(v => step(v), e => it.throw(e))  // 微任务里恢复执行
}
step()
```

```
await 挂起的真相：
await p 之后 → 把"await 后面的代码"注册成 p.then 的回调（微任务）
            → 当前函数立即 return，让出主线程
            → p 兑现时，回调作为微任务恢复函数执行
所以：async 函数返回的 Promise 永远 pending，直到遇到第一个 await
```

### 6. 组合器语义表 + 手写 all

| 方法 | 成功条件 | 失败行为 | 结果形态 |
| --- | --- | --- | --- |
| `Promise.all` | 全部 fulfilled | **任一 reject 立即 reject** | 按入参顺序的值数组 |
| `Promise.race` | 第一个改变状态 | 同左（谁先到听谁的） | 单个值/原因 |
| `Promise.allSettled` | 永远 fulfilled | 不 reject | `{status, value/reason}` 数组 |
| `Promise.any` | 第一个成功 | 全失败才 AggregateError | 单个值 |

```javascript
Promise.all = function (list) {
  return new Promise((resolve, reject) => {
    const res = []
    let count = 0
    list.forEach((p, i) => {
      Promise.resolve(p).then(
        v => { res[i] = v                       // 按索引写 → 保证顺序
               if (++count === list.length) resolve(res) },
        e => reject(e)                          // 一个失败立刻整体失败
      )
    })
  })
}
```

## 面试答法

### 30 秒版（可背诵）

> Promise 是异步的结果凭证，一台三态状态机：pending 只能单向变成 fulfilled 或 rejected，变了就不可逆、值就固定。then 返回新 Promise 所以能链式，回调里 return 普通值下一个 then 直接收到，return Promise 会被等待，抛错就跳到最近的 catch。async/await 是 Generator 加自动执行器的语法糖：await 相当于 yield 交出 Promise 并挂起函数，后面的代码被注册成 then 回调，在微任务里恢复执行。执行顺序题记住：同步代码先跑，每条宏任务结束后清空微任务队列。

### 深入版（被追问时按编号展开）

1. **状态机**：画三态图，强调单向不可逆、值固定
2. **手写 then**：pending 时回调入队；resolve 后依次出队；then 返回新 Promise 实现链式；ret 是 Promise 就继续 then 解包
3. **链式三规则**：普通值 / Promise / 抛错 三条去向
4. **输出顺序题**：现场画"微任务队列 / 宏任务队列"两列，逐步推演 1 5 3 4 2
5. **async 本质**：写 Generator + step 执行器的等价代码，讲清 await = 把后续代码挂成微任务
6. **组合器**：all 的"全成才成、一败即败、结果保序"，race 的"先到先得"，allSettled 的"永不 reject"

### 常见追问

- **then 的两个回调和 catch 有什么区别？** → `then(onF, onR)` 的 onR 只能捕获**上游**的失败；`catch` 还能捕获 onF 自己抛的错，且链式更清晰
- **await 暂停的是什么？** → 只暂停当前 async 函数，不阻塞主线程；函数外的同步代码继续跑
- **`await` 后面是普通值会怎样？** → 也会被 `Promise.resolve` 包一层，仍然走微任务，所以 `await 1` 之后的代码也要等一个微任务
- **微任务无限递归会饿死宏任务吗？** → 会，这是经典坑：不断 then 自己，setTimeout 永远轮不到执行
- **new Promise 里 executor 是同步还是异步执行？** → 同步立即执行；async 函数返回的 Promise 在遇到第一个 await 前也是同步执行
