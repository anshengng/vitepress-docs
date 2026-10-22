# 资源提示符：async、defer、prefetch、preload

## 为什么需要

脚本加载时机和资源预取策略直接决定 **FCP/LCP** 等核心性能指标：同步 script 让白屏时间等于脚本下载时间；首屏关键字体不用 preload 会闪烁；SPA 路由的下一个 chunk 用 prefetch 能让"秒开"。面试用这题考察：是否真正理解 HTML 解析、脚本执行、DOMContentLoaded 三者的时序关系，以及浏览器资源调度优先级。

## 核心要点

### 1. script 四种加载模式：ASCII 时间线

```
时间轴 ──────────────────────────────────────────────────────►

HTML 解析器（█=正常解析，░=被同步脚本阻塞暂停）：

① 普通 <script src="a.js">
   解析: ████████░░░░░░░░░░░░░░████████
   脚本:         └下载a┘└执行a┘
   说明: 下载+执行期间解析完全暂停（下载慢 = 白屏久）

② async <script async src="a.js">
   解析: ████████████████████████
   脚本:   └──下载a──┘└执┘  ← 下载完就抢着执行，可打断解析
   说明: 与解析并行；谁先下完谁先执行 → 多个 async 顺序不保证

③ defer <script defer src="a.js">
   解析: ████████████████████████│
   脚本:   └────下载a────┘       └执┘ ← 解析完才执行
   说明: 与解析并行；多个 defer 严格按文档顺序执行

④ <script type="module">（ESM）
   行为同 defer：异步下载、文档顺序执行、自动严格模式
```

**关键时序结论**：

| 问题 | 答案 |
| --- | --- |
| DOMContentLoaded 何时触发 | DOM 解析完 + **defer/module 脚本执行完**；不等 async、不等样式表、不等图片 |
| load 何时触发 | 整页资源（图片/样式/async 脚本）全部完成 |
| async 与 defer 最大区别 | 执行时机：async 下载完立即执行（乱序、可打断解析）；defer 等解析完按序执行 |
| 老项目兼容 | defer 在 IE9 才完整支持；async IE10 起 |

```
时间线汇总：

 HTML 开始解析 ──► DOM 解析完成 ──► defer 脚本执行 ──► DOMContentLoaded
                        ▲                ▲
        async 脚本可能在任意时刻插入执行 ──┘（与上面无关，谁先下完谁执行）
 所有资源完成 ──► window.onload
```

### 2. link rel 资源提示对比表

| rel | 作用 | 优先级 | 触发时机 | 用途范围 | 典型场景 |
| --- | --- | --- | --- | --- | --- |
| `preload` | **当前页**马上要用的资源，提前拉取 | 高 | 立即 | 本页 | 首屏字体、关键图片、首屏 CSS |
| `prefetch` | **下一次导航**可能要用的资源 | 低（空闲） | 当前页加载后空闲时 | 下一页 | SPA 下一路由 chunk、下一页资源 |
| `preconnect` | 提前完成 DNS+TCP+TLS 握手 | 高 | 立即 | 第三方源 | CDN、字体、API 域名 |
| `dns-prefetch` | 仅提前 DNS 解析 | 低 | 立即 | 第三方域 | 老浏览器兜底（现代浏览器已自动预解析） |
| `modulepreload` | preload + 执行 ESM 依赖图 | 高 | 立即 | 当前页 | Vite 预加载路由 chunk |
| `prerender` | 投机预渲染整个下一页 | 最高（贵） | 空闲 | 下一页 | 已被 Speculation Rules API 取代 |

```html
<!-- preload：必须配 as，字体/跨域资源还要 crossorigin -->
<link rel="preload" href="/fonts/main.woff2" as="font"
      type="font/woff2" crossorigin>

<!-- prefetch：路由级预取 -->
<link rel="prefetch" href="/next-page.js">

<!-- preconnect：只握手不下载 -->
<link rel="preconnect" href="https://cdn.example.com">
```

### 3. preload vs prefetch 易错点

- **preload 是"欠债"**：高优先级抢占带宽，preload 了却没在当页用到 → 浪费首屏带宽，反而变慢。原则：只 preload 首屏关键且**发现得晚**的资源（如 CSS 里引用的字体）。
- **prefetch 不进 HTTP 缓存主缓存**：部分浏览器放内存缓存，命中率看运气，别当 CDN 预热用。
- **preload 重复请求坑**：`as` 写错或缺 `crossorigin` 会导致二次下载（预取的资源与真正请求"身份"不一致）。
- 面经原话"async/defer 都不阻塞主线程解析 DOM"正确；补充一点：**async 执行那一刻是阻塞的**——下载不阻塞，执行会打断解析（见时间线②）。

## 面试答法

### 30 秒版本（可直接背诵）

> script 默认同步，下载+执行期间 HTML 解析暂停。async 异步下载、下载完立即执行，会打断解析且多个 async 顺序不保证；defer 异步下载、等 HTML 解析完按文档顺序执行，DOMContentLoaded 会等 defer 但不等 async。link 的资源提示里，preload 是高优先级预取"当前页马上要用"的资源（要配 as 和 crossorigin），prefetch 是低优先级在空闲时预取"下一个页面"的资源，preconnect 提前做 DNS+TCP+TLS 握手，dns-prefetch 只解域名。一句话：defer 管执行时机，preload 管当前页下载优先级，prefetch 管下一页的投机下载。

### 深入展开

1. **画三条时间线**（同步/async/defer 对 HTML 解析的阻塞差异），这是本题核心图。
2. **讲 DOMContentLoaded 与 load 的分界**：defer 在 DCL 前执行完、async 不参与 DCL 等待。
3. **preload/prefetch 优先级与范围对比**，强调 preload 滥用抢带宽、prefetch 不保证命中缓存。
4. **工程落地**：SPA 路由 chunk 用 prefetch（webpack magic comment / Vite modulepreload）；字体用 preload；第三方 CDN 域名 preconnect。
5. **收尾加分**：Speculation Rules 预渲染、`fetchpriority` 属性、Lighthouse 的 "preload key requests" 审计项。

### 常见追问

- **多个 defer 脚本执行顺序？** → 严格按文档顺序；多个 async 按下载完成顺序，可能乱序。
- **defer 脚本里能 document.write 吗？** → 不能，解析已结束，会重新打开文档；操作 DOM 用 DOMContentLoaded。
- **preload 和直接写 link/script 的区别？** → preload 只下载不执行/不应用，用于"资源在 CSS/JS 里深层引用、扫描器发现太晚"的场景；能直接声明就别 preload。
- **prefetch 和 preload 缓存行为差异？** → preload 进 HTTP 缓存正常复用；prefetch 常只进内存缓存，刷新即失效。
- **为什么字体要 crossorigin 预加载？** → 字体按 CORS 模式请求，preload 若不带 crossorigin 会以"非 CORS"身份下载，真正请求时缓存不命中、二次下载。
- **`<script>` 放 body 底部还需要同步 defer 吗？** → 底部同步脚本不阻塞首屏渲染但仍在 DOM 构建后串行执行；defer 可提前并行下载，且保证 DCL 前就绪，更优。
