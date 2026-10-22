# 登录密码的加密传输方案

## 题目

> 登录时密码怎么加密传输？RSA 和 AES 怎么配合？有了 HTTPS 为什么还要应用层加密？数据库为什么存加盐哈希而不是明文？把密码的 hash 直接当密码发给服务器行不行？怎么防重放攻击？

## 为什么需要

"密码要不要加密传输"是经典题，正确答案是**分层的**：传输层靠 HTTPS；若还要应用层加密，标准答案是 RSA+AES 混合加密；存储层靠 hash+salt；防重放靠 timestamp+nonce+签名。四层各管各的事，混为一谈就会答漏。另外面经里有个高频错误必须纠正：**RSA 密钥对绝不能由客户端生成**——私钥如果在客户端，服务端根本没法解密。

## 核心要点

### 1. 先摆正位置：HTTPS 是底线

```
裸 HTTP：密码明文 → 链路上任何一跳（路由器/公共 WiFi/代理）抓包即得
HTTPS：TLS 把整个请求（URL 参数 + 头 + body）加密 → 传输层已解决窃听

那为什么还谈"应用层加密"？
  ① 内网/老旧系统可能没上 HTTPS
  ② 纵深防御：网关、日志、反向代理可能留存明文 body
  ③ 面试本身在考"混合加密"这个经典密码工程题
```

### 2. RSA + AES 混合加密五步（纠正版流程）

```
为什么不能只用 RSA？ 单次要加密的数据太小（RSA-2048 一次 ≤ 245 字节）、大数运算慢
为什么不能只用 AES？ 快，但"这把对称密钥怎么安全交给对方"没法解决
→ 与 HTTPS 同一思想：非对称负责"安全地送钥匙"，对称负责"快速地开箱子"

① 服务端生成 RSA 密钥对，把【公钥】下发给客户端；私钥永不离开服务端
   （⚠️ 面经原话"客户端 window.crypto.subtle.generateKey 生成 RSA 密钥对"是错的：
      客户端生成则私钥也在客户端，服务端拿什么解密？客户端生成的只能是 AES 会话密钥）
② 客户端随机生成一把 AES 密钥 K（一次性，本次登录用完即弃）
③ 客户端用 AES 加密 {账号, 密码, 时间戳}：
     - 每次生成随机 IV（防止同样明文得到同样密文）
     - 用 RSA 公钥加密 AES 密钥 K → encKey
④ 发送 { encKey, IV, 密文 } 三件套
⑤ 服务端：RSA 私钥解出 K → 用 K + IV 解出明文 → 校验时间戳 → 走正常认证
```

```
时间线：
客户端                                        服务端
  │ ① GET /public-key ──────────────────────►│ 返回 RSA 公钥
  │ 本地生成 AES 密钥 K + 随机 IV              │
  │ cipher = AES(K, IV, {user,pwd,ts})       │
  │ encKey = RSA(公钥, K)                    │
  │ ② POST {encKey, IV, cipher} ────────────►│ ③ K = RSA⁻¹(私钥, encKey)
  │                                          │    {user,pwd,ts} = AES⁻¹(K, IV, cipher)
  │                                          │ ④ 校验 ts 新鲜 → 比对密码哈希
```

```javascript
// 客户端简化实现（Web Crypto API）
const rsaPub = await crypto.subtle.importKey('spki', pubDer,
  { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])   // 导入服务端下发的公钥
const aesKey = await crypto.subtle.generateKey(
  { name: 'AES-CBC', length: 256 }, true, ['encrypt', 'decrypt']) // 客户端只生成 AES 密钥
const iv = crypto.getRandomValues(new Uint8Array(16))               // 每次随机的 IV
const enc = new TextEncoder().encode(JSON.stringify({ user, pwd, ts: Date.now() }))
const cipher = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, aesKey, enc)
const raw = await crypto.subtle.exportKey('raw', aesKey)
const encKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, rsaPub, raw) // 公钥包 AES 密钥
// 发送 { encKey, iv, cipher }（均转 base64）
```

### 3. 存储层：hash + salt，以及"摘要当密码"的陷阱

```
数据库绝不存明文/可逆加密 → 库一拖走全部密码裸奔
正确：存 hash(password + salt)，salt 是每用户独立随机串
     （更优：bcrypt/scrypt/argon2 这类自带盐、可调慢化的算法）
登录校验：服务端用该用户的 salt 重算 hash(输入+salt) 比对

⚠️ 陷阱：如果客户端直接把 hash(password) 当"密码"发给服务器
   → 攻击者拖库拿到这个 hash 后，可以拿它【直接当密码】登录
     （"pass-the-hash"）——摘要只是换了一个新明文，等于没保护传输
   → 结论：传输加密（第 2 小节）和存储摘要（本小节）是【两层独立的事】，
     谁也不能替代谁
```

### 4. 防重放：timestamp + nonce + 签名

```
威胁：攻击者抓到一次【合法的加密请求】原样重发——加密再好也挡不住"复读"
防线：让每个请求"新鲜、唯一、不可篡改"

客户端：sign = HMAC(secret, user + ts + nonce + body摘要)
发送：{ user, ts, nonce, sign, cipher... }

服务端校验时间线：
  ① |服务器时间 - ts| < 60s ？        否 → 拒（时间窗，挡长期重放）
  ② nonce 在 Redis 见过吗(setnx+TTL)  见过 → 拒（一次性随机串，挡窗口内重放）
  ③ 用 secret 重算签名比对             不符 → 拒（挡参数篡改）
  ④ 三关全过 → 进入正常认证
```

## 面试答法

### 30 秒版（可背诵）

> 分四层答。传输层底线是 HTTPS，TLS 已把整个请求加密；如果系统要求应用层再加一道，用 RSA+AES 混合：服务端生成 RSA 密钥对、只下发公钥，客户端随机生成一把 AES 会话密钥，用 AES 加随机 IV 加密账号密码和时间戳，再用 RSA 公钥把 AES 密钥包起来一起发；服务端私钥先解出 AES 密钥再解业务数据——和 HTTPS 一样是"非对称送钥匙、对称开箱子"。注意密钥对必须由服务端生成，客户端只有公钥。存储层用 hash+salt（最好 bcrypt），而且不能偷懒把密码的 hash 直接当密码传输，否则拖库者拿 hash 就能登录，摘要成了新明文。防重放用 timestamp+nonce+HMAC 签名：时间窗挡长期重放，一次性 nonce 挡窗口内重放，签名挡篡改。

### 深入版（被追问时按编号展开）

1. **先分层**：HTTPS 是底线，应用层加密是纵深防御，别答成二选一
2. **混合加密五步**：强调 RSA 密钥对在服务端生成、客户端只生成 AES 密钥（纠错点）
3. **为什么 RSA+AES 而不是单用**：RSA 慢且单次容量小，AES 快但密钥分发难
4. **IV 与随机性**：随机 IV 让同明文不同密文；IV 不必保密、随密文传输
5. **存储层**：hash+salt 防拖库；bcrypt 自带盐+慢化抗爆破
6. **pass-the-hash 陷阱**：hash 当密码 = 摘要变新明文，传输与存储两层独立
7. **防重放三件套**：ts 时间窗 + nonce 唯一 + HMAC 签名，画校验时间线

### 常见追问

- **RSA 私钥泄漏了怎么办？** → 能解密所有历史流量 → 需要"前向保密"：HTTPS 用 ECDHE（临时密钥用完即弃），应用层可定期轮换 RSA 密钥对
- **HMAC 的 secret 从哪来？登录前没有身份啊** → 登录接口本身无身份可用"服务端公钥加密 nonce"替代；后续接口的签名 secret 可在登录时协商下发
- **Base64 是加密吗？** → 不是，是可逆编码，任何人可解；面试里把 Base64 说成加密是减分项
- **为什么不干脆全程 RSA 加密密码？** → 密码短，RSA 容量够，但每次登录做大数运算在量大时是性能瓶颈；且混合方案顺带把时间戳、nonce 等整包都保护了
- **前端加密了，后端还存 hash 吗？** → 要。前端加密只保护传输通道；落库仍必须 hash+salt，两者目的不同
- **撞库和爆破在哪防？** → 不在加密层：验证码/登录限速（429）、异地风控、密码泄露库比对
