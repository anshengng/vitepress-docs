# 跨域与 CORS / 代理

## 题目

> 什么是跨域？同源策略判定规则是什么？简单请求和预检请求的区别，哪些情况会触发 OPTIONS？带 Cookie 的跨域怎么配？Access-Control-Allow-Origin 用 * 有什么坑？开发环境的 proxy 为什么能解决跨域，原理是什么？Nginx 反向代理怎么做？jsonp 了解吗？

## 为什么需要

**跨域是浏览器"同源策略"对前端脚本的限制**：网页里的 JS 只能请求与当前页面"同源"的资源，目的是防止恶意脚本读取其他站点的数据（如你的银行页面 Cookie）。注意两点：① 它是浏览器行为，服务器之间、App、curl 都没有跨域概念；② 服务器其实收到了请求并正常响应了，是**浏览器拿到响应后检查响应头，不合规就拦截**。

## 核心要点

### 1. 同源判定：协议 + 域名 + 端口 三者全同

```
当前页面：https://www.a.com:443/app/index.html

目标 URL                          同源？  差在哪
http://www.a.com/app/              ❌     协议不同（https vs http）
https://a.com/app/                 ❌     域名不同（www.a.com vs a.com 是子域关系）
https://www.a.com:8080/api/        ❌     端口不同（443 vs 8080）
https://www.a.com/api/user         ✅     三要素全同
```

```
        协议        域名          端口
https :// www.a.com : 443  /app/index.html
  ✅       ✅        ✅      → 同源，随便发
  任一不同 → 跨域，浏览器拦截响应
```

### 2. 简单请求 vs 预检请求

```
简单请求（一次往返）：
浏览器 ──── GET/POST + Origin: https://www.a.com ────────► 服务器
        ◄── 200 + Access-Control-Allow-Origin: 匹配 ──────── 通过，JS 才能读响应

预检请求（两次往返）：
浏览器 ──── ① OPTIONS /api/user ─────────────────────────► 服务器
   (Origin / Access-Control-Request-Method: PUT / Access-Control-Request-Headers)
        ◄── ② 204 + Allow-Methods / Allow-Headers / Max-Age ──
                    │
          校验通过 ──┴── 校验失败 → 浏览器直接报 CORS 错误
                    ▼           （服务器可能已正常处理，只是被浏览器拦）
浏览器 ──── ③ 真正的 PUT 请求（带 Origin）───────────────► 服务器
        ◄── ④ 200 + Access-Control-Allow-Origin ────────────
```

**触发预检的条件（任一不满足"简单"即预检）**：

```
① 方法不是 GET / HEAD / POST
② POST 的 Content-Type 不是三选一：
   application/x-www-form-urlencoded / multipart/form-data / text/plain
③ 设置了自定义请求头（Authorization、X-Token 等）
→ 最常见踩坑：axios 默认 JSON（application/json）+ 带 Authorization → 必预检
→ Max-Age: 86400 可缓存预检结果，省掉重复 OPTIONS
```

### 3. 常用 CORS 响应头表

| 响应头 | 示例 | 说明 |
| --- | --- | --- |
| `Access-Control-Allow-Origin` | `https://www.a.com` 或 `*` | 允许哪个源；**带凭证时不能写 \*** |
| `Access-Control-Allow-Credentials` | `true` | 允许跨域携带 Cookie / 客户端证书 |
| `Access-Control-Allow-Methods` | `GET,POST,PUT,DELETE` | 预检答复：允许的方法 |
| `Access-Control-Allow-Headers` | `Content-Type,X-Token` | 预检答复：允许的请求头 |
| `Access-Control-Max-Age` | `86400` | 预检结果缓存秒数 |
| `Access-Control-Expose-Headers` | `X-Total-Count` | 默认 JS 只能读 6 个安全头，其余需显式暴露 |

**必讲的坑**：`Allow-Origin: *` 与 `Allow-Credentials: true` **互斥**——浏览器规定一旦请求带凭证（`withCredentials=true`），`*` 无效，服务器必须**回显具体的 Origin**（并同步把 `Vary: Origin` 加上防 CDN 缓存串源）。

### 4. 开发期代理原理（Vite / webpack devServer）

```
跨域是浏览器的限制，Node 服务器发 HTTP 请求没有这个限制 → 让 devServer 当"中间人"

浏览器 ──同源──► 本地 devServer :5173 ──Node 转发──► https://api.target.com
  fetch('/api/user')      proxy 规则命中 /api        （服务端之间无跨域）
  ◄──── 响应原路返回 ──────◄──── 拿到数据 ────────────

Vite 配置：
server: { proxy: { '/api': {
  target: 'https://api.target.com',
  changeOrigin: true,          // 把转发请求的 Host 头改成 target 域名
  rewrite: p => p.replace(/^\/api/, '')
}}}
```

### 5. Nginx 反向代理（生产标准做法）

```
浏览器 ──同源──► 站点域名 /api/ ──Nginx──► 后端服务
前端直接请求同域的 /api，由 Nginx 转发，压根不产生跨域，也不需要 CORS 头

location /api/ {
    proxy_pass https://backend-a/;     # 注意 / 的有无决定是否去掉 /api 前缀
    proxy_set_header Host backend-a;
}
```

### 6. jsonp（历史方案，一句话）

```
<script> 标签不受同源限制 → 动态插入
<script src="https://api.x.com/data?cb=handle">，服务器回 `handle({...})`
局限：只支持 GET、要双方约定回调名、无法感知错误、有 XSS 风险 → 已被 CORS 取代
```

## 面试答法

### 30 秒版（可背诵）

> 跨域是浏览器同源策略的限制：协议、域名、端口任一不同就跨域，它只约束浏览器里的 JS，服务器之间没有跨域，而且是浏览器收到响应后按响应头拦截的。解法主流是 CORS：简单请求一次往返直接带 Origin，服务器回 Access-Control-Allow-Origin 放行；不简单的请求先发 OPTIONS 预检，问方法和自定义头，通过再发真实请求，可以用 Max-Age 缓存预检。带 Cookie 时 Allow-Credentials 为 true，此时 Origin 不能写星号，必须回显具体域名。开发环境用 Vite 或 webpack 的 proxy，让 devServer 在服务端转发请求绕开浏览器限制；生产用 Nginx 反向代理让前后端同域，最干净。jsonp 靠 script 标签不受同源限制，只支持 GET，已经淘汰。

### 深入版（被追问时按编号展开）

1. **先纠正认知**：跨域是浏览器行为；请求可能已被服务器处理，只是响应被拦
2. **三要素判定**：协议/域名/端口逐个举例对比（www 与裸域也算不同）
3. **预检流程**：画两次往返时间线，列三个触发条件，点出 axios JSON + Authorization 是最常见诱因
4. **响应头表**：逐个讲 Allow-Origin / Allow-Headers / Max-Age / Expose-Headers
5. **凭证坑**：Credentials 与 \* 互斥 → 必须回显 Origin + Vary: Origin
6. **代理方案**：Vite proxy 原理图（浏览器→devServer→目标，服务端转发无跨域）；生产 Nginx 同域反代
7. **收尾**：jsonp 原理与局限一句话带过

### 常见追问

- **跨域时 Cookie 为什么默认不带？** → 跨站请求默认不带凭证，需前端 `withCredentials=true` 且后端 `Allow-Credentials: true` 同时成立；且该 Cookie 本身若是 SameSite=Lax/Strict 仍可能被浏览器按 SameSite 规则拦掉
- **changeOrigin 改的是什么？** → 转发请求的 `Host` 头改成 target 域名（影响虚拟主机路由），不是改 Origin，也不是改浏览器侧的请求
- **预检失败会怎样？** → 真实请求根本不发，控制台报 CORS 错误；排查时先看 OPTIONS 响应的 Allow-Methods/Allow-Headers 是否覆盖
- **为什么允许 JS 读响应要服务器"同意"？** → 防止恶意站点用你的登录态读取你信任站点的数据（CSRF 的读方向防御）
- **CORS 和 Nginx 反代怎么选？** → 同公司前后端分离生产环境优先 Nginx 同域反代（零 CORS 配置）；开放 API 给任意第三方才用 CORS（`*` 或白名单）
