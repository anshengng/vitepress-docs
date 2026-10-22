# Vite 底层原理（开发阶段）

Vite 开发服务器的核心思路：**不打包应用源码，把"模块图"交给浏览器**。服务器只做三件事——起 HTTP 服务、用 esbuild 预构建依赖、按需转换单个模块。本页讲冷启动、ESM 按需请求、依赖预构建、HMR 四块底层机制。构建阶段（Rollup 打包）见 [Rollup 执行流程与架构总览](/notes/rollup/architecture-flow)。

## 为什么冷启动快

传统打包器（Webpack）在 dev server 就绪之前，必须从入口出发**构建完整 bundle**：项目越大，启动越慢。Vite 启动时应用源码一个模块都不碰：

| 环节 | Webpack dev | Vite dev |
| --- | --- | --- |
| 启动时 | 解析全部模块 → 打包 → 起服务 | 起服务 + esbuild 预构建 `node_modules` 依赖 |
| 首次请求 | 直接给整包 bundle | 给原始 HTML，浏览器再逐个请求模块 |
| 转换成本 | 全量，与项目规模成正比 | 单文件，只转"浏览器真正请求到的" |
| 未用到的代码 | 照样打进包 | 根本不会被请求、不会被转换 |

Vite 敢这么做的前提是：现代浏览器原生支持 ESM，`import` 语句可以由浏览器自己发起网络请求来解析。

## 浏览器原生 ESM 按需请求 + import 重写

浏览器发出的 `import` 说明符（如 `'vue'`、`'./App'`）在浏览器环境下无法直接工作：bare specifier 不能解析、`.ts` 不能执行、相对路径可能带扩展名省略。Vite 在响应模块请求时插入一层**重写**：`vite:import-analysis` 插件在 transform 阶段解析 AST，把所有 import 改写成浏览器可用的 URL。

完整请求链路：

```
浏览器                     Vite Dev Server                    磁盘 / 缓存
  │ GET /src/main.ts            │
  │ ───────────────────────────>│ transformMiddleware
  │                             │   ① resolveId → 定位文件
  │                             │   ② load：读源码
  │                             │   ③ transform 链：
  │                             │      esbuild 转 TS → 插件 transform
  │                             │      → vite:import-analysis 重写 import
  │  <──── 200 重写后的 JS ─────│
  │
  │ 收到代码里的 import 被改写成：
  │   import { ref } from 'vue'
  │     → import { ref } from "/node_modules/.vite/deps/vue.js?v=7c2f1e8a"
  │   import App from './App'
  │     → import App from "/src/App.vue"
  │
  │ GET /node_modules/.vite/deps/vue.js?v=7c2f1e8a
  │ ───────────────────────────>│ 静态中间件直接命中预构建缓存
  │  <──── 预构建好的 ESM ──────│（强缓存：max-age=31536000, immutable）
  │
  │ GET /src/App.vue            │（浏览器继续递归请求，按需展开模块图）
```

要点：

- **重写发生在 transform 链尾**，同时注入 HMR 客户端运行时（`@vite/client` 的入口模块）
- 依赖路径带 `?v=哈希` 查询串：预构建结果更新后 URL 变化，天然绕过浏览器强缓存
- 应用源码响应带 `etag`/`last-modified`，二次请求命中则返回 304
- 模块图由浏览器请求"爬"出来，Vite 服务端用 `ModuleGraph` 记录 `url → module → importers` 关系，供 HMR 使用

## esbuild 依赖预构建做了什么

启动时扫描入口 HTML 与 `optimizeDeps.entries`，收集所有 bare import 的第三方依赖，交给 esbuild 打包，输出到 `node_modules/.vite/deps`。预构建解决三个问题：

1. **CJS/UMD → ESM 转换**：浏览器原生 ESM 无法执行 `require`，esbuild 把 CommonJS 包装成 ESM 导出（这就是为什么 CJS 包不加 `include` 会报 "does not provide an export named"，配置见 [resolve 与依赖预构建](/notes/vite/resolve-deps)）
2. **合并请求数**：`lodash-es` 有 600+ 个 ESM 小文件，逐个请求会产生数百次往返；预构建合并成 1 个文件
3. **语法降级**：把依赖里过新的语法转成浏览器基线目标

缓存失效规则：按 `lockfile 内容 + 配置哈希` 命名缓存目录，依赖或配置变化自动重建。会话中途发现新依赖（动态 import 到没预构建过的包）时，Vite 会**重新预构建并触发整页刷新**——这是 dev 阶段偶发"页面自己刷了一下"的原因。

### 为什么预构建用 esbuild，打包却用 Rollup

| 维度 | 预构建（esbuild） | 构建打包（Rollup） |
| --- | --- | --- |
| 首要目标 | 快（Go 实现，比 JS 打包器快 10~100 倍） | 产物质量 |
| 需要的能力 | CJS→ESM、合并文件、语法转换 | 精确 tree-shaking、chunk 分割、多格式输出 |
| 输出要求 | 只给浏览器 dev 用，丑一点无所谓 | 给生产用，要接近手写 ESM |
| 为什么不用对方 | esbuild 的 bundle 语义（变量重命名、splitting）不如 Rollup 精细 | Rollup 是 JS 写的，冷启动预构建太慢 |

Rollup 在构建阶段的具体管线（分块、去冲突、格式包装）见 [Rollup 执行流程与架构总览](/notes/rollup/architecture-flow)，tree-shaking 原理见 [Rollup Tree-shaking 原理](/notes/rollup/tree-shaking)。

## HMR 原理

HMR = 文件变更后**只替换变化的模块**，不丢应用状态。通信链路是 WebSocket：服务端 watch 到变更 → 计算影响面 → 推送 update 消息 → 浏览器端 `@vite/client` 决定怎么更新。

```
磁盘文件 src/Counter.vue 变更
    │ chokidar watch
    ▼
server.onFileChange
    ├─ ModuleGraph.getModulesByFile → 找到受影响模块
    ├─ invalidate：标记失效，并把失效状态沿 importers 向上传播
    ▼
findHotAccept(受影响模块)          # 沿 importers 向上找"接受边界"
    │
    ├─ 找到带 import.meta.hot.accept 的边界模块
    │       ▼
    │   ws.send({ type: 'update', updates: [...] })
    │       ▼
    │   浏览器 @vite/client 收到
    │       ├─ updateType 'css' → 直接替换 style 标签内容（无需边界）
    │       └─ updateType 'js'  → 执行边界模块的 accept 回调
    │                              （重新 import 新模块，跑回调，页面状态保留）
    │
    └─ 找不到任何边界
            ▼
        ws.send({ type: 'full-reload' })   # 全页刷新兜底
```

三条规则展开：

- **CSS**：`vite:css` 给每个 CSS 模块注入自接受代码，更新方式是替换 DOM 里的 style/link 内容，永远不触发刷新、不丢状态
- **JS 边界查找**：从变更模块出发，沿 `importers`（谁 import 了我）向上走；某模块自己写了 `import.meta.hot.accept()`，或其父模块 accept 了它，就构成"边界"，在边界处执行回调热替换
- **找不到边界**：传播到入口仍无人 accept → `full-reload`。业务代码没写 accept 时看到的"整页刷新"就是这条路径

简化源码（服务端边界查找，`src/node/server/hmr.ts` 思路）：

```ts
// 沿 importers 向上找 accept 边界（简化）
function findHotUpdateBoundary(mod: ModuleNode): ModuleNode | null {
  const queue = [mod]
  while (queue.length) {
    const current = queue.shift()!
    // 自接受：模块内写了 import.meta.hot.accept(...)
    if (current.isSelfAccepting) return current
    // 被某个 importer 显式 accept
    for (const importer of current.importers) {
      if (importer.acceptedHmrDeps.has(current)) return importer
      queue.push(importer)   // 继续向上爬
    }
  }
  return null                // 没有边界 → 全页刷新
}
```

## 简化源码：transformMiddleware 关键路径

按需转换的调度核心（`src/node/server/middlewares/transform.ts` 大幅简化）：

```ts
export function transformMiddleware(server): Middleware {
  return async function viteTransformMiddleware(req, res, next) {
    const url = parseUrl(req)
    // ① 只处理"像模块"的请求：带扩展名，或带 ?import/?v 查询
    if (!isJSRequest(url) && !isImportRequest(url) && !isCSSRequest(url)) {
      return next()   // 其他请求交给静态中间件
    }

    // ② 去掉 ?v= 版本串，解析成模块 id，查 ModuleGraph
    const normalizedUrl = removeVersionQuery(normalizeUrl(url))
    const module = await server.moduleGraph.getModuleByUrl(normalizedUrl)

    // ③ 协商缓存：模块未失效且 etag 匹配 → 304，跳过转换
    if (module && req.headers['if-none-match'] === module.transformResult?.etag) {
      return send304(res)
    }

    // ④ transformRequest：load 读文件 → esbuild 转 TS/JSX
    //    → 依次跑插件 transform 钩子（pre → normal → post）
    //    → vite:import-analysis 重写 import + 注入 HMR 运行时
    const result = await transformRequest(normalizedUrl, server.config, { ssr })

    // ⑤ 按类型设置 MIME 返回（js / css / map）
    send(req, res, result.code, 'js')
  }
}
```

插件如何挂进这条 transform 链、`enforce`/`apply` 的作用，见 [Vite 插件开发基础](/notes/vite/plugin-dev)。

## 速查表

| 机制 | 一句话 |
| --- | --- |
| 冷启动快 | 不 bundle 源码，只起服务 + 预构建依赖 |
| 模块解析 | 浏览器原生 ESM 按需请求，服务端 transform 时重写 import |
| 预构建 | esbuild：CJS→ESM、合并小文件、语法降级，缓存于 `node_modules/.vite/deps` |
| 预构建失效 | lockfile/配置哈希变化自动重建；会话中发现新依赖 → 重建 + 全页刷新 |
| HMR 通信 | WebSocket 推送 update / full-reload 消息 |
| CSS 更新 | 直接替换 style 标签，永不刷新 |
| JS 更新 | 沿 importers 向上找 `import.meta.hot.accept` 边界，找不到则全页刷新 |
| 缓存策略 | 依赖强缓存 + `?v=` 版本号；源码 etag 协商返回 304 |

## 相关页面

- [Rollup 执行流程与架构总览](/notes/rollup/architecture-flow) —— `vite build` 的底层
- [Rollup 插件生命周期与钩子系统](/notes/rollup/plugin-hooks) —— Vite 插件钩子语义的来源
- [Rollup Tree-shaking 原理](/notes/rollup/tree-shaking)
- [Vite 插件开发基础](/notes/vite/plugin-dev)
- [插件配置与常用插件](/notes/vite/plugins)
