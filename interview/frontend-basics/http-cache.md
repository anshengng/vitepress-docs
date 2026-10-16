# 强缓存与协商缓存

## 题目

> 浏览器缓存的完整流程是什么？强缓存和协商缓存的区别？Cache-Control 和 Expires、ETag 和 Last-Modified 分别怎么选？200 from disk cache 和 304 是什么意思？F5 和 Ctrl+F5 对缓存有什么影响？实际项目里 HTML 和 JS/CSS 的缓存策略怎么配？

## 为什么需要

网页资源（JS/CSS/图片）体积大、变化少，每次都重新下载又慢又费流量。浏览器缓存让"没变的东西不重新下载"，分两级优化：**强缓存**——没过期就连服务器都不问；**协商缓存**——过期了去问服务器"还能用吗"，能用就只回一个 304，不发内容。

## 核心要点

### 1. 完整缓存决策流程图

```
浏览器要请求一个资源
   │
   ▼
本地有缓存吗？ ──没有──► 直接请求服务器 ──► 200 + 响应体 + 缓存头（存入本地）
   │有
   ▼
强缓存判断：Cache-Control: max-age=xxx（没有则看 Expires）过期了吗？
   │
   ├─ 未过期 ──► 直接用本地缓存，【不发任何请求】
   │             DevTools 显示 200 (from disk cache / from memory cache)
   │
   └─ 已过期 ──► 进入协商缓存：发条件请求
        │
        │  有 ETag？ ──是──► 请求头带 If-None-Match: <etag值>
        │            └─否──► 请求头带 If-Modified-Since: <Last-Modified值>
        ▼
   服务器比对：
        ├─ 一致 ──► 304 Not Modified（无响应体）→ 复用本地缓存，刷新 max-age 起点
        └─ 不一致 ─► 200 + 新响应体 + 新缓存头 → 更新本地缓存
```

### 2. 字段对比表

| 层级 | 请求头 | 响应头 | 说明 |
| --- | --- | --- | --- |
| 强缓存 | —（不问服务器） | `Cache-Control` | HTTP/1.1：`max-age=N`、`no-store`（完全不存）、`no-cache`（存但每次协商）、`public/private` |
| 强缓存(旧) | — | `Expires` | HTTP/1.0 绝对时间，受**客户端时钟偏差**影响，被 max-age 覆盖 |
| 协商缓存 | `If-None-Match` | `ETag` | 资源内容指纹（哈希），内容变就变，**更精确** |
| 协商缓存(旧) | `If-Modified-Since` | `Last-Modified` | 最后修改时间，**秒级精度**：1 秒内改两次会漏判 |

ETag 比 Last-Modified 强的三个场景：① 秒内多次修改；② 内容被改回原样（时间变了但内容没变，ETag 能判"没变"）；③ 服务器需要更可靠的变化判定（如动态生成但结果相同的页面）。

### 3. 常见状态码 / 命中场景表

| DevTools 表现 | 含义 | 是否发请求 |
| --- | --- | --- |
| `200 OK` | 首次请求 / 缓存未命中，完整下载 | ✅ |
| `200 (from memory cache)` | 内存缓存命中（JS、图片等，页面刷新即失效） | ❌ |
| `200 (from disk cache)` | 磁盘缓存命中，**强缓存未过期** | ❌ |
| `304 Not Modified` | 协商缓存命中，服务器确认没变，复用本地副本 | ✅（但无响应体） |
| `200 (from service worker)` | SW 拦截后自供缓存 | ❌ |

### 4. F5 与 Ctrl+F5 的区别

```
普通导航（地址栏/点链接）：完全按缓存头走，强缓存没过期就不问服务器

F5 刷新：浏览器给请求【自动加上 Cache-Control: max-age=0】
        → 强缓存直接判过期，但条件请求头(If-None-Match)还带着
        → 走协商缓存，没变仍可得 304

Ctrl+F5 强制刷新：加 no-cache 且【不带任何条件请求头】
        → 强缓存、协商缓存全部作废
        → 服务器必须回 200 + 完整内容
```

### 5. 实际开发建议

```
index.html（入口，必须常新）
   Cache-Control: no-cache        ← 存但每次协商，改了立刻生效
   （若配了 CDN，常用短 max-age=0 + ETag 或边缘协商）

带 hash 的静态资源（app.3f8a2c.js）
   Cache-Control: max-age=31536000, immutable   ← 一年强缓存
   内容变 → 文件名 hash 变 → URL 变 → 天然绕开旧缓存

API 接口
   Cache-Control: no-store        ← 响应含用户数据，绝不落盘
```

```
发布原理图（为什么 HTML 不缓存 + 资源长缓存能配合）：
改代码 → 产物 hash 变 → index.html 里引用新 URL
   index.html: no-cache 保证用户总能拿到"最新引用"
   旧 app.abc.js: 一年缓存也没关系，没人引用它了（自然淘汰）
```

## 面试答法

### 30 秒版（可背诵）

> 浏览器缓存分两级。强缓存由 Cache-Control 的 max-age 控制，没过期时浏览器直接用本地副本，连请求都不发，DevTools 里显示 200 from disk cache；过期的响应头 Expires 因为客户端时钟不准已被取代。协商缓存是过期后再问服务器：带 ETag 就用 If-None-Match 比对指纹，带 Last-Modified 就用 If-Modified-Since 比对修改时间，一致就回 304 不发内容。ETag 更精确，能解决秒级精度和内容改回原样的问题。项目实践是入口 HTML 用 no-cache 每次协商，带 hash 的静态资源用一年长缓存 immutable，API 用 no-store。F5 会让强缓存失效但仍可 304，Ctrl+F5 则两级缓存全废必须 200。

### 深入版（被追问时按编号展开）

1. **画决策流程图**：本地有无 → 强缓存是否过期 → 协商比对 → 304/200 四条出口
2. **两组字段对比**：Cache-Control vs Expires（时钟问题）、ETag vs Last-Modified（精度/回改/可靠性）
3. **状态码现象**：200 from memory/disk cache 不发请求，304 发请求但无体
4. **刷新行为**：F5 = 强缓存失效可协商；Ctrl+F5 = 全部失效
5. **落地策略**：HTML no-cache + 资源 hash 长缓存 + API no-store，讲清"hash 变 URL 变"的发布闭环
6. **收尾加分**：no-cache ≠ 不缓存（是"缓存但必协商"），no-store 才是真不存

### 常见追问

- **no-cache 和 no-store 区别？** → no-cache：可以存，但每次使用前必须找服务器协商；no-store：禁止任何缓存副本
- **为什么 304 还要发一次请求，不还是慢吗？** → 请求头很小、响应无体，省的是内容下载 + 解析时间；配合强缓存大多数请求根本发不出去
- **ETag 有什么代价？** → 服务器要计算内容哈希（或依赖 inode/mtime/size 弱 ETag）；集群多机算法不一致时可能每次都不匹配，需统一生成策略
- **from memory cache 和 disk cache 谁先？** → 先查内存（当前会话用过的 JS/图片等），没有再查磁盘；刷新后内存缓存清空，所以刷新后常见 from disk cache
- **CDN 和浏览器缓存怎么配合？** → CDN 边缘节点同样按 Cache-Control 缓存；HTML 在边缘设短 TTL 或 no-cache，静态资源设长 TTL，回源时带条件请求
