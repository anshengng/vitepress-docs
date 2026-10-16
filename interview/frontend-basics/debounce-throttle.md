# 防抖与节流

## 题目

> 什么是防抖和节流？两者区别是什么？能手写一个吗？搜索框、resize、scroll 分别该用哪个？立即执行的防抖怎么写？和 requestAnimationFrame 有什么关系？

## 为什么需要

高频事件（scroll、resize、input、mousemove）一秒能触发上百次，每次都执行回调会疯狂消耗性能，甚至触发大量无用请求。两种思路：

- **防抖（debounce）**：事件连续触发时不执行，**等你"停下来"一段时间后才执行一次**——像公交车关门：不断有人上车就一直不开，最后一个乘客上来后等 3 秒才发车。
- **节流（throttle）**：无论触发多频繁，**固定间隔内最多执行一次**——像电梯：不管多少人排队，每 30 秒固定启停一次。

```
触发序列：  ──●──●─●●──────●●──●───────●──
（● = 一次事件）

防抖(3s)：  每次●都把定时器推到最后一串●结束后 3s ──────────────► 只执行 1 次
            （中间停手超过 3s，会提前执行一次）

节流(3s)：  ├─3s─内执行一次─┤├─3s─执行一次─┤├─3s─执行一次─┤
            固定节拍，一段间隔内触发多少次都只跑首（或尾）次
```

一句话：**防抖"等结束再干"，节流"按节拍干"。**

## 核心要点

### 1. 手写防抖（含立即执行版）

```javascript
function debounce(fn, delay, immediate = false) {
  let timer = null
  return function (...args) {
    if (timer) clearTimeout(timer)      // 核心：来一次就"重置倒计时"
    if (immediate && !timer) {
      fn.apply(this, args)              // 首次立即执行
      timer = setTimeout(() => { timer = null }, delay) // 冷却期
    } else {
      timer = setTimeout(() => {        // 停止触发 delay 后执行
        timer = null
        if (!immediate) fn.apply(this, args)
      }, delay)
    }
  }
}
```

```
立即执行版时间线（immediate=true）：
●──●─●●──────► 首个●立刻执行，之后全被吞掉，静默 delay 后重新武装
└执行          └────────冷却期────────┘└ 下一个●又可执行

普通版时间线：
●──●─●●──────► 什么都不做，最后一串结束后 delay 才执行
                          └─delay─┘└执行
```

进阶（lodash 有 cancel/flush）：可加 `debounce.flush = () => {...}` 手动提前执行。

### 2. 手写节流（时间戳版 + 定时器版）

```javascript
// 时间戳版：只有"第一次"和"间隔到后的下一次"会执行（leading）
function throttle(fn, interval) {
  let last = 0
  return function (...args) {
    const now = Date.now()
    if (now - last >= interval) {
      last = now
      fn.apply(this, args)
    }
  }
}

// 定时器版：触发后等 interval 执行"最后一次"的参数（trailing）
function throttle2(fn, interval) {
  let timer = null
  return function (...args) {
    if (timer) return                   // 窗口期内直接丢弃
    timer = setTimeout(() => {
      timer = null
      fn.apply(this, args)
    }, interval)
  }
}
```

| 版本 | 首次触发 | 停止触发后 | 特点 |
| --- | --- | --- | --- |
| 时间戳版 | 立即执行 | **不再执行**（最后一次可能丢） | leading，简单 |
| 定时器版 | 等一个间隔 | 还会执行一次 | trailing，参数是窗口内最后一次 |
| 两者结合 | 立即 + 结尾兜底 | 都有 | lodash 默认行为 |

### 3. 应用场景怎么选

| 场景 | 用哪个 | 理由 |
| --- | --- | --- |
| 搜索框输入联想 | 防抖 300ms | 打字中途的请求全是浪费，停下再发 |
| 表单校验 / 输入长度统计 | 防抖 | 同上 |
| 窗口 resize 后重排布局 | 防抖 | 拖拽过程无所谓，松手算一次即可 |
| scroll 触底加载 / 返回顶部按钮显隐 | 节流 | 需要**持续反馈**，全等结束就晚了 |
| 拖拽跟随、mousemove 画线 | 节流（或 rAF） | 每帧更新一次位置 |
| 按钮防连点 / 下单提交 | 防抖 immediate=true 或节流 | 第一次立刻生效，期间全部拦截 |
| 发送短信验证码倒计时 | 节流 | 固定间隔 |

### 4. 和 requestAnimationFrame 的关系

```
setTimeout 的问题：最小间隔被钳制(~4ms)、后台标签页被降频(≥1s)、和屏幕刷新不同步

rAF：浏览器保证在【下一次重绘前】回调，约 16.7ms 一次（60Hz）
     → 用 rAF 做"节流"，天然对齐渲染帧率，动画不丢帧不浪费

scroll 事件 + rAF 节流模板：
let ticking = false
window.addEventListener('scroll', () => {
  if (ticking) return
  ticking = true
  requestAnimationFrame(() => { update(); ticking = false })
})
```

本质是"每帧最多执行一次"的自适应节流，比固定 interval 更贴合渲染节奏。

## 面试答法

### 30 秒版（可背诵）

> 防抖是事件连续触发时不断重置定时器，等停止触发一段时间后才执行一次，像公交车等人齐了再发车，适合搜索框联想、resize 后重排；节流是固定间隔内最多执行一次，像电梯定时启停，适合 scroll 加载、mousemove 跟随。手写上防抖核心是 clearTimeout + setTimeout，节流核心是时间戳或定时器加窗口期丢弃。立即执行版防抖是首次触发就调用、之后进入冷却期，常用于按钮防连点。另外高频动画类节流可以用 requestAnimationFrame，按屏幕刷新帧率执行，比 setTimeout 更精准。

### 深入版（被追问时按编号展开）

1. **画图对比**：先画触发序列 + 两条时间线，讲清"重置倒计时"与"固定节拍"的本质区别
2. **手写防抖**：clearTimeout 重置；immediate 版用"timer 是否存在"当冷却标志
3. **手写节流**：时间戳版 leading（丢最后一次）、定时器版 trailing（首次延迟），组合版两者都要
4. **场景表**：搜索框/resize 防抖，scroll/拖拽节流，按钮防连点立即执行版
5. **rAF 加分**：setTimeout 精度问题 + 每帧一次天然节流 + scroll 模板
6. **收尾**：lodash 的 debounce/throttle 有 leading/trailing/maxWait 选项，生产直接用

### 常见追问

- **防抖立即执行版怎么实现？** → 首次 `!timer` 时直接调用，然后挂一个只负责"到期清空 timer"的定时器作为冷却期
- **节流为什么可能丢最后一次执行？** → 时间戳版窗口结束后无兜底；要兜底就在停止触发时补一个 trailing 定时器
- **maxWait 是干什么的？** → 节流的上限等待时间：即使触发频率低于间隔，也保证最多等 maxWait 必执行一次（lodash 选项）
- **Vue 模板里怎么用？** → `@input="debounce(handle, 300)"` 注意要在 data/created 里生成**同一个**防抖实例，写在 methods 里每次渲染都会新建导致失效
- **React 里防抖函数为什么容易失效？** → 每次 render 都重新创建闭包，timer 不共享；用 `useMemo`/`useRef` 固化实例
