# 页面间通信方式全景

## 为什么需要

现代前端到处都是"两个页面要对话"：主站嵌第三方支付 iframe、多标签页同步登录态/购物车、页面等服务器推消息。但浏览器的**同源策略和进程隔离**让这些对话每一步都不简单——每种通信方式都有自己的作用边界（同源/跨域、同标签/跨标签、页面/服务器），选错工具轻则功能失效，重则留下安全洞（postMessage 不校验 origin 是经典事故）。这题考的是**按场景选型**的能力，而不是背 API。

相关背景可交叉参考：[跨域方案](/interview/frontend-basics/cross-domain)、[HTTP 与 Socket 的区别](/interview/frontend-basics/http-vs-socket)、[浏览器存储 API](/interview/frontend-basics/storage-apis)。

## 核心要点

### 0. 先按"谁和谁说话"分类

```
通信双方是谁？
├─ 父页面 ↔ iframe（同一页面内）
│     ├─ 同源   ──► contentWindow 直接调用
│     └─ 跨域   ──► postMessage
├─ 标签页 ↔ 标签页（同源）
│     ──► storage 事件 / BroadcastChannel / SharedWorker
├─ 页面 ↔ 服务器（推送）
│     ──► WebSocket / SSE / 长轮询
└─ 页面 ↔ 页面（共享数据，不是消息）
      ──► Cookie（同域） / IndexedDB（同源） + navigator.locks
```

### 1. 父页面与 iframe

**同源：直接调用**。父页面通过 `iframe.contentWindow` 拿到子窗口对象，子页面通过 `window.parent` 拿父窗口，两边可以互调函数、互读 DOM——同源意味着共享同一套 JS 运行环境，没有任何限制。

**跨域：只能 postMessage**。双方碰不到对方的任何属性（被同源策略拦截），只能传递"可序列化的数据"（结构化克隆算法，函数和 DOM 引用传不了）。

```js
// ===== 父页面（https://shop.example.com）=====
const frame = document.querySelector('#payFrame').contentWindow
// 第二个参数 targetOrigin：明确指定"这条消息只允许谁收到"，绝不要写 '*'
frame.postMessage({ type: 'QUERY_ORDER', orderId: 'A1001' },
                  'https://pay.example.com')

// ===== 子页面 iframe（https://pay.example.com）=====
window.addEventListener('message', (e) => {
  // 安全校验三件套：① 发送方源 ② 消息结构 ③ 类型白名单
  if (e.origin !== 'https://shop.example.com') return
  if (e.data?.type !== 'QUERY_ORDER') return

  const result = { type: 'ORDER_RESULT', status: 'paid' }
  // e.source 是发送方的 window 引用，e.origin 是其源，原路回信
  e.source.postMessage(result, e.origin)
})
```

**安全注意**：发送端不写 `'*'`（防数据发给被劫持/替换的页面）；接收端必须校验 `e.origin`（否则任何网站都能嵌你的 iframe 伪造消息触发逻辑）；消息体要有类型约定，不信任字段内容。

### 2. 多标签页同步

**方式一：localStorage 的 storage 事件**。一个标签页改 localStorage，其他同源标签页收到 `storage` 事件。坑：**写入的标签页自己收不到事件**，且它本质是"数据变更才触发"，只能同步增量、不能同步历史。

```js
// 每个标签页都监听：另一页登出（清掉 token）时本页同步登出
window.addEventListener('storage', (e) => {
  // e.key 变更的键，e.newValue 新值（删除时为 null）
  if (e.key === 'token' && e.newValue === null) {
    location.reload()
  }
})
```

**方式二：BroadcastChannel**。专为同源多标签广播设计的通道，语义比 storage 事件清晰，消息不落盘、容量不受 localStorage 限制。

```js
// 每个标签页创建同名频道（同源页面均可加入）
const bc = new BroadcastChannel('cart-sync')

// 接收同频道其他标签页的消息（发送者自己收不到）
bc.onmessage = (e) => {
  console.log('收到:', e.data) // { type: 'ADD_ITEM', id: 3 }
}

// 广播给同频道其他标签页
bc.postMessage({ type: 'ADD_ITEM', id: 3 })

bc.close() // 不用时关闭，释放端口
```

**方式三：SharedWorker**。被所有同源标签页**共享的一个 worker 线程**，每个标签页通过 MessagePort 与它通信。它是唯一能"跨标签共享一条线程"的方式，可维护共享状态、做集中计算、仲裁连接（如多页共用一条 WebSocket），但开发调试成本高，实际使用少。

### 3. 页面 ↔ 服务器推送

| 维度 | 长轮询 | SSE | WebSocket |
| --- | --- | --- | --- |
| 通信方向 | 客户端每次发起（服务端"假装"推） | 服务端 → 客户端单向 | 全双工双向 |
| 延迟 | 高（每轮都要重新发请求） | 低（长连接即时下发） | 最低 |
| 协议 | HTTP | HTTP（`text/event-stream`） | 独立 `ws://` / `wss://`（先 HTTP 握手一次再 Upgrade 切换） |
| 自动重连 | 业务层自己做 | 浏览器内建（带 `Last-Event-ID` 续传） | 业务层自己做 |
| 二进制数据 | ❌ | ❌ 仅文本 | ✅ |
| 服务端成本 | 高（连接多、握手多） | 低 | 中（有状态，需管理连接池） |
| 典型场景 | 老环境兜底 | 通知流、LLM 流式输出 | 即时聊天、协同编辑、在线游戏 |

选型口诀：**服务端只推、客户端只听 → SSE**（轻量、自动重连、复用 HTTP 生态与鉴权）；**双向高频 → WebSocket**；两者协议层的本质差异见 [http-vs-socket](/interview/frontend-basics/http-vs-socket)。`wss://` 即 WebSocket over TLS，证书体系同 HTTPS（[tcp-https](/interview/frontend-basics/tcp-https)）。

### 4. 数据共享（共享"状态"而非传"消息"）

- **Cookie**：同域（可按 `Domain` 扩到子域）下所有标签页与请求自动共享，天然的跨标签小存储，但约 4KB 且每次请求都携带——细节见 [storage-apis](/interview/frontend-basics/storage-apis)。
- **IndexedDB + navigator.locks**：同源所有标签页共享同一个数据库，大容量异步；多标签并发写同一份数据时用跨标签互斥锁仲裁"读-改-写"的原子性：

```js
// 跨标签互斥：同一时刻只允许一个标签页进入临界区
await navigator.locks.request('write-cart', async () => {
  const cart = await readCartFromIndexedDB() // 读
  cart.items.push(newItem)                   // 改
  await writeCartToIndexedDB(cart)           // 写：整段对其他标签页原子
})
```

### 5. 对比总表

| 方式 | 适用场景 | 能否跨域 | 是否需服务端 |
| --- | --- | --- | --- |
| contentWindow 直接调用 | 父子 iframe，同源 | ❌ | ❌ |
| postMessage | 任意窗口间（含跨域 iframe、`window.open` 弹窗） | ✅ | ❌ |
| storage 事件 | 同源标签页同步小 KV | ❌ | ❌ |
| BroadcastChannel | 同源标签页实时广播 | ❌ | ❌ |
| SharedWorker | 标签页间共享线程/状态 | ❌（同源） | ❌ |
| WebSocket | 页面 ↔ 服务器双向实时 | ✅（服务端自行校验 Origin） | ✅ |
| SSE | 服务器 → 页面单向流 | ✅（服务端自行校验） | ✅ |
| 长轮询 | 兜底推送 | ✅ | ✅ |
| Cookie | 同域共享状态、登录凭证 | ❌（按域规则） | ✅（自动随请求携带） |
| IndexedDB + locks | 同源大数据共享、跨标签仲裁 | ❌ | ❌ |

## 面试答法

### 30 秒版本

> 先分四类场景。同页父子 iframe：同源直接拿 contentWindow 互调方法读 DOM；跨域只能 postMessage，发送时指定 targetOrigin、接收时校验 e.origin，两边都做安全检查。多标签页同步：localStorage 的 storage 事件（写的那页自己收不到）、BroadcastChannel 做同源实时广播、SharedWorker 是唯一能跨标签共享一条线程的方式。页面与服务器：WebSocket 全双工、SSE 服务端单向且浏览器内建自动重连、长轮询兜底。共享数据层面：Cookie 同域自动共享，IndexedDB 同源共享，用 navigator.locks 做跨标签互斥防并发写冲突。

### 深入展开

1. **先画场景四分树再展开**——展示选型思维，而不是罗列 API。
2. **postMessage 安全三件套**：targetOrigin、origin 校验、消息类型白名单；补一句 `e.source` 用于原路回信、结构化克隆传不了函数和 DOM。
3. **storage 事件两个坑**：写入方收不到自己的事件；只在"变更瞬间"通知，新开的标签页要主动读一次做初始化。
4. **BroadcastChannel vs storage 事件**：BC 是内存广播、不落盘、语义清晰；storage 本质是"数据变更的副作用"，适合"改了才同步"的场景。
5. **SharedWorker 定位**：共享线程 → 可做连接池（多页共用一条 WebSocket）、全局节流/计数；但调试难、Safari 支持晚，所以少用。
6. **推送三件套对比表**按方向/延迟/协议/自动重连四行讲，重点：SSE 的 `Last-Event-ID` 断线续传是 WebSocket 需要自己造的轮子。
7. **navigator.locks 落地例**：多标签同时改购物车，读-改-写包进锁里保证原子；没有 locks 时用 localStorage 租约锁兜底（有时间窗竞态，不如 locks 可靠）。

### 常见追问

- **postMessage 算"真正的跨域通信"吗？** → 只传可序列化数据，不打通 JS 环境；且接收端必须主动校验 origin，否则等于开着的门——它提供通道，安全靠你自己。
- **为什么写 localStorage 的标签页收不到 storage 事件？** → 规范设计如此：写入方自己知道改了什么，事件只通知其他标签页；若要统一处理，写完自己广播一次。
- **LLM 打字机效果为什么用 SSE 不用 WebSocket？** → 单向推送够用；SSE 是纯 HTTP，不需要协议升级，网关/代理/鉴权体系全部兼容，还自带断线重连与事件续传。
- **WebSocket 受同源策略限制吗？** → 握手请求不受 CORS 约束，浏览器会带 Origin 头，但**是否接受由服务端自己校验决定**——不校验 Origin 就会遭遇跨站 WebSocket 劫持（CSWSH）。
- **BroadcastChannel 能跨浏览器窗口吗？** → 能，只要同源；不同窗口、不同标签都行。但隔离的存储上下文（不同 profile、无痕窗口）之间不通。
- **同源的两个 iframe 之间怎么通信？** → 都通过父页面中转最稳；或两者各自 postMessage 给父页，由父页转发。直接互访 `window.frames` 需同一顶层文档树且同源。
- **多标签共享一条 WebSocket 怎么做？** → SharedWorker 持有连接，各标签页用 MessagePort 收发；或简化为 leader 选举（一个标签页当 leader 持连接，用 BroadcastChannel 转发）。
