# GET 与 POST 的区别

## 题目

> GET 和 POST 有什么区别？参数分别怎么传递？URL 长度限制是从哪来的？哪个更安全？缓存行为有何不同？"POST 比 GET 安全"的说法对吗？什么是幂等，为什么 GET 必须幂等？

## 为什么需要

GET/POST 是 HTTP 面试的第一问。背出"参数位置/长度/安全/缓存"四条区别不难，难的是讲清**这些区别从哪来**：HTTP 规范对两个方法只规定了**语义**，大部分"区别"其实是浏览器与服务端的**实现约束**（长度）和**参数位置带来的副作用**（缓存、暴露、书签）。能解释"为什么"，比背表格高一个档次。

类比：GET 是"问问题"——问题直接写在标题上，路过的人都看得见，同一个问题问一百遍答案不变（幂等）；POST 是"提交申请表"——内容塞在信封里递进窗口，外面看不见，但每递一次可能新建一条记录（非幂等）。

## 核心要点

### 1. 参数传递：查询串 vs 请求体

```
GET：参数全在 URL 的查询串里
GET /search?q=vite&lang=zh HTTP/1.1
Host: example.com
                          ← 通常没有请求体
https://example.com/search?q=vite&lang=zh
                       └───────┬───────┘
                  ? 后 key=value&key=value
                  特殊字符必须 URL 编码（空格→%20，中文→%E4%B8%AD…）

POST：参数放在请求体，地址栏不可见
POST /login HTTP/1.1
Host: example.com
Content-Type: application/json
Content-Length: 33

{"user":"admin","pwd":"123456"}
```

### 2. 长度限制：限的是 URL，不是 body

```
"GET 只能带 2KB/8KB"不是 HTTP 协议规定，是浏览器/服务端的实现限制：
  IE 曾限制整个 URL ≤ 2083 字符
  Node 默认请求头缓冲区 16KB；Nginx large_client_header_buffers 默认 8k
  → 限制作用在"请求行 + 请求头"上，所以任何方法把超长参数塞进 URL 都会被拒

POST body：协议不限长度（Content-Length / chunked 只是描述大小）
  → 实际上限由服务端配置决定（Nginx client_max_body_size 默认 1m，超了返回 413）
```

### 3. 安全性：暴露位置决定"裸奔程度"

```
GET 参数 → 留在地址栏、浏览器历史、服务器 access log、
           跳转外链时还会通过 Referer 头泄漏给第三方
POST 参数 → 在 body 里，不落上述任何记录

但裸 HTTP 下两者都是明文！链路上任何一跳抓包都能同时看到 URL 和 body
→ 真正的安全边界是 HTTPS，不是 GET vs POST
→ POST 只是"相对安全"（减少意外暴露），不是"加密"
```

### 4. 语义、缓存与幂等对比

| 维度 | GET | POST |
| --- | --- | --- |
| 参数位置 | URL 查询串 | 请求体 |
| 长度 | 受 URL 长度限制（浏览器/服务端实现） | body 理论不限（受服务端配置限制） |
| 可缓存 | ✅ 浏览器/CDN/代理默认可缓存 | ❌ 默认不缓存 |
| 可收藏/分享 | ✅ URL 完整描述资源 | ❌ body 不在 URL 里 |
| 历史记录暴露 | 参数明文留存 | body 不落记录 |
| 幂等 | ✅ 语义要求无副作用 | ❌ 每次提交可能新建资源 |
| 安全方法（不改状态） | ✅ | ❌ |
| 典型场景 | 查询、列表、详情 | 登录、新增、上传 |

**幂等**：同一请求发 1 次和发 N 次，对服务器状态的影响相同。GET/HEAD/PUT/DELETE 应幂等（DELETE 是"删掉这个资源"，删一次和删五次结果一样），POST 不幂等（提交三次订单 = 三张订单）。幂等的意义：超时和网络抖动时客户端才能**安全重试**、网关才能安全重放；如果写出 `GET /delete?id=1` 这种"非幂等 GET"，爬虫抓取、浏览器预取、误刷新都可能造成灾难。

### 5. 手写：两种最常见的发送方式

```javascript
// GET：用 URLSearchParams 拼接，自动做编码，防特殊字符破坏 URL
const qs = new URLSearchParams({ q: 'vite 文档', lang: 'zh' })
const res = await fetch(`https://example.com/search?${qs}`)

// POST：JSON 体，必须手动声明 Content-Type
await fetch('https://example.com/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user: 'admin', pwd: '123456' })
})

// POST 表单（Content-Type 为 urlencoded，属于"简单请求"，不触发 CORS 预检）：
// headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
// body: new URLSearchParams({ user: 'admin' })   // 或 FormData（multipart）
```

## 面试答法

### 30 秒版（可背诵）

> GET 和 POST 首先是语义不同：GET 是"取资源"，安全且幂等，参数拼在 URL 查询串上，默认可被浏览器和 CDN 缓存，可以收藏、可以出现在历史记录和 Referer 里；POST 是"提交数据"，非幂等，参数放请求体，默认不缓存。长度上 GET 受 URL 限制——但那是浏览器和服务端的实现限制，不是协议规定；POST 的 body 协议不限，实际上限看服务端配置。安全上 GET 参数明文暴露在地址栏，POST 只是相对好一些，裸 HTTP 下两者抓包都看得见，真正的安全靠 HTTPS。最后强调：GET 必须幂等，否则爬虫和重试会引发事故，写操作要用 POST 或 PUT。

### 深入版（被追问时按编号展开）

1. **报文结构**：画 GET 请求行带查询串、POST 头+体两段，指出参数位置是所有区别的根源
2. **长度限制来源**：IE 2083 / Node 16KB / Nginx 8k 都是"请求行+头"的实现限制，与协议无关
3. **安全三层辨析**：GET 明文暴露位置（历史/日志/Referer）→ POST 相对收敛 → 但 HTTPS 才是加密边界
4. **缓存与幂等**：只有"安全方法"默认可缓存；POST 不缓存是因为重放会产生重复副作用
5. **幂等工程意义**：重试、重放、预取都建立在幂等承诺上，`GET /delete` 是反模式
6. **手写收尾**：URLSearchParams 编码、Content-Type 与简单请求/预检的联动

### 常见追问

- **GET 能带请求体吗？** → 协议没禁止，但服务端和浏览器几乎都不支持，实际不可用；参数就放查询串
- **为什么 POST 不能被缓存？** → 语义上"可能改变服务器状态"，缓存并重放等于重复执行副作用，所以协议规定只有安全方法默认可缓存
- **表单提交是 GET 还是 POST？** → 由 `<form method>` 决定，默认 GET；POST 表单的 Content-Type 是 urlencoded 或 multipart
- **Referer 怎么泄漏 GET 参数？** → 页面跳转外链时浏览器把当前完整 URL（含查询串）放进 Referer 头发给对方；可用 `Referrer-Policy` 限制
- **PUT 和 POST 的区别？** → PUT 幂等、客户端指定资源 URI、语义是整体替换；POST 非幂等、新资源位置由服务端决定
- **想让登录真正安全该怎么做？** → HTTPS 打底 + 应用层 RSA/AES 混合加密 + timestamp/nonce 防重放，见"登录密码的加密传输方案"页
