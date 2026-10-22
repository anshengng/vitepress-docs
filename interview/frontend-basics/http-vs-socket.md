# HTTP 与 Socket 通信的区别

## 题目

> HTTP 通信和 Socket 通信有什么区别？为什么 HTTP 做不了服务器主动推送？WebSocket 和 HTTP 是什么关系？握手升级是怎么发生的？哪些场景该用哪个？

## 为什么需要

这道题的隐藏考点是**层次感**：很多人把 HTTP、TCP、Socket、WebSocket 搅成一团。先立框架——**HTTP 规定"说什么、怎么说"（应用层报文格式），Socket 规定"电话机怎么接"（传输层的编程接口），WebSocket 是接上电话后换一套更省话的"对讲规矩"（另一个应用层协议）**。讲清三层关系，再谈通信模式差异和升级握手，就是满分结构。

## 核心要点

### 1. 通信模式对比

```
HTTP：请求-响应，客户端驱动，服务器"不请不答"
客户端 ──请求──► 服务器
客户端 ◄─响应── 服务器     ← 一问一答即结束；
                              服务器永远无法主动推消息，每次数据都要客户端先"问"
无状态：协议本身不记得上一次交互（登录态靠 Cookie/Token 在应用层自证）

Socket（基于 TCP）：长连接，全双工，双方随时可写
客户端 ◐═══════════► 服务器  ← 连接建立后是两个独立方向的管道，
                              谁有话说就直接写进 socket，无需"请示"
有状态：连接本身就是状态，双方都知道"对方在线"
```

| 维度 | HTTP | Socket / WebSocket |
| --- | --- | --- |
| 通信模式 | 请求-响应，单向发起 | 全双工，双方均可主动推送 |
| 连接形态 | 短连接或 keep-alive 复用（仍一问一答） | 长连接持续在线 |
| 层次 | 应用层标准化协议 | Socket 是访问传输层（TCP/UDP）的 API；WebSocket 是新应用层协议 |
| 报文开销 | HTTP/1.1 头部文本大，每次重复 | WebSocket 帧头仅 2~14 字节 |
| 状态 | 无状态 | 连接即状态 |
| 生态 | 可被浏览器缓存/CDN/代理友好处理 | 原生 TCP 前端不可用；WS 可伪装 80/443 过防火墙 |
| 典型场景 | 网页资源、REST API | 聊天、弹幕、协同编辑、行情、在线游戏 |

### 2. HTTP 被迫模拟"推送"的演进史

```
短轮询   客户端 ──?──► ──?──► ──?──►     最简单，延迟高、空响应浪费
长轮询   客户端 ──?──► 服务器攥着请求不回，
                     有数据才回 ──► 客户端立刻再发下一个   好一些，仍是请求驱动
SSE      一个 HTTP 响应不结束，持续写 text/event-stream    单向推送、自动重连、简单
WebSocket 借 HTTP 握手升级为全双工协议                     真正的答案
```

### 3. WebSocket 握手升级（必须会画）

```
客户端                                       服务器
   │ GET /chat HTTP/1.1                     │
   │ Host: ws.example.com                    │
   │ Upgrade: websocket        ← 请求换协议  │
   │ Connection: Upgrade                     │
   │ Sec-WebSocket-Key: dGhlIHNhbXBsZQ==     │ ← 随机串，非加密非鉴权
   │ Sec-WebSocket-Version: 13               │
   ├───────────────────────────────────────►│
   │                                        │ ① 确认愿意升级
   │ HTTP/1.1 101 Switching Protocols       │ ② Key + 魔法字符串做 SHA-1
   │ Upgrade: websocket                     │    再 base64 → Accept 回显
   │ Connection: Upgrade                     │
   │ Sec-WebSocket-Accept: s3pPLMBiTxaQ...   │
   │◄───────────────────────────────────────┤
   ▼═══ 此后这条 TCP 连接不再说 HTTP，改说 WebSocket 帧 ═══▼
客户端 ◐── 帧(2~14字节头) ══════► 服务器   全双工
```

- **101 是"协议切换"信号**：同一条 TCP 连接，换一套说话规则——这就是"WebSocket 借 HTTP 开门"的准确含义
- **Sec-WebSocket-Key 的作用**：让服务器证明"真的懂 WebSocket"（能算出正确 Accept），防缓存代理误响应、防历史遗留连接，不是安全凭证
- **ws:// 是明文（80 层），wss:// 套 TLS（通常 443）**，对应 http/https 关系
- 心跳：协议自带 ping/pong 帧，但 NAT/代理超时仍需应用层心跳保活、检测半开连接

### 4. 手写最小对照

```javascript
// WebSocket 客户端：建连后双向随时发
const ws = new WebSocket('wss://example.com/chat')
ws.onopen = () => ws.send('hello')            // 我主动推
ws.onmessage = (e) => console.log('服务器推送:', e.data)  // 对方主动推

// Node 原生 TCP socket：双方都能主动 write
const net = require('net')
net.createServer((sock) => {
  sock.on('data', (buf) => sock.write('echo: ' + buf))
}).listen(9000)
```

## 面试答法

### 30 秒版（可背诵）

> 先分层：HTTP 是应用层协议，规定请求-响应报文格式；Socket 是传输层 TCP/UDP 的编程接口，连上后是全双工长连接，双方都能随时主动写数据。HTTP 的"服务器不能主动推"是请求-响应模式决定的，所以实时场景走过轮询、长轮询、SSE，最终方案是 WebSocket：它借一次 HTTP GET 握手，请求头 Upgrade: websocket、Connection: Upgrade，带一个 Sec-WebSocket-Key；服务器算出 Sec-WebSocket-Accept 返回 101 Switching Protocols，之后同一条 TCP 连接上就不再讲 HTTP，改讲只有几字节帧头的 WebSocket 协议，全双工、开销小。网页和 REST 用 HTTP，聊天、行情、协同编辑这类要服务器主动推的用 WebSocket。

### 深入版（被追问时按编号展开）

1. **先立三层框架**：HTTP（协议）/ TCP（传输）/ Socket（API），防止概念混战
2. **画通信模式**：一问一答 vs 双向管道；无状态 vs 连接即状态
3. **推送演进**：轮询→长轮询→SSE→WS，每步解决上一步什么痛点
4. **画握手升级图**：Upgrade/Connection 头、Key→Accept 计算、101 含义
5. **讲 Key 的用途**：不是加密不是鉴权，是"懂行证明"
6. **运维细节**：ws/wss、心跳保活、断线重连由库（socket.io）负责
7. **选型收尾**：能被缓存/CDN 的静态与 CRUD → HTTP；双向低延迟 → WS；单向推送图省事 → SSE

### 常见追问

- **WebSocket 是基于 HTTP 的吗？** → 只借用 HTTP 完成一次握手升级，之后是完全独立的协议（RFC 6455），报文不再是 HTTP 格式
- **浏览器为什么不直接开 TCP？** → 出于安全模型考虑，浏览器不暴露原生 TCP/UDP；WebSocket 是标准化、可过 80/443 的通道
- **HTTP keep-alive 也算长连接，区别在哪？** → keep-alive 只是复用 TCP 管道，通信仍是一问一答串行（HTTP/1.1 有队头阻塞）；WS 升级后两个方向真正独立，服务器可随时写
- **SSE 和 WebSocket 怎么选？** → 只需服务器单向推（通知、进度、行情订阅）且要自动重连、走普通 HTTP 设施 → SSE；需要双向低延迟消息 → WS
- **101 之后还能退回 HTTP 吗？** → 不能，该连接已切换协议；要 HTTP 得另建连接
- **WebSocket 跨域吗？** → 不受同源策略拦截（握手带 Origin，由服务器自行校验），这也是它常被用作跨域实时方案的原因
