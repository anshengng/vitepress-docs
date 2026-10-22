# Vite 插件开发基础

Vite 插件 = **Rollup 插件接口 + Vite 扩展钩子**。一个返回 `{ name, ...钩子 }` 的对象，既能挂进构建（Rollup 管线），也能挂进开发服务器（serve 管线）。本页讲扩展钩子、插件排序机制和两个完整示例；钩子的 first/parallel/seq 调度语义在 [Rollup 插件生命周期与钩子系统](/notes/rollup/plugin-hooks) 已展开，此处不重复。插件的**使用**（常用官方/社区插件）见[插件配置与常用插件](/notes/vite/plugins)。

## 复用 Rollup 钩子 + Vite 扩展钩子

Rollup 钩子（`resolveId` / `load` / `transform` / `renderChunk` / `generateBundle` 等）在 Vite 中全部可用，语义一致。Vite 额外增加了一组钩子，覆盖 Rollup 够不到的环节——配置阶段和 dev server 阶段：

| 扩展钩子 | 触发时机 | 典型用途 |
| --- | --- | --- |
| `config(config, env)` | 配置文件解析**之前** | 修改/合并配置（`env.command` 区分 serve/build） |
| `configResolved(config)` | 配置合并完成后 | 只读最终配置，初始化插件内部状态 |
| `configureServer(server)` | dev server 创建时（仅 serve） | 添加中间件、注册自定义 API、监听文件 |
| `configurePreviewServer(server)` | preview server 创建时 | 同上，针对 `vite preview` |
| `transformIndexHtml(html, ctx)` | HTML 被处理时（serve 和 build 都跑） | 注入 script/meta 标签、改写 HTML |
| `handleHotUpdate(ctx)` | dev 阶段文件变更时 | 自定义 HMR 影响面（返回 `[]` 可阻止默认更新） |
| `applyToEnvironment(environment)` | 环境（environment）维度 | Vite 6 环境 API：控制插件在 client/ssr/自定义环境中是否生效 |

关于 per-environment：Vite 6 把 client、ssr 等抽象为并列的 Environment，`resolveId`/`load`/`transform` 等核心钩子按环境各跑一遍。插件可用 `applyToEnvironment(environment)` 返回 false 跳过某些环境，替代早期 `apply: 'ssr'` 之类的 hack。

钩子还可以写成对象形式，携带顺序与调度提示：

```js
{
  name: 'my-plugin',
  transform: {
    order: 'pre',        // 等价于插件级 enforce，仅影响该钩子
    handler(code, id) { /* ... */ }
  }
}
```

## enforce / apply 与插件容器顺序

`enforce` 决定插件在容器中的插入点，`apply` 决定插件在哪个阶段生效：

```js
{
  name: 'my-plugin',
  enforce: 'pre',            // 'pre' | 默认(normal) | 'post'
  apply: 'serve',            // 'serve' | 'build' | 函数(config, env) => boolean
}
```

Vite 解析配置后，把 `config.plugins` 重排成固定顺序的插件容器：

```
alias 插件（resolve.alias）
  ↓
enforce: 'pre' 插件（数组内保持注册顺序）
  ↓
正常插件（无 enforce）
  ↓
enforce: 'post' 插件
  ↓
Vite 核心构建插件（仅 build：commonjs、数据 URL 等）
  ↓
post 类核心插件（仅 build：vite:build-html、esbuild 压缩等）
```

注意：`vite:import-analysis`、`vite:css` 等核心 transform 插件位于 normal 之后，所以业务插件的 `transform` 默认先于 import 重写执行——想处理"重写后"的代码需要 `enforce: 'post'`。

## 示例一：虚拟模块插件

凭空造一个磁盘上不存在的模块。`resolveId` + `load` 两钩配合，`\0` 前缀是约定：告诉其他插件"这是虚拟 ID，别拿去查文件系统"。

```js
// plugins/virtual-user.js
function virtualUserPlugin(user) {
  const virtualId = 'virtual:user'      // 业务代码 import 的说明符
  const resolvedId = '\0' + virtualId   // 内部 ID：\0 前缀隔离文件系统/其他插件

  return {
    name: 'virtual-user',
    // first 语义：返回非 null 即短路，接管该说明符的解析
    resolveId(source) {
      if (source === virtualId) return resolvedId
    },
    // 看到内部 ID 时凭空给出源码（磁盘上并没有这个文件）
    load(id) {
      if (id === resolvedId) {
        return `export const name = ${JSON.stringify(user.name)}
export const role = ${JSON.stringify(user.role)}`
      }
    }
  }
}

// vite.config.js
export default defineConfig({
  plugins: [virtualUserPlugin({ name: 'alice', role: 'admin' })]
})

// 业务代码
// import { name, role } from 'virtual:user'
```

带参数的虚拟模块（如 `virtual:icon/name`）用 `startsWith` 匹配即可，原理相同。

## 示例二：transformIndexHtml 注入脚本

给 HTML 注入标签，serve 与 build 都生效。返回数组是声明式注入，Vite 负责插入位置：

```js
// plugins/inject-tracker.js
function injectTrackerPlugin({ scriptSrc, buildTime }) {
  return {
    name: 'inject-tracker',
    transformIndexHtml: {
      order: 'pre',   // 'pre' 在 Vite 核心 HTML 处理前跑；'post' 可拿到重写后的 HTML
      handler(html, ctx) {
        // ctx.server 存在 → dev 阶段；ctx.bundle 存在 → build 阶段
        return [
          {
            tag: 'script',
            attrs: { src: scriptSrc, defer: true },
            injectTo: 'body'            // 'head' | 'head-prepend' | 'body' | 'body-prepend'
          },
          {
            tag: 'meta',
            attrs: { name: 'build-time', content: String(buildTime) },
            injectTo: 'head'
          }
        ]
      }
    }
  }
}
```

也可以直接返回字符串（自己改写 HTML），或返回 `{ tags: [...], headTags: [...], bodyTags: [...] }` 对象形式。

## 开发期与构建期的行为差异

写跨阶段插件最容易踩的坑：

| 差异点 | serve | build |
| --- | --- | --- |
| 生效钩子 | Rollup 钩子按需触发（浏览器请求到才 transform） | 完整 Rollup 生命周期全跑一遍 |
| `transform` 调用次数 | 同一模块可能因缓存失效多次执行 | 每模块一次 |
| 专有钩子 | `configureServer`、`handleHotUpdate` | `renderChunk`、`generateBundle`、`writeBundle` |
| `transformIndexHtml` 的 ctx | `ctx.server` | `ctx.bundle` |
| HTML 的 import 重写 | 运行时中间件做 | `vite:build-html` 在 Rollup 图里做 |
| 插件数组顺序 | 核心插件按上图插入 | 额外追加一批构建专用核心插件 |

实践建议：

- 只在某阶段有意义的插件显式标 `apply: 'serve'` 或 `apply: 'build'`，避免另一半管线误触发
- 用 `configResolved` 缓存最终配置，不要在每个钩子里重复读
- 需要 dev 中间件的逻辑放 `configureServer`，构建期等价逻辑（如产物注入）放 `generateBundle`，一个插件两副面孔是常态

## 速查表

| 需求 | 钩子 |
| --- | --- |
| 拦截/改写 import 路径 | `resolveId` |
| 提供非文件源码 | `load`（配 `\0` 约定） |
| 编译/改写模块内容 | `transform` |
| 改配置 | `config`（写）/ `configResolved`（读） |
| dev 加接口/中间件 | `configureServer` |
| 注入 HTML 标签 | `transformIndexHtml` |
| 定制文件变更响应 | `handleHotUpdate` |
| 控制插入点 | `enforce` 取 `'pre'` / `'post'`，或钩子对象 `order` |
| 控制生效阶段 | `apply` 取 `'serve'` / `'build'`，或 `applyToEnvironment` |

## 相关页面

- [Rollup 插件生命周期与钩子系统](/notes/rollup/plugin-hooks) —— first/parallel/seq 调度语义、插件上下文 API
- [Vite 底层原理（开发阶段）](/notes/vite/dev-principle) —— transform 链在 dev 请求中的位置
- [插件配置与常用插件](/notes/vite/plugins)
