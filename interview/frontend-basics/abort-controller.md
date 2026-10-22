# AbortController 取消请求

## 题目

> fetch 怎么取消请求？AbortController 的原理是什么？怎么实现超时？搜索框输入时的请求竞态怎么解决？组件卸载时怎么清理未完成的请求？和 axios 的 CancelToken 什么关系？

## 为什么需要

取消请求有三个绕不开的真实场景：**搜索框快速输入**（慢的旧响应回来后覆盖新结果，界面错乱）、**超时控制**（fetch 原生没有 timeout 参数）、**组件卸载**（请求还在飞，回来后对已销毁组件赋值造成泄漏或报错）。AbortController 是浏览器给出的统一取消标准——fetch、事件监听、定时器都能挂在同一个 signal 上一起停。

类比：点单。AbortController 是那张"订单"，signal 是订单上的"撤单开关"——按下撤单，所有正在执行这条订单的人（网络请求、定时器、事件监听）同时看到开关并停手。

## 核心要点

### 1. 基本用法：controller + signal + abort

```javascript
const controller = new AbortController()
const { signal } = controller            // signal 是交给 fetch 的"撤单回执"

fetch('/api/data', { signal })
  .then(res => res.json())
  .catch(err => {
    if (err.name === 'AbortError') return   // 取消不是故障，静默吞掉
    throw err
  })

setTimeout(() => controller.abort(), 3000)   // 3 秒后主动取消
```

```
时间线：
t0 fetch 发出 ──── 请求在途 ────────────────────────►
t3 controller.abort()
   │ signal.aborted 变 true，派发 'abort' 事件
   ▼
fetch 的 Promise reject：DOMException { name: 'AbortError' }
TCP 层断开/丢弃响应
⚠️ 服务端可能仍在继续处理——取消是客户端"不听回答"，不是让服务端"撤回动作"
```

### 2. 超时：AbortSignal.timeout 与 AbortSignal.any

```javascript
// 现代一行式：超时自动 abort
fetch(url, { signal: AbortSignal.timeout(5000) })

// 组合多个取消来源：手动取消 + 超时 同时生效
const ctrl = new AbortController()
const signal = AbortSignal.any([ctrl.signal, AbortSignal.timeout(5000)])
fetch(url, { signal })
// AbortSignal.any 需 Chromium 116+ / Safari 17.4+；
// 兼容旧环境：手动监听各来源，任一 abort 时转发给统一的 controller
```

### 3. XHR 取消：不认 signal，手动桥接

```javascript
// XMLHttpRequest 不接受 signal 参数，用 abort 事件桥接
function bindSignal(xhr, signal) {
  if (signal.aborted) { xhr.abort(); return }      // 已取消则直接不发了
  signal.addEventListener('abort', () => xhr.abort())
}
const ctrl = new AbortController()
const xhr = new XMLHttpRequest()
bindSignal(xhr, ctrl.signal)
xhr.open('GET', '/api')
xhr.send()
```

### 4. 请求竞态：搜索框取消旧请求（最高频场景）

```
不取消：
  输入 "v"   ──► 请求 A（慢）──────────────────► A 最后返回 ✗ 覆盖了新结果
  输入 "vi"  ──► 请求 B（快）──► B 先返回 ✓
  → 屏幕显示的却是 "v" 的旧结果，错乱！

取消后：
  输入 "v"   ──► A 在途
  输入 "vi"  ──► abort A，发出 B ──► B 返回 ✓ 永远只有最新一次的结果
```

```javascript
let ctrl = null
input.addEventListener('input', async (e) => {
  ctrl?.abort()                          // 先撤上一条订单
  ctrl = new AbortController()
  try {
    const res = await fetch(`/search?q=${encodeURIComponent(e.target.value)}`,
                            { signal: ctrl.signal })
    render(await res.json())
  } catch (err) {
    if (err.name !== 'AbortError') showError(err)   // 只上报真实错误
  }
})
```

### 5. 组件卸载清理（Vue 3）

```javascript
// setup 中：卸载时统一 abort，防止对已销毁组件赋值 / 内存泄漏
const ctrl = new AbortController()
onMounted(() => {
  fetch('/api/list', { signal: ctrl.signal })
    .then(r => r.json())
    .then(data => (list.value = data))
    .catch(e => { if (e.name !== 'AbortError') console.error(e) })
})
onUnmounted(() => ctrl.abort())
// React 对应写法：useEffect 的清理函数里 ctrl.abort()
```

### 6. 与 axios 取消方案对比

| 方案 | 用法 | 状态 |
| --- | --- | --- |
| AbortController（推荐） | `axios.get(url, { signal })` | axios 0.22+ 支持，与 fetch 统一 |
| CancelToken | `new axios.CancelToken(source => ...)` | ❌ 已弃用，仅为兼容保留 |
| 错误判定 | `axios.isCancel(err)` | 区分"被取消"与真实网络错误 |

## 面试答法

### 30 秒版（可背诵）

> fetch 本身没有取消方法，标准方案是 AbortController：new 一个 controller，把它的 signal 传给 fetch，调用 controller.abort() 后在途请求的 Promise 会以 AbortError 被拒绝。三个典型用途：一是超时，AbortSignal.timeout(5000) 一行搞定，或者 setTimeout 里手动 abort；二是搜索框请求竞态，每次新输入先 abort 上一个 controller 再发新请求，防止慢的旧响应回来覆盖新结果；三是组件卸载清理，onUnmounted 或 useEffect 清理函数里 abort，避免对已销毁组件赋值和内存泄漏。XHR 不原生支持 signal，监听 abort 事件手动调 xhr.abort()。axios 0.22 之后直接支持 signal，老的 CancelToken 已弃用。另外要清楚：abort 只是客户端不再接收，服务端可能仍在执行，所以有副作用的接口仍需幂等设计。

### 深入版（被追问时按编号展开）

1. **讲原理图**：signal 是"撤单开关"，abort 置 aborted + 派发事件，fetch 以 AbortError 拒绝
2. **超时两种写法**：AbortSignal.timeout 一行式；AbortSignal.any 组合手动+超时，兼容性降级方案
3. **竞态场景画图**：A 慢 B 快 → 不取消则 A 覆盖 B；每输入先 abort 旧请求
4. **XHR 桥接**：bindSignal 监听 abort 事件调 xhr.abort()
5. **框架清理**：Vue onUnmounted / React useEffect return 里 abort
6. **axios 对比**：signal 推荐、CancelToken 弃用、isCancel 判定
7. **收尾边界**：取消≠服务端回滚，强调幂等；AbortError 要在 catch 里单独吞掉

### 常见追问

- **abort 了服务端会停止执行吗？** → 不会，只是客户端断开不再接收；服务端事务可能已完成 → 有副作用的接口要靠幂等键兜底
- **signal.aborted 是什么？** → 只读布尔，abort 后永久为 true，单向开关不可撤销；新代码可先判断它再决定是否发请求
- **一个 signal 能给多个请求共用吗？** → 能，abort 时所有挂它的请求一起取消；还能给 addEventListener('x', fn, { signal }) 自动解绑事件
- **AbortError 和其他错误怎么区分？** → 看 err.name === 'AbortError'；catch 里不区分会把"用户主动取消"当故障上报，制造假告警
- **AbortSignal.timeout 和 setTimeout+abort 的区别？** → 前者由浏览器托管、语义清晰；后者 controller 归你管，可与手动取消合并到同一 signal（AbortSignal.any）
- **EventSource/流式响应能取消吗？** → 能，都接受 signal；abort 会同时终止 SSE 连接和 fetch 的 ReadableStream 读取
