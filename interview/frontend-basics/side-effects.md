# 副作用（Side Effects）

## 为什么需要

"纯函数 + 副作用集中管理"是函数式编程、React Hooks、Vue 响应式设计的共同底座：为什么 `useEffect`/`watchEffect` 要把请求和订阅从渲染里拆出去、为什么组件渲染函数要求纯，答案都在副作用概念里。面试借它考察你对可测试性、可预测性和框架设计动机的理解。

## 核心要点

### 1. 定义

**副作用**：一个函数除了"根据输入返回输出"之外，还**修改了外部可变状态**，或**依赖了外部可变状态**——即函数的行为影响了可观察世界，或可观察世界影响了函数的结果。

### 2. 纯函数 vs 有副作用的函数

| 维度 | 纯函数 | 有副作用的函数 |
| --- | --- | --- |
| 同输入同输出 | 恒成立 | 不保证（依赖外部状态） |
| 修改外部状态 | 完全不修改 | 会修改（变量/DOM/存储/网络） |
| 可测试性 | 不用 mock，直接断言 | 需要 mock 环境 |
| 可缓存/可记忆化 | 安全（memoize 有效） | 缓存会读到过期结果 |
| 示例 | `a + b`、`map/filter` 的回调 | `fetch`、`console.log`、`arr.sort()` |

```javascript
// 无副作用：只依赖参数，只返回结果
const add = (a, b) => a + b

// 有副作用的几种形态
let total = 0
function accumulate(x) { total += x }        // ① 修改外部变量
function log(x) { console.log(x); return x } // ② I/O 输出
function read() { return localStorage.getItem('k') } // ③ 依赖外部状态
function sortIt(arr) { return arr.sort() }   // ④ 修改了传入参数（也是副作用！）
```

### 3. 常见副作用清单（面经 + 补全）

| 类别 | 例子 | 风险 |
| --- | --- | --- |
| 数据获取 | fetch/axios 后更新组件状态 | 竞态、重复请求 |
| DOM 操作 | document 修改、jQuery 插件 | 与框架渲染冲突 |
| 事件监听 | addEventListener 订阅 | 忘解绑 → 内存泄漏 |
| 定时器 | setTimeout / setInterval | 忘 clear → 回调持有闭包 |
| 订阅 | WebSocket、Vuex/Store 订阅 | 不取消订阅 → 泄漏 |
| 持久化 | localStorage、Cookie 写入 | 隐式依赖外部存储 |
| 抛错/随机/时间 | throw、Math.random、Date.now | 破坏确定性 |

### 4. 框架里的副作用管理

```javascript
// Vue 3：渲染外集中声明副作用
import { onMounted, onUnmounted, watchEffect } from 'vue'
onMounted(() => {
  window.addEventListener('resize', onResize)   // 副作用：订阅
  const stop = watchEffect(() => fetchData())   // 副作用：数据获取
  onUnmounted(() => {
    window.removeEventListener('resize', onResize) // 清理：防泄漏
    stop()
  })
})

// React 同理：useEffect(() => { 订阅; return () => 清理 }, deps)
```

设计动机：渲染函数会被**反复执行**，把副作用写进渲染体 = 每次重渲染都再请求/再订阅一次。框架把副作用挪进专用钩子/生命周期，换来三件事——**执行时机可控、清理有出口、渲染保持纯**。

### 5. 管理策略（工程实践）

1. 纯核脏边：业务计算写成纯函数，把 IO 推到系统边界（组件钩子、service 层）
2. 集中声明：副作用进 `useEffect`/`watchEffect`/生命周期，不散落在渲染路径
3. 必须配对清理：订阅↔解绑、定时器↔clear，防内存泄漏
4. 依赖注入：需要外部状态时作参数传入，便于测试与 mock

## 面试答法

### 30 秒版本（可直接背诵）

> 副作用指函数除了返回值之外，还改变或依赖了外部可变状态——改全局变量、操作 DOM、发请求、起定时器、加事件监听、写 localStorage，甚至修改传入的数组对象，都算。纯函数是同输入必同输出且零副作用的函数，可测试、可缓存。框架把副作用集中管理正是基于这一点：React 的 useEffect、Vue 的 watchEffect 和 onMounted，因为渲染函数会被反复执行，副作用写在里面会重复触发，抽到专用钩子后执行时机可控、卸载时统一清理，避免内存泄漏。实践原则就是纯核脏边、集中声明、配对清理。

### 深入展开

1. **定义拆两半**：改外部状态（写）+ 依赖外部状态（读）都算副作用
2. **对比纯函数**：同输入同输出、无修改 → 可测试、可 memoize
3. **清单展开**：数据获取/DOM/事件/定时器/订阅五类，各点一个风险
4. **修改参数也是副作用**：`arr.sort()` 原地改传入对象，引出"返回新数组"的 map/filter 更纯
5. **框架动机**：渲染反复执行 → 副作用必须挪进 effect 钩子，配清理函数
6. **收尾**：纯核脏边 + 依赖注入的架构意义

### 常见追问

- **console.log 算副作用吗？** → 算，产生了外部可观察的 I/O 输出
- **修改函数参数算副作用吗？** → 算，参数指向的外部对象被改变了；所以推荐返回新值而非原地改
- **为什么不能在组件渲染时直接发请求？** → 渲染会重复执行导致重复请求，且结果异步回写 state 又触发重渲染，可能死循环；应放进 effect/生命周期
- **useEffect 返回的函数是干什么的？** → 清理函数：组件卸载或下次 effect 执行前解绑事件、清定时器，防内存泄漏
- **纯函数和不可变数据什么关系？** → 不修改外部状态的前提常靠不可变数据保证：拷贝后操作，杜绝一改俱改
