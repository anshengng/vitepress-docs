# 常用 HTTP 请求头与响应头

## 题目

> 常见的请求头和响应头有哪些？Content-Type 有什么取值？Accept 和 Content-Type 是什么关系？Authorization 和 Cookie 都能带身份，怎么选？Cache-Control 的 no-cache 和 no-store 有什么区别？Connection: keep-alive 解决什么问题？

## 为什么需要

头部（Header）是 HTTP 的"协商通道"：内容格式、缓存策略、身份凭证、连接管理、跨域许可全部靠头来谈。面试从不孤立问"背头部"，而是把它们嵌进场景里问：为什么 axios 发 JSON 会触发 CORS 预检（Content-Type）、强缓存怎么配（Cache-Control/ETag）、登录态怎么带（Cookie vs Authorization）。把头部按"内容协商 / 缓存 / 鉴权 / 连接"四条主线组织，才能以不变应万变。

## 核心要点

### 1. 报文结构：头在哪个位置

```
请求                                     响应
┌ POST /login HTTP/1.1 ─┐               ┌ HTTP/1.1 200 OK ────┐  状态行
│ Host: example.com     │  请求行        │ Content-Type:        │
│ Content-Type:         │  + 头部        │   application/json   │  + 头部
│   application/json    │               │ Set-Cookie: s=a; ... │
│ Authorization: Bearer │               │ Cache-Control: ...   │
│ (空行)                │               │ (空行)               │
│ {"user":"admin"}      │  ← 主体        │ {"code":0}           │  ← 主体
└───────────────────────┘               └──────────────────────┘
```

### 2. 常用请求头

| 头 | 示例 | 作用 |
| --- | --- | --- |
| `Accept` | `application/json, text/html` | 客户端能接受什么响应格式（内容协商） |
| `Content-Type` | `application/json` | 我发的 body 是什么格式（取值见第 4 小节） |
| `Authorization` | `Bearer <token>` / `Basic base64` | 凭证鉴权；Basic 只是 base64 编码，**不是加密** |
| `Cookie` | `session=abc; theme=dark` | 浏览器对同域请求**自动附带** |
| `Origin` | `https://a.com` | 请求由哪个源发起（CORS 预检与真实请求都带） |
| `User-Agent` | `Mozilla/5.0 (Windows...)` | 浏览器/设备指纹 |
| `Referer` | 上一页 URL | 来源页（注意会泄漏 GET 参数，可用 Referrer-Policy 限制） |
| `Cache-Control` | `no-cache` | 客户端对缓存的使用要求 |
| `If-None-Match` / `If-Modified-Since` | `"33a64"` / 日期 | 条件请求，配对端 ETag/Last-Modified → 304 |
| `Connection` | `keep-alive` | HTTP/1.1 默认复用 TCP 连接 |
| `Host` | `example.com` | 目标域名——一台 IP 多站点（虚拟主机）全靠它区分 |
| `Range` | `bytes=0-1023` | 分段/断点续传下载 |

### 3. 常用响应头

| 头 | 示例 | 作用 |
| --- | --- | --- |
| `Set-Cookie` | `s=abc; HttpOnly; Secure; SameSite=Lax` | 下发 Cookie（三个属性各防一类攻击） |
| `WWW-Authenticate` | `Bearer realm="api"` | 401 时告知客户端该如何认证 |
| `Content-Type` | `application/json; charset=utf-8` | 响应体实际格式 |
| `Content-Length` / `Content-Encoding` | `1024` / `gzip` | 大小 / 压缩方式 |
| `Cache-Control` | `max-age=31536000, immutable` | 缓存策略（服务端说了算） |
| `ETag` / `Last-Modified` | `"33a64df5"` / 日期 | 缓存校验器，配 `If-*` 实现协商缓存 |
| `Location` | `/new` | 3xx 重定向目标 |
| `Access-Control-Allow-*` | `Allow-Origin: https://a.com` | CORS 许可（详见跨域页） |
| `Vary` | `Origin` | 告诉缓存：不同 Origin 要存不同副本 |
| `Server` / `X-Powered-By` | `nginx` | 软件标识（生产建议隐藏，减少指纹） |

### 4. 主线一：内容协商（Accept ↔ Content-Type）

```
客户端: Accept: application/json          「我能收 JSON」
服务端: Content-Type: application/json    「我给你的就是 JSON」
满足不了 Accept → 406 Not Acceptable
客户端 body 格式声明错 → 服务端解析失败 → 400/415

Content-Type 常见取值：
  application/x-www-form-urlencoded  表单默认，key=value& 编码
  multipart/form-data                文件上传（boundary 分块）
  application/json                   REST API 主流（⚠️ 会触发 CORS 预检）
  text/plain                         简单请求白名单成员
```

### 5. 主线二：鉴权（Cookie vs Authorization）

```
Cookie：浏览器自动附带 → 服务端凭 session id 查状态（有状态）
  优点：免 JS 操作、HttpOnly 防 XSS 读取
  代价：自动附带 → 可被 CSRF 利用；跨域要 withCredentials + Allow-Credentials

Authorization: Bearer <JWT>：JS 显式加头 → 服务端验签即知身份（无状态）
  优点：跨域天然友好（头不受 Cookie 域限制）、无 CSRF（浏览器不会自动带）
  代价：token 存在 JS 可达处就有 XSS 窃取风险 → 短有效期 + refresh 轮换

一句话选型：传统同域服务端渲染 → Cookie+Session；
           前后端分离/移动端/开放 API → Authorization + JWT
```

### 6. 主线三：缓存（Cache-Control / ETag）

```
强缓存（不发请求）：Cache-Control: max-age=60
  → 60 秒内直接用本地副本，Network 显示 "from memory/disk cache"

协商缓存（发请求但可能不传 body）：
  首次: 响应带 ETag: "abc"
  再次: 请求带 If-None-Match: "abc" → 未变则 304 空 body，用本地副本

⚠️ 高频坑：no-cache ≠ 不缓存！
  no-cache = 允许存副本，但每次使用前必须问服务器（走协商）
  no-store = 真的一点都不许存
  带 hash 的静态资源: max-age=31536000, immutable（文件名变=URL变，天然安全）
```

### 7. 手写：一个把主线全用上的 fetch

```javascript
const res = await fetch('https://api.example.com/v1/orders', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',  // 我发的是 JSON（会触发预检）
    'Accept': 'application/json',        // 我希望收 JSON
    'Authorization': 'Bearer ' + token,  // 身份凭证
    'Cache-Control': 'no-cache'          // 不接受陈旧缓存
  },
  body: JSON.stringify({ id: 1 })
})
// 读取响应头声明的格式，再决定怎么解析
if (res.headers.get('Content-Type')?.includes('json')) {
  console.log(await res.json())
}
```

## 面试答法

### 30 秒版（可背诵）

> 头部按四条主线记。内容协商：请求带 Accept 说我想要什么格式，请求带 Content-Type 说我发的 body 是什么格式，响应带 Content-Type 说我实际给了什么，谈不拢分别给 406/415。鉴权：Cookie 是浏览器对同域自动附带、服务端查 session，怕 CSRF；Authorization Bearer 是 JS 显式加头验 JWT，跨域友好、天然免疫 CSRF，但怕 XSS 偷 token。缓存：响应带 Cache-Control max-age 走强缓存不发请求；no-cache 是"可存但每次必须协商"，no-store 才是真不存；协商靠 ETag 配 If-None-Match，未变返回 304 省 body。连接：Connection keep-alive 复用 TCP 避免反复握手。另外 Host 头支撑虚拟主机，Origin 头是 CORS 判定依据。

### 深入版（被追问时按编号展开）

1. **画报文结构**：请求行/状态行 + 头部 + 空行 + 主体，头部分居两侧
2. **内容协商**：Accept 与 Content-Type 的对应关系 + 406/415 触发场景
3. **Content-Type 取值表**：urlencoded / multipart / json，点出 JSON 触发 CORS 预检
4. **鉴权对比**：Cookie 自动附带→CSRF 面；Authorization 显式加头→XSS 面；选型一句话
5. **缓存两档**：强缓存（max-age）与协商缓存（ETag/If-None-Match/304）流程图
6. **必讲坑**：no-cache 与 no-store 的区别；immutable+hash 文件名一年缓存
7. **收尾**：Set-Cookie 的 HttpOnly/Secure/SameSite 三属性各防什么

### 常见追问

- **前端能读到所有响应头吗？** → 不能，跨域下 JS 默认只能读 6 个安全头（如 Content-Type），其余需服务端 `Access-Control-Expose-Headers` 显式暴露
- **Basic 认证安全吗？** → `base64("user:pass")` 是可逆编码不是加密，裸 HTTP 等于明文；只配 HTTPS 或内网工具用
- **keep-alive 解决什么问题？** → 省掉同域连续请求的 TCP（和 TLS）重复握手；HTTP/1.1 默认开启，HTTP/2 更进一步多路复用
- **Vary: Origin 为什么必须加？** → 服务端按 Origin 回显不同 Allow-Origin，CDN 不加 Vary 会把 A 站的响应缓存喂给 B 站导致 CORS 报错
- **ETag 和 Last-Modified 的区别？** → ETag 精确到内容指纹、无时钟/精度问题（能发现"秒内改回原样"）；Last-Modified 只到秒。两者同存时优先 If-None-Match
- **Date/Expires 还用吗？** → Expires 是 HTTP/1.0 绝对时间（依赖客户端时钟），已被 Cache-Control 相对时间取代
