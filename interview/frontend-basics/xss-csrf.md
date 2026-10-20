# XSS 与 CSRF

## 题目

> XSS 有哪几种类型，各自的攻击链路是怎样的？如何防御？HttpOnly 能防 XSS 吗？CSP 是什么、怎么配？CSRF 的原理是什么，为什么浏览器会替攻击者发请求？SameSite、Token、Referer 校验分别怎么防 CSRF？XSS 和 CSRF 的本质区别是什么？

## 为什么需要

两者是 Web 安全面试的"双子星"，但攻击方向正好相反，先用类比建立直觉：

- **XSS（跨站脚本）**：像小偷偷溜进你家，**在你家墙上贴了张假告示**，所有来你家的人都会读到他写的东西——攻击的是"**你网站里的用户数据/代码执行权**"。核心问题：**不可信的数据被浏览器当成代码执行了**。
- **CSRF（跨站请求伪造）**：像小偷借用了**你的印章**替你签了份合同——攻击的是"**用户身份被冒用发起的操作**"。核心问题：**浏览器发请求时自动携带凭证（Cookie），无法证明"是用户本人想发"**。

```
XSS：攻击者的代码 ──注入──► 你的页面 ──执行于──► 受害者的浏览器
      （数据变代码，信任被打破）

CSRF：攻击者的页面 ──诱导──► 受害者浏览器 ──带着受害者 Cookie──► 你的服务器
      （凭证被冒用，意愿被伪造）
```

## 核心要点

### 1. 三种 XSS 攻击链路

**① 存储型（Stored）**——恶意脚本存进数据库，危害最大、影响所有访问者：

```
攻击者            服务器                 受害者
  │  提交评论: <script>偷Cookie</script>   │
  ├──────────►│ 未过滤直接入库            │
              │                            │
              │   受害者打开评论区          │
              │◄───────────────────────────┤
              │  返回含脚本的 HTML          │
              ├───────────────────────────►│ 浏览器把<script>当代码执行
                                           │ → Cookie/Token 被发往攻击者
```

**② 反射型（Reflected）**——脚本藏在 URL 参数里，需要诱导点击：

```
受害者点击: https://site.com/search?q=<script>...</script>
     │
     ▼
服务器把 q 原样拼进响应 HTML（"搜索结果：<script>..."）
     │
     ▼
受害者浏览器执行脚本 —— 只污染这一次响应，不入库
```

**③ DOM 型**——服务器 HTML 是干净的，**前端 JS 自己制造漏洞**：

```
location.hash / urlParam（不可信数据）
     │
     ▼  不经后端，直接在前端流动
document.innerHTML = '<div>' + location.hash.slice(1) + '</div>'
     │
     ▼
浏览器解析 HTML → 内嵌 <img onerror=...> 被执行
```

### 2. XSS 防御三板斧

**① 输出转义（最根本）**：按"输出上下文"选择转义策略——HTML 文本、属性、URL、JS 字符串的转义规则各不相同。

```javascript
// 极简 HTML 实体转义（覆盖最常见文本上下文）
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')      // & 必须最先替换
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
// 原则：永远不要手动拼 innerHTML；用 textContent / 框架自动转义
```

**② CSP（Content Security Policy）**：告诉浏览器"只允许从哪加载/执行什么"，是纵深防御：

```
HTTP 响应头：
Content-Security-Policy:
  default-src 'self';                      // 默认只允许同源
  script-src 'self' https://cdn.com;       // 禁内联脚本(除非 nonce/hash)
  object-src 'none';
  report-uri /csp-violation-report

效果：即使脚本注入成功，
  <script src="evil.com/x.js">  → 被浏览器拦截不加载
  <script>内联代码</script>     → 无 nonce 即拒绝执行
```

**③ HttpOnly Cookie**：`Set-Cookie: token=...; HttpOnly` 后 **JS 的 document.cookie 读不到该 Cookie**，即使 XSS 执行了也偷不走会话凭证——但它防的是"偷 Cookie"，**不能阻止 XSS 本身执行**（攻击者仍可以 fetch 代理请求、改页面）。

| 防御 | 针对 | 局限 |
| --- | --- | --- |
| 输出转义 | 所有 XSS 的根因 | 需覆盖全部输出点，遗漏即破口 |
| CSP | 注入后的执行 | 配置复杂；`unsafe-inline` 形同虚设 |
| HttpOnly | 凭证被窃 | 不阻止脚本运行，AJAX 仍可冒用身份 |

### 3. CSRF 原理：双站点时序攻击

关键前提：**浏览器发请求自动带上目标域 Cookie（SameSite 默认之前），且 GET/POST 跨站不受 CORS 限制**（CORS 只限制"读响应"，不限制"发请求"）。

```
时间线：受害者【同时】登录着 bank.com 和打开 evil.com

 evil.com 页面                    受害者浏览器                bank.com
      │  用户刚访问过网银，Cookie 还在   │                        │
      │                                │                        │
 ─────┼─ 自动加载 <img src="           │                        │
      │   bank.com/transfer?to=attacker│                        │
      │   &amt=10000">                 │                        │
      │         └──────────────────────►│  GET 转账请求          │
      │                                ├───────────────────────►│
      │                                │  自动携带 bank.com Cookie│
      │                                │                        ├─ 校验凭证 ✔
      │                                │                        ├─ 执行转账 ✘
      │                                │◄───────────────────────┤ 返回"成功"
      │                                │  （img 不关心响应，攻击 │
      │                                │    者甚至不需要看到结果）│
      │                                │                        │
 或 POST 表单自动提交：form.submit() 构造跨站 POST，同理
```

一句话：**攻击者伪造不了你的 Cookie，但能"借"浏览器替你发请求**。

### 4. CSRF 防御

**① SameSite Cookie（现代默认解）**：

```
Set-Cookie: session=...; SameSite=Lax

Lax（Chrome 默认）：跨站【POST】不带 Cookie；跨站导航的 GET 才带
Strict          ：任何第三方场景都不带（连点链接回来都重新登录）
None            ：必须配 Secure，恢复到无防护时代
```

**② CSRF Token（经典服务端校验）**：

```
登录时服务端发 token ──► 页面隐藏字段/自定义请求头携带
                         │
                         ▼
请求到达 ──► 服务端比对 token ──► 不匹配则拒绝

原理：攻击者页面能"借"浏览器发 Cookie，但【读不到】目标页 DOM，
     拿不到 token → 请求缺 token 即失败。
     注意 token 不能放 Cookie（Cookie 会自动携带，等于没校验）。
```

**③ Referer/Origin 校验**：检查请求头来源域是否本站。Origin 比 Referer 更规范（Referer 可能被隐私策略裁剪、GET 查询串有泄露风险），可作辅助但不能单独依赖。

### 5. XSS vs CSRF 对比

| 维度 | XSS | CSRF |
| --- | --- | --- |
| 本质 | 不可信数据被当代码**执行** | 用户身份被**冒用**发请求 |
| 攻击目标 | 站点用户（代码执行权） | 站点业务接口（操作意愿） |
| 是否需要诱导交互 | 存储型不需要，反射/DOM 型需点链接 | 需要访问恶意页面 |
| 能否偷 Cookie | 能（无 HttpOnly 时） | 不能，只能"用"Cookie |
| 核心防御 | 转义 + CSP + HttpOnly | SameSite + CSRF Token + Origin 校验 |
| 关系 | XSS 可绕过 CSRF 防御（在受害者页内取 token 再发请求） | CSRF 无法直接产生 XSS |

```
联动：CSRF 需要"猜准参数"，XSS 能"读准一切"——
     一旦站点有 XSS，所有 CSRF 防御形同虚设；
     所以 XSS 防御优先级更高。
```

## 面试答法

### 30 秒版（可背诵）

> XSS 是恶意脚本注入到页面被执行，分存储型（入库、危害最广）、反射型（藏在 URL 参数、诱导点击）、DOM 型（前端 JS 自己把不可信数据写进 innerHTML）三种；防御靠输出转义治根、CSP 限制脚本来源与内联执行、HttpOnly 让脚本偷不走 Cookie。CSRF 是攻击者诱导已登录用户的浏览器向目标站发请求，利用浏览器自动携带 Cookie 的特点冒用身份；防御用 SameSite=Lax/Strict 限制跨站携带 Cookie、CSRF Token 证明请求来自本站页面、Origin/Referer 校验辅助。本质区别：XSS 是"数据被当代码执行"，CSRF 是"身份被冒用"；XSS 可以绕过 CSRF 防御，所以 XSS 优先级更高。

### 深入版（被追问时按编号展开）

1. **画三种 XSS 链路图**：存储型强调"入库后所有人中招"，DOM 型强调"后端 HTML 干净、前端自己制造漏洞"
2. **转义讲上下文**：HTML 文本/属性/URL/JS 字符串转义规则不同，只背一个 escapeHtml 不够
3. **CSP 讲机制**：script-src 禁内联、nonce/hash 白名单；它是纵深防御不是银弹
4. **HttpOnly 的边界**：只防 document.cookie 读取，不阻止脚本运行与 AJAX 冒用
5. **CSRF 时序图**：重点讲"img/表单跨站请求本来就不被 CORS 拦"——CORS 拦的是读响应
6. **Token 为什么不能放 Cookie**：Cookie 自动携带，校验就失去意义；必须放 DOM/请求头
7. **收尾联动**：有 XSS 时 CSRF 防御可被绕过（页内取 token），所以先堵 XSS

### 常见追问

- **HttpOnly 能防 XSS 吗？** → 不能防 XSS 执行，只能降低危害（Cookie 偷不走）；防 XSS 靠转义 + CSP
- **为什么 CSRF 用 GET 也能打？** → img/script/link 等资源加载就是跨站 GET 且不受 CORS 限制；POST 同理，只是拿不到响应
- **SameSite=Lax 为什么不够？** → 跨站顶层 GET 导航仍带 Cookie，若站点用 GET 做写操作仍可被打；根治是"写操作不用 GET"
- **CSP 的 nonce 怎么工作？** → 服务端每次响应生成随机 nonce，头里声明、内联 script 标签携带，匹配才执行
- **验证码能防 CSRF 吗？** → 能防自动化 CSRF（攻击者无法预知验证码），但影响体验，属于额外校验而非标准方案
- **JWT 放哪里更安全？** → 放 Header（配合存内存）天然免疫 CSRF（不自动携带），但要防 XSS 窃取；放 HttpOnly Cookie 防 XSS 偷但需 CSRF 防御——典型权衡
