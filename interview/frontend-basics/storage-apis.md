# Cookie、localStorage、sessionStorage 区别与浏览器存储 API 全景

## 为什么需要

存储选型是前端登录态、缓存、离线功能的第一个决策点：选错会引发**每次请求多带 4KB Cookie 拖慢接口**、**XSS 把 token 偷走**（localStorage 存凭证的经典事故）、**多标签页状态串台**（sessionStorage 与 localStorage 的作用域差异）。这题同时考察同源策略概念——存储的作用域全部建立在"源"之上。

## 核心要点

### 0. 先明确"同源"

**同源 = 协议 + 域名（host）+ 端口号 三者完全相同**。`https://a.com` 与 `http://a.com` 不同源（协议不同），`a.com:80` 与 `a.com:8080` 不同源（端口不同）。localStorage/sessionStorage/IndexedDB 都以源为隔离单位；Cookie 以"域+路径"为单位，粒度不同。

### 1. 三大存储对比表（核心）

| 维度 | Cookie | localStorage | sessionStorage |
| --- | --- | --- | --- |
| 容量 | 约 4KB | 约 5MB/源（各浏览器略异） | 约 5MB/源 |
| 生命周期 | 设置了 `Expires/Max-Age` 则持久到过期；不设则会话结束失效 | 永久，除非手动删除或清缓存 | 当前标签页会话：关标签即清，刷新不丢 |
| 作用域 | 域+路径匹配即共享（可跨子域：`Domain=.example.com`） | 同源共享，所有标签页 | 同源 + **仅当前标签页**（新标签/复制打开都不共享） |
| 是否随请求发送 | ✅ 匹配域/路径的每个请求自动携带 | ❌ 纯客户端 | ❌ 纯客户端 |
| 服务端可读写 | ✅（Set-Cookie 响应头） | ❌ | ❌ |
| API 形态 | `document.cookie` 字符串，需手动解析（或用 js-cookie） | `setItem/getItem/removeItem/clear`，值只能是字符串 | 同左 |
| 跨标签通信 | 天然共享（改一处全生效） | `storage` 事件可监听 | ❌ |
| 典型用途 | 会话凭证、CSRF Token、埋点标识、A/B 分流 | 用户偏好、主题、token 缓存、草稿 | 单流程状态（表单分步、一次性提示） |

```js
// localStorage 读写（值是字符串，对象要序列化）
localStorage.setItem('user', JSON.stringify({ name: 'liu' }))
const user = JSON.parse(localStorage.getItem('user') ?? 'null')

// 原生 cookie 读写：拼接串，需自己解析
document.cookie = 'token=abc; Max-Age=3600; Path=/; SameSite=Lax'
// 注意：document.cookie 只能写、不能读到 HttpOnly 的 cookie
```

### 2. Cookie 的关键属性（面试深挖点）

| 属性 | 作用 |
| --- | --- |
| `Expires / Max-Age` | 过期控制；Max-Age 是相对秒数，优先 |
| `Path / Domain` | 携带范围；默认当前路径/当前域 |
| `HttpOnly` | JS 读不到 → XSS 偷不走会话凭证 |
| `Secure` | 仅 HTTPS 传输 |
| `SameSite` | `Strict/Lax/None`：限制跨站请求携带，防 CSRF；None 必须配 Secure |

### 3. 浏览器存储 API 全景

| API | 容量 | 持久性 | 特点 | 适用 |
| --- | --- | --- | --- | --- |
| Cookie | ~4KB | 可配置 | 随请求发送、服务端可写 | 登录态、需服务端识别的小数据 |
| localStorage | ~5MB | 永久 | 同步 API、字符串键值 | 偏好设置、低频缓存 |
| sessionStorage | ~5MB | 标签页会话 | 隔离性好 | 单页流程状态 |
| **IndexedDB** | 大（数百 MB 级，按配额） | 持久 | **异步事务型数据库**，可存 Blob/结构化对象、支持索引游标 | 离线数据、大量列表缓存、PWA |
| **Cache API** | 大 | 持久 | 按 Request/Response 缓存，配合 Service Worker | 离线资源、PWA 缓存策略 |
| OPFS（Origin Private File System） | 极大 | 持久 | 文件系统语义，配 SW/Worker | 大文件、Web 应用沙盒 |
| Web SQL | — | — | **已废弃**，别用 | — |

```js
// IndexedDB 最小示例：打开库 → 事务 → 写入
const req = indexedDB.open('demo', 1)
req.onupgradeneeded = (e) => {
  e.target.result.createObjectStore('posts', { keyPath: 'id' }) // 建对象仓库
}
req.onsuccess = () => {
  const db = req.result
  const tx = db.transaction('posts', 'readwrite') // 事务
  tx.objectStore('posts').put({ id: 1, title: 'hello' })
}
```

### 4. 选型速查

```
数据要给服务端看（鉴权）？ ──► Cookie（HttpOnly + Secure + SameSite）
纯客户端小量 KV？
  ├─ 跨标签共享、长期 ──► localStorage
  ├─ 标签内隔离、临时 ──► sessionStorage
  └─ 大量结构化/离线 ──► IndexedDB / Cache API(SW)
```

## 面试答法

### 30 秒版本（可直接背诵）

> Cookie 约 4KB，可设过期时间，会在同域请求时自动携带，服务端用 Set-Cookie 写，主要用于登录态和 CSRF；localStorage 约 5MB，永久存储直到手动清除，同源所有标签共享，纯客户端键值对；sessionStorage 容量类似但只在当前标签页会话内有效，关标签就清、刷新不丢，新标签都不共享。三者 API 上 Cookie 是 document.cookie 字符串拼接，后两者是 setItem/getItem 且值只能是字符串。再往上还有 IndexedDB——大容量异步事务数据库存结构化数据，Cache API 配 Service Worker 做离线缓存。选型：给服务端看的用 Cookie，客户端长期用 localStorage，单流程临时用 sessionStorage，大量结构化用 IndexedDB。

### 深入展开

1. **先报同源定义**（协议+域名+端口），再讲存储作用域差异：Cookie 是域+路径粒度，其余按源，sessionStorage 还多一层标签页隔离。
2. **逐项过对比表**：大小/生命周期/作用域/是否随请求/API 五个维度。
3. **Cookie 属性深挖**：HttpOnly 防 XSS 窃取、SameSite 防 CSRF——把存储题引向安全题。
4. **全景补充**：IndexedDB 的事务与索引、Cache API 的 Request/Response 语义、OPFS 作为新选项、Web SQL 已废弃。
5. **落地选型图**：按"是否给服务端看、量级、共享范围"三问收敛。

### 常见追问

- **JWT 存哪安全？** → 各有取舍：localStorage 会被 XSS 直接读走；HttpOnly Cookie 免疫 XSS 窃取但要配 SameSite 防 CSRF；最优是内存变量+刷新机制，次选 HttpOnly Cookie。
- **localStorage 是同步 API 有什么问题？** → 阻塞主线程；大量读写可考虑 IndexedDB 或 sessionStorage 分片。
- **两个标签页同时写 localStorage 会冲突吗？** → 后写覆盖，无锁；可通过监听 `storage` 事件做多标签同步。
- **为什么 sessionStorage 复制标签页打开也不共享？** → 规范规定"顶层浏览上下文创建时"才复制初始副本，新开/复制地址栏打开都是新会话上下文。
- **Cookie 怎么实现"记住我 7 天"？** → 设 `Max-Age=604800`（或 Expires 绝对时间）；不记则用会话 Cookie。
- **无痕模式下存储有什么区别？** → 关闭即全清；部分浏览器对 localStorage/IndexedDB 有配额限制。
