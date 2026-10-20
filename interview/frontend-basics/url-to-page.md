# 从输入 URL 到页面展示的全过程

## 题目

> 在浏览器地址栏输入一个 URL 回车后发生了什么？请按阶段讲完整链路。DNS 查询是递归还是迭代，缓存有几层？缓存命中时网络请求还发吗？服务端返回 HTML 后浏览器怎么变成像素？哪些阶段是可以被前端优化干预的？

## 为什么需要

这是前端面试的"综合压轴题"：它把 **网络（DNS/TCP/HTTP）、安全（HTTPS）、渲染（解析/绘制）、工程（缓存/CDN）** 串在一条时间线上。答好它的标志不是背流程，而是能指出**每个阶段的可优化点**——这正是性能优化的地图：

```
输入 URL
   │
   ▼  ① URL 解析与预处理        （协议/域名/端口/path 拆分，HSTS 升级）
   ▼  ② DNS 解析                （查缓存 → 递归/迭代查询，拿 IP）
   ▼  ③ 缓存检查（HTTP 层）      （强缓存命中 → 直接跳过 ④⑤！）
   ▼  ④ TCP + TLS 建连           （三次握手 + 握手协商会话密钥）
   ▼  ⑤ HTTP 请求/响应           （报文、304 协商缓存、gzip、CDN 回源）
   ▼  ⑥ 响应解析                （字节流 → 解码 → HTML 字符串）
   ▼  ⑦ DOM + CSSOM 构建         （Token→Node→DOM 树；CSS 阻塞渲染）
   ▼  ⑧ 渲染流水线               （Render Tree→Layout→Paint→Composite）
   ▼  ⑨ 交互就绪                （DOMContentLoaded / load / JS 事件绑定）
```

## 核心要点

### 1. 阶段①②：URL 解析与 DNS 查询

浏览器先解析 URL（补全协议、punycode 转域名、识别 HSTS 强制 https），然后查域名对应的 IP。

**DNS 缓存是"层层短路"的**，命中即终止查询：

```
应用层缓存(浏览器) → 系统缓存(操作系统) → 路由器/本地 DNS(运营商 LDNS)
   │ 未命中          │ 未命中              │ 未命中
   ▼                 ▼                    ▼
向 LDNS 发起【递归查询】：LDNS 替我问到底
        │
        ▼
LDNS ──【迭代查询】根域 → 顶级域(.com) → 权威域名服务器 → 拿到 IP
        （迭代 = "你问我，我指路，你自己接着问下一家"）
```

高频细节：

- **递归 vs 迭代**：客户端→LDNS 是递归（你负责查到底）；LDNS→根/顶级/权威是迭代（每跳只给"下一家地址"）。
- TTL：每层缓存受记录 TTL 控制；`dns-prefetch` 可提前解析。
- 一个域名常返回多 IP（负载均衡/CDN 就近调度），CDN 场景下"权威服务器"返回的是边缘节点 IP。

### 2. 阶段③：HTTP 缓存——命中直接跳过网络

```
                    ┌─ 强缓存未过期 ──► 200 (from disk/memory cache)
请求 URL ──► 查缓存 ┤                    【不发网络请求！连 TCP 都不建】
                    ├─ 强缓存过期 ──► 发条件请求(If-None-Match/If-Modified-Since)
                    │                  ├─ 服务端 304 → 用本地副本（省 body）
                    │                  └─ 服务端 200 → 全新响应
                    └─ 无缓存 ──► 完整网络请求
```

| 层级 | 控制头 | 是否发请求 | 说明 |
| --- | --- | --- | --- |
| 内存缓存 | — | 否 | 当前会话资源（JS/CSS），进程级 |
| 磁盘缓存 | Cache-Control: max-age / immutable | 否 | 跨会话 |
| 协商缓存 | ETag / Last-Modified | 是（但 304 无 body） | 校验新鲜度 |
| Service Worker | 代码控制 | 可拦截 fetch 自定义 | PWA 离线缓存 |

### 3. 阶段④⑤：建连与请求

- TCP 三次握手（见 TCP 篇），HTTPS 再加 TLS 握手；HTTP/2 复用连接、HTTP/3 走 QUIC。
- 请求报文：方法 + 路径 + 版本 + 头部（Cookie、Accept-Encoding、UA）+ body。
- 服务端侧链路：`CDN 边缘 → (未命中)回源 → LB → Nginx → 应用服务 → DB/缓存`，响应可能 gzip/br 压缩。
- 浏览器并发限制：同域 HTTP/1.1 约 6 个连接；域名分片、HTTP/2 多路复用是经典解法。

### 4. 阶段⑥⑦：响应解析与 DOM/CSSOM 构建

```
字节流 ──按 Content-Type/charset 解码──► HTML 字符串
   │
   ▼ Tokenizer 切词（开始标签/文本/结束标签…）
   ▼ 构树器压入 DOM 节点
DOM Tree:  html ─ body ─ div ─ p ─ …

并行发生：遇到 <link rel="stylesheet"> ──► 异步下载 CSS ──► 构建 CSSOM
遇到 <script>（同步） ──► 【暂停 HTML 解析】下载并执行完才继续
   └─ 原因：脚本可能 document.write / 读写样式，DOM/CSSOM 必须就绪
defer：下载并行、解析完按序执行；async：下载完立刻执行（乱序）
```

关键结论：**CSS 是渲染的阻塞资源**（没有 CSSOM 不构建 Render Tree），**同步 JS 是解析的阻塞资源**——这就是"样式放头、脚本放尾/defer"的底层原因。

### 5. 阶段⑧⑨：渲染与就绪

```
DOM + CSSOM ──► Render Tree（只含可见节点，display:none 不进，
                visibility:hidden 进）
      │
      ▼ Layout/Reflow：计算每个盒子的几何（位置+尺寸）
      ▼ Paint：分层生成绘制指令（颜色/边框/阴影/文本字形）
      ▼ Composite：GPU 把各层纹理合成 → 屏幕像素
      │
      ▼
DOMContentLoaded（HTML 解析完，defer 脚本执行后）
load（含图片/样式等全部资源就绪）
```

详见《浏览器渲染原理》篇。此阶段之后进入交互生命周期：事件绑定、SPA 路由接管、懒加载图片等。

### 6. 全链路优化点地图（面试拉开差距的部分）

| 阶段 | 手段 |
| --- | --- |
| DNS | dns-prefetch / preconnect、HTTPDNS 防劫持 |
| 建连 | HTTPS 会话复用、HTTP/2 或 HTTP/3、TCP 优化（CDN 就近） |
| 请求 | 强缓存 max-age 拉长 + ETag 协商兜底、CDN、gzip/br |
| 解析 | HTML 精简、关键 CSS 内联、JS defer/async、代码分割 |
| 渲染 | 避免大范围重排、合成层动画、骨架屏提前呈现 |
| 感知 | SSR/SSG 直出首屏、流式输出、预渲染 |

## 面试答法

### 30 秒版（可背诵）

> 输入 URL 后：浏览器先解析 URL，然后查 DNS——依次走浏览器、系统、运营商本地 DNS 的缓存，未命中时客户端向本地 DNS 发递归查询，本地 DNS 再对根、顶级、权威服务器做迭代查询拿到 IP。发请求前先查 HTTP 缓存，强缓存命中直接本地返回、连 TCP 都不建；未命中则三次握手、HTTPS 再做 TLS 握手协商会话密钥，然后发送 HTTP 请求，服务端经 CDN/负载均衡/应用返回响应，可能命中 304 协商缓存。浏览器把字节流解码成 HTML，边解析构建 DOM，边异步下载 CSS 构建 CSSOM；遇到同步脚本会暂停解析。DOM+CSSOM 合成渲染树，经布局、绘制、合成上屏，DOMContentLoaded 表示可交互，load 表示全部资源就绪。整条链路每一段都有对应优化：preconnect、强缓存、关键 CSS 内联、defer、避免重排等。

### 深入版（被追问时按编号展开）

1. **画九段流水线**：先给全景，再声明"我按阶段展开，每段讲一个高频细节"
2. **DNS**：递归/迭代分工 + 三层缓存短路 + TTL + CDN 返回边缘 IP
3. **缓存**：强调"强缓存命中不发网络请求"这个反直觉点，304 省 body 不省往返
4. **建连**：TCP 三次 + TLS 混合加密一笔带过（引用 TCP/HTTPS 篇）
5. **解析**：CSS 阻塞渲染、同步 JS 阻塞解析、defer/async 区别——用时间线讲
6. **渲染**：Render Tree→Layout→Paint→Composite 四步 + 两个就绪事件
7. **收尾**：甩出优化点地图，把"知识题"答成"性能工程题"

### 常见追问

- **强缓存和协商缓存的区别？** → 强缓存不问服务器（max-age 内直接 200 from cache）；协商缓存要问，服务器判 304 才用本地
- **DNS 解析失败页面什么表现？** → 浏览器错误页（ERR_NAME_NOT_RESOLVED）；常见原因：缓存污染、运营商劫持（HTTPDNS 可防）
- **304 请求还耗时间吗？** → 耗一个完整往返（TCP+TLS+请求+响应头），只是省了 body 传输——所以强缓存优先级更高
- **DOMContentLoaded 和 load 怎么选埋点时机？** → 统计"可交互"用 DCL，统计"完整加载"用 load；首屏性能更常用 FCP/LCP
- **为什么把 CSS 放 head、JS 放 body 底部？** → CSS 早下载早建 CSSOM 少阻塞渲染；同步 JS 放尾避免阻塞 HTML 解析（现代用 defer 更优）
- **输入 URL 到出现"正在加载"转圈之间，浏览器还做了什么？** → 新建渲染进程/复用 tab 进程、安全校验（恶意站点黑名单）、启动网络线程——属于进程架构，加分项
