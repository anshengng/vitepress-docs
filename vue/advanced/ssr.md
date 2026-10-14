# SSR 与水合（Hydration）

## 一、CSR / SSR / 同构对比

| | CSR（客户端渲染） | SSR（服务端渲染） | 同构（SSR + 水合） |
|---|---|---|---|
| HTML 来源 | JS 在浏览器里生成 | 服务器生成完整 HTML | 服务端出 HTML，客户端接管 |
| 首屏速度 | 慢（等 JS 下载执行） | 快（HTML 直出） | 快 |
| SEO | 差（爬虫可能拿不到内容） | 好 | 好 |
| 服务器成本 | 静态托管即可 | 每次请求都渲染，消耗 CPU | 同 SSR |
| 开发复杂度 | 低 | 中（区分两端环境） | 高（水合、状态序列化） |
| 可交互时机 | JS 执行后 | 需等客户端 JS 水合 | 需等客户端 JS 水合 |

SSR 只是"把首屏 HTML 发给浏览器"，页面要可交互仍然需要客户端 JS 接管，
这一步就是水合（Hydration）。所以现代 SSR 方案（Nuxt / Next）本质都是同构。

## 二、SSR 渲染流程

### 服务端：组件 → HTML 字符串

```typescript
// server.mjs（Node 端）
import { createSSRApp, h, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'

const app = createSSRApp({
  setup() {
    const msg = ref('hello')
    return () => h('div', msg.value)
  }
})

// 组件在服务端执行 → 返回 HTML 字符串
const html = await renderToString(app)
// html: '<div>hello</div>'

// 拼进完整页面返回给浏览器
res.send(`<!DOCTYPE html>
<html><body><div id="app">${html}</div></body></html>`)
```

服务端只做"一次性渲染"：执行 setup 和 render → 输出字符串。
没有真实挂载、没有渲染 effect、没有 onMounted（没有真实 DOM 可挂）。
除了 renderToString，还有 renderToPipeableStream 支持流式输出，
配合 Suspense 边界可以渐进下发 HTML。

### 整体流程图

```
浏览器                          Node 服务器
  │  请求页面                       │
  │ ─────────────────────────────→ │
  │                                │ createSSRApp(App)
  │                                │ renderToString(app)
  │                                │ 组件 → HTML 字符串
  │ ←───────────────────────────── │
  │  返回 HTML + 客户端 bundle 引用 │
  │                                │
  │  解析 HTML，首屏立即可见         │
  │  （此时还不可交互）              │
  │                                │
  │  下载并执行客户端 bundle        │
  │  createSSRApp(App)             │
  │  mount('#app', true) 水合      │
  │                                │
  │  复用 DOM + 绑定事件            │
  │  页面完全可交互                 │
```

## 三、客户端水合

水合 = 让客户端的 Vue "认领"服务端渲染出来的 DOM：
不重新创建节点，只逐节点比对复用，并补充事件监听等只有客户端能做的事。

```typescript
// entry-client.ts
import { createSSRApp } from 'vue'
import App from './App.vue'

// 注意：客户端也用 createSSRApp，它的 mount 默认走水合模式
createSSRApp(App).mount('#app')
// 等价于 app.mount('#app', true) —— 第二个参数即 isHydrate
```

### mount(root) 与 mount(root, true) 的区别

| | mount(root)（CSR） | mount(root, true)（水合） |
|---|---|---|
| 使用场景 | 纯客户端应用 | SSR 后的客户端接管 |
| DOM 处理 | 全部新建（createElement + insert） | 复用服务端 HTML 里已有的 DOM |
| 代码路径 | mountElement | hydrateNode（vnode 与真实 DOM 逐个比对） |
| 事件 | 创建节点时绑定 | 比对通过后在已有节点上补绑 |

```typescript
// 简化版实现：能复用就复用，只补客户端需要的部分
function hydrateNode(vnode: VNode, node: Element) {
  vnode.el = node               // 直接认领现有 DOM，不创建
  patchProps(vnode)             // 补 props（重点是 SSR 产不出的事件监听）
  hydrateChildren(vnode, node)  // 递归比对子节点
}
```

为什么水合比"推倒重来"好：DOM 已经在页面上，浏览器不用等 JS 重建节点、
不用重新排版，Vue 只做一次 vnode 与 DOM 的对账，用户看到的首屏不闪动。

## 四、hydration mismatch

水合的前提：服务端和客户端渲染出的结构完全一致。
不一致（mismatch）时，Vue 会在开发环境告警，并丢弃该处的服务端 DOM、
改为客户端重新渲染——SSR 的首屏优势在这一子树就丢了。

```
服务端 HTML:  <div class="a"><span>1</span></div>
客户端 vnode:  <div class="a"><p>1</p></div>
                        ↑ 标签不一致
结果：Hydration node mismatch 警告
     → 该子树 DOM 被丢弃，客户端重建
```

常见原因：

```typescript
// 1. 时间 / 随机数：两端执行结果必然不同
const time = Date.now()
const id = Math.random()

// 2. 直接访问浏览器 API：服务端直接报错
const width = window.innerWidth

// 3. cookie / localStorage：服务端拿不到，两端初始状态不同
const theme = localStorage.getItem('theme')
```

## 五、同构组件注意点

同一份组件代码跑在两端，必须区分环境：

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'

// setup 两端都会执行：这里不能碰 window / document
const width = ref(0)

// 浏览器 API 放到只在客户端执行的钩子里
onMounted(() => {
  width.value = window.innerWidth
  window.addEventListener('resize', () => {
    width.value = window.innerWidth
  })
})
</script>

<template>
  <div>窗口宽度：{{ width }}</div>
</template>
```

```typescript
// 也可以用编译时常量判断运行环境（Vite 提供，构建期替换）
if (!import.meta.env.SSR) {
  // 仅客户端执行的逻辑，可被 tree-shaking
}
```

| 关注点 | 服务端 | 客户端 |
|---|---|---|
| setup | 执行（一次性，无渲染 effect） | 执行 |
| onBeforeMount / onMounted | 不执行 | 执行 |
| onUpdated / onUnmounted | 不执行 | 执行 |
| onServerPrefetch | 执行（渲染前拉取异步数据） | 不执行 |
| window / document / localStorage | 不可用（直接报错） | 可用 |
| 组件状态数据 | 必须可序列化（要传给客户端） | 正常使用 |

## 六、Nuxt 一句话

Nuxt 是基于 Vue 的上层全栈框架，把 SSR 入口、水合、文件路由、数据获取、
打包部署整套流程封装好，开箱即用，还支持 SSG 与纯 CSR 模式切换。

## 面试答法

SSR 是在服务端用 createSSRApp 加 renderToString 把组件渲染成 HTML 字符串直出首屏，
所以首屏快、SEO 好，代价是服务器开销和更高的复杂度。
客户端拿到 HTML 后会加载同一个应用的 bundle，用 mount(root, true) 走水合模式：
复用服务端产出的 DOM，只补绑事件，不重建节点。
水合要求两端渲染结果一致，出现 mismatch 时 Vue 会警告并丢弃该处 DOM 重新渲染，
所以时间随机数、浏览器 API、本地存储这类两端差异要小心处理。
写同构组件时 setup 里不能用 window/document，只有 onMounted 这类钩子在客户端执行，
实际项目一般直接用 Nuxt 把这套流程自动化。
