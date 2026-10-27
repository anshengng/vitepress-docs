# 性能优化总览：三条战线与一条基线

性能优化不是一堆配置开关，而是先搞清楚「慢在哪一段」，再选对应的手段。前端项目里其实有三条互相独立的战线，混在一起谈就会变成玄学。

## 三条战线

| 战线 | 优化对象 | 典型症状 | 主要手段 | 度量方式 |
| --- | --- | --- | --- | --- |
| **构建性能** | 开发、CI 的编译打包过程 | 改一行等 30 秒；CI 构建 20 分钟 | 缓存、并行、换编译器、缩小处理范围 | 冷构建耗时、热构建耗时、缓存命中率 |
| **产物性能** | 产物体积与加载 | 首屏 3 MB JS、白屏 5 秒 | 分包、Tree-shaking、压缩、懒加载 | 产物体积、gzip/brotli 后大小、请求数、LCP |
| **运行时性能** | 页面跑起来之后的交互 | 滚动掉帧、输入延迟、列表卡顿 | 减少渲染、虚拟列表、拆分长任务 | INP、FPS、Long Task 数量 |

三条战线在一条时间轴上的位置：

```
源码
 │  ① 构建性能：让"源码 → 产物"这一段更快
 ▼
bundle（体积、分包结构）
 │  ② 产物性能：让"下载 → 解析"这一段更少
 ▼
网络（缓存、CDN、压缩）
 │
 ▼
浏览器（解析、构建渲染树、绘制）
 │  ③ 运行时性能：让"交互 → 响应"这一段更顺
 ▼
用户
```

关键认知：**构建快不等于页面快，页面快也不代表构建不痛苦**。三条战线要分别度量、分别优化，否则很容易「优化了构建速度，却让产物更大」。

## 一条基线：先度量再动手

没有基线就没有优化，只有猜测。至少记录四组数：

| 维度 | 记录什么 | 怎么记 |
| --- | --- | --- |
| 构建 | 冷构建、热构建、CI 总耗时 | `time npm run build`、CI 日志、构建分析工具 |
| 体积 | 每个 chunk 的原始大小 + 压缩后大小 | 构建输出、bundle analyzer |
| 加载 | FCP / LCP / 请求数 / 传输字节 | Lighthouse、Chrome Network |
| 运行时 | INP / CLS / 长任务 | Lighthouse、`web-vitals`、Performance 面板 |

原则：**一次只改一个变量**，改完回测同一组指标。同时改五个配置，最后无法判断哪个起了作用。

具体工具与命令见[度量与分析](/notes/performance/measurement)。

## 优化优先级：先做收益最大的

```
① 删除不需要的代码   Tree-shaking、按需引入、去掉重复依赖
        ↓
② 延后不需要的代码   路由懒加载、动态 import、分包
        ↓
③ 压缩要传输的内容   minify、gzip / brotli
        ↓
④ 让内容可被复用     内容哈希、长效缓存、CDN
        ↓
⑤ 减少运行时的开销   虚拟列表、批量更新、拆长任务
```

顺序背后的逻辑：

- **删除 > 延后 > 压缩 > 缓存**：少传一个字节，比压缩一个字节、缓存一个字节都彻底。
- 前三步直接减少「首屏必须下载的字节数」，对 LCP 的影响远大于运行时微调。
- 缓存能显著改善「第二次访问」，但对第一次访问无效，所以不能放在第一位。

## 各工具在三条战线上的位置

| 工具 | 构建阶段角色 | 构建提速抓手 | 产物优化抓手 |
| --- | --- | --- | --- |
| **Webpack** | 全流程 loader + plugin | `cache`、`thread-loader`、SWC/esbuild 替换 Babel、缩小 `include` 范围 | `splitChunks`、`usedExports` + `sideEffects`、minifier |
| **Vite** | 开发用 esbuild 按需编译，生产用 Rollup | 依赖预构建、`server.warmup`、减少开发期插件 | `manualChunks`、`minify`、`cssCodeSplit`、`modulePreload` |
| **Rollup** | 库打包主力 | `external`、减少 transform 插件、`perf` 定位 | Tree-shaking、输出格式、`sourcemap` 开关 |
| **esbuild** | 依赖预构建、转换、压缩 | Go 并发模型，本身即快 | `minify`、`splitting`、`treeShaking` |

同一件事在不同工具里的叫法不同，但本质是同一批杠杆。本栏目按主题拆页，每页末尾附各工具对照表，方便横向查。

## 常见误区

| 误区 | 问题所在 | 正确做法 |
| --- | --- | --- |
| 只盯 Lighthouse 分数 | 分数受网络、设备、缓存影响大，不等于业务指标 | 结合 LCP/INP 与真实用户数据（RUM） |
| 盲目把 vendor 拆成很多小包 | HTTP/2 下请求数不是主要矛盾，反而增加请求开销 | 按「变更频率」分组，而不是按包名无限拆分 |
| 开了 minify 却没开传输压缩 | 文本资源还能再小 60%~80% | 服务端/CDN 开 gzip 或 brotli |
| 依赖 CJS 包却期待 Tree-shaking | CJS 无法静态分析导入导出 | 换 ESM 版本，或直接按需引入 |
| 开发环境开生产级 sourcemap / minify | 慢的是自己的配置，不是工具 | 开发、生产两套配置分开 |
| 只看冷构建，不看热构建 | 日常开发靠的是缓存命中后的增量构建 | 分别记录冷、热构建耗时 |
| 为了快把所有 loader 都套 thread-loader | 线程通信本身有开销，小项目反而更慢 | 只给真正耗时的 loader 加 |

## 阅读顺序

1. 本页：先分清三条战线，建立优先级
2. [Webpack 构建提速](/notes/performance/build-speed-webpack)
3. [Vite 与 Rollup 构建提速](/notes/performance/build-speed-vite-rollup)
4. [代码分割与分包策略](/notes/performance/bundle-splitting)
5. [Tree-shaking、压缩与资源优化](/notes/performance/tree-shaking-compress)
6. [度量与分析](/notes/performance/measurement)

概念和面试口径可以配合[前端基础 · Web 性能优化](/interview/frontend-basics/performance-optimization)一起看：那篇讲「有哪些手段、为什么有效」，本栏目讲「在构建工具里怎么落地」。
