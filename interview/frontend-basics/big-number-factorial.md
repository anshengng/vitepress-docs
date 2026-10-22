# 1×2×…×100 万（大数阶乘）

## 为什么需要

"计算 1 乘到 100 万"是分层递进的手写题：第一层考 **JS 数字表示极限**（IEEE 754 双精度），第二层考**大数方案**（BigInt / 字符串模拟乘法），第三层考**工程素养**（百万次大数乘法会阻塞主线程，怎么不卡页面）。能答出"结果其实是 Infinity"才算入门。

## 核心要点

### 1. 问题分析：Number 的两级失效

```
JS Number = IEEE 754 双精度浮点数：

0 ────────── 2^53-1 ───────────── 约1.8e308 ────────► Infinity
   │ 安全整数区          │ 仍有值但不精确        │
   ✅ 精确整数           ⚠️ 精度丢失（跳着数）     ❌ 溢出

- 超过 Number.MAX_SAFE_INTEGER (9007199254740991)：整数开始不精确
- 阶乘增长极快：170! ≈ 7.26e307 还能表示，171! 直接变 Infinity
- 所以 product *= i 循环到 100 万，结果不是"精度差一点"，而是干脆的 Infinity
```

```javascript
let p = 1
for (let i = 1; i <= 1000000; i++) p *= i
console.log(p) // Infinity —— 普通 Number 方案根本不可行（面经说"精度丢失"不够准确）
```

### 2. 方案对比总表

| 方案 | 结果正确性 | 主线程影响 | 实现成本 | 适用 |
| --- | --- | --- | --- | --- |
| Number 循环 | ❌ 171! 起变 Infinity | 快 | 零 | 不可行 |
| **BigInt 循环** | ✅ 任意精度整数 | 阻塞（要算很久） | 低 | 首选正确解 |
| **字符串模拟乘法** | ✅ | 阻塞 | 中 | 无 BigInt 环境/手写加分 |
| BigInt + Web Worker | ✅ | **不阻塞** | 中 | 生产级 |
| BigInt + 时间分片 | ✅ | 不长时间阻塞 | 中 | 需展示进度时 |
| Stirling 公式 | 仅位数/近似值 | 快 | 低 | 只要位数时 |

### 3. BigInt 实现（可运行）

```javascript
// 1 乘到 n 的精确结果（BigInt 支持任意大小整数）
function factorialBig(n) {
  let product = 1n
  for (let i = 2n; i <= BigInt(n); i++) product *= i
  return product.toString() // 转字符串输出/展示，避免渲染层再丢精度
}
// 注意：BigInt 不能与 Number 混算（1n + 1 直接 TypeError）
```

规模感受：`1000000!` 约有 **556 万位十进制数字**（Stirling：log10(n!) ≈ n·log10(n) − n·log10(e) + ½·log10(2πn)），逐位往页面渲染几十万字符本身就是灾难——**展示只给位数和首尾若干位**。

### 4. 字符串/数组模拟乘法（手写核心，可运行）

```javascript
// 无 BigInt 时：数组存十进制位，模拟竖式乘法（低位在前）
function factorialManual(n) {
  let digits = [1]                       // 当前结果，digits[0] 是个位
  for (let i = 2; i <= n; i++) {
    let carry = 0                        // 进位
    for (let j = 0; j < digits.length; j++) {
      const prod = digits[j] * i + carry // 单位 × 乘数 + 进位
      digits[j] = prod % 10              // 留下当前位
      carry = Math.floor(prod / 10)      // 满十进一
    }
    while (carry) {                      // 剩余进位继续展开新高位
      digits.push(carry % 10)
      carry = Math.floor(carry / 10)
    }
  }
  return digits.reverse().join('')       // 高位在前拼成字符串
}
console.log(factorialManual(10)) // '3628800'
```

复杂度：第 i 轮乘法的位数约 O(i·log i)，总时间约 O(n² log²n) 级，比 BigInt 的原生实现（Karatsuba 等优化）慢得多——它的价值是展示"大数运算原理"。

### 5. 不阻塞主线程（工程层）

```javascript
// 方案 A：Web Worker —— 计算放独立线程，主线程只收结果
// worker.js:
self.onmessage = ({ data }) => {
  let p = 1n
  for (let i = 2n; i <= BigInt(data); i++) p *= i
  self.postMessage(p.toString())
}
// 主线程:
const worker = new Worker('./worker.js')
worker.postMessage(1000000)
worker.onmessage = e => { result.value = e.data } // 不卡 UI

// 方案 B：时间分片 —— 每算一段让出一帧，可展示进度
async function factorialChunked(n, onProgress) {
  let p = 1n
  for (let i = 2n; i <= BigInt(n); i++) {
    p *= i
    if ((Number(i) & 0xffff) === 0) {   // 每 65536 次让出一次
      onProgress(Number(i) / n)
      await new Promise(r => setTimeout(r)) // 交还主线程，下一轮宏任务继续
    }
  }
  return p.toString()
}
```

面经的 Vue 场景结论同样成立：**别把这种计算放进 computed/渲染路径**（组件一渲染就同步卡死），要么按钮触发 + Worker，要么分片 + 进度条。

## 面试答法

### 30 秒版本（可直接背诵）

> 这题先说结论：普通 Number 循环根本不行，双精度在超过 2^53 后就不精确，而 171! 直接溢出成 Infinity，所以 1 乘到 100 万的结果是 Infinity。正确方案两条路：一是 BigInt，任意精度整数直接循环相乘，注意不能和 Number 混算；二是手写大数，用数组按位存十进制、模拟竖式乘法带进位，适合没有 BigInt 的环境。第二层是性能：100 万的大数阶乘结果有五百多万位，循环要算很久，放主线程会卡死页面，所以工程上要挪进 Web Worker，或者时间分片每几万步 await 让出一帧。展示时只给位数和首尾几位，不可能渲染五百万字符。

### 深入展开

1. **先纠正直觉**：不是"精度差一点"，是 171! 起直接 Infinity——两级失效（2^53 不精确 / 1.8e308 溢出）
2. **BigInt 方案**：循环写法 + toString 输出 + 与 Number 不混算
3. **手写大数**：数组低位在前存位、竖式乘法、carry 收尾，报一个可验证小例（10! = 3628800）
4. **规模量化**：Stirling 估位数 ≈ 556 万位，说明展示策略（位数 + 首尾）
5. **不阻塞**：Web Worker 独立线程；时间分片 setTimeout 让帧 + 进度回调
6. **框架结合**：computed 里同步死循环 = 渲染卡死，副作用挪出渲染路径

### 常见追问

- **100! 用普通 Number 输出什么？** → 9.332621544394414e157，科学计数法且低位已失真
- **BigInt 为什么慢？** → 每次乘法都是任意精度大整数运算，位数随 i 增长，总体远超 O(n)
- **BigInt 和 Number 能混算吗？** → 不能，`1n + 1` 抛 TypeError；需显式 BigInt(x)/Number(x) 转换
- **只要"结果有多少位"怎么最快？** → Stirling 公式 O(1) 估算 log10(n!)
- **时间分片和 Worker 怎么选？** → 要进度/依赖 DOM 用分片；纯计算、量大、不想排队主线程用 Worker
- **为什么 computed 里不能直接算？** → computed 在渲染路径同步执行，长循环直接冻结页面与交互
