# 前端路由原理（hash vs history）

## 题目

> 前端路由是怎么实现的？hash 模式和 history 模式有什么区别？各自的监听事件是什么？pushState 会触发 popstate 吗？为什么 history 模式刷新 404、Nginx 怎么配？Vue Router 和 React Router 的实现有什么差异？

## 为什么需要

传统多页应用每换一个页面都要向服务器要一整个 HTML，白屏、闪烁、重复加载公共资源。SPA 想让"切页面"像本地 App 一样瞬时完成——**页面内容由 JS 在前端渲染，URL 只是"当前视图的书签"**。但浏览器地址栏不会自己变，也不该骗用户，于是需要一个机制：**让 URL 变化与组件切换同步，且 URL 变化不向服务器要整页**。这就是前端路由。

类比：**餐厅点餐**。传统 MPA 是每点一道菜就重新开一张发票（整页请求）；SPA 路由是同一张发票上不断划掉旧菜、加新菜（`pushState` 改账单），厨房（服务器）全程不知情，只有客人按"返回键"时收银台才回忆上一笔（`popstate`）。

```
MPA：点击链接 ──► 卸载整页 ──► 请求服务器 ──► 重新解析/渲染 ──► 白屏闪烁
      /a.html                    GET /a.html

SPA：点击链接 ──► 拦截 ──► 改 URL（不发请求）──► 匹配路由表 ──► 只换局部组件
      /a ──► /b            pushState/改 hash        查表渲染 <B/>
```

## 核心要点

### 1. 两种模式的 URL 结构

```
hash 模式：
https://example.com/#/user/42
└──┬──┘└┬┘└────┬─────┘
  域名  #号    # 后面的整段叫 hash（fragment）
  → 服务器永远只收到 GET /，#/user/42 根本不发往服务端

history 模式：
https://example.com/user/42
└──┬──┘└───┬───┘
  域名    真实路径
  → 看起来和普通网页一模一样，刷新时浏览器会真的 GET /user/42
```

- **hash**：`#` 后的片段是"锚点"，本来用于页内跳转，改变它**不会触发页面请求**，天生安全。
- **history**：借助 H5 History API（`pushState`/`replaceState`/`back`）直接改写路径部分，URL 更干净，但**服务端必须配合**，否则刷新 404。

### 2. 监听机制：hashchange vs popstate

```
hash 模式流程：
用户点 <a href="#/about"> 或写 location.hash = '#/about'
        │
        ▼
浏览器改地址栏 ──► 触发 window 'hashchange' 事件
        │                    （旧值 oldURL / 新值 newURL 在事件对象里）
        ▼
路由库回调：解析 hash → 匹配路由表 → 渲染对应组件

history 模式流程：
JS 调 history.pushState(state, '', '/about') ──► 地址栏变成 /about
        │
        ✗ 注意：不会触发任何事件！（坑点，见下）
        ▼
用户点浏览器 前进/后退 键，或 JS 调 history.back()
        │
        ▼
触发 window 'popstate' 事件 ──► 路由库读 location.pathname → 匹配渲染
```

**关键坑点：`pushState` / `replaceState` 不会触发 `popstate`。** 这是规范行为——事件只在"导航被"前进/后退或 `back()/forward()` 消费"时才触发。所以路由库必须**自己劫持**：`router.push()` 内部先调 `pushState`，再**手动执行**视图更新逻辑；同时监听 `popstate` 兜住用户的物理前进后退键。

```javascript
// 手写极简 hash 路由
window.addEventListener('hashchange', () => {
  const path = location.hash.slice(1) || '/'
  renderRoute(path)                 // 查表 → 切换组件
})

// 手写极简 history 路由
const routes = { '/': Home, '/about': About }

function navigate(path) {
  history.pushState({ path }, '', path)   // 只改 URL，不触发 popstate
  renderRoute(path)                        // 所以必须手动渲染
}
window.addEventListener('popstate', (e) => {
  renderRoute(e.state?.path ?? location.pathname)  // 兜住前进/后退键
})

// 拦截所有链接点击，避免走真实请求
document.addEventListener('click', (e) => {
  const a = e.target.closest('a')
  if (a && a.href.startsWith(location.origin)) {
    e.preventDefault()
    navigate(new URL(a.href).pathname)
  }
})
```

### 3. SPA 一次路由切换的完整渲染流程

```
点击 <router-link to="/user/42">
   │ 1. 事件被路由库拦截（preventDefault）
   ▼
   │ 2. 守卫：beforeEach（鉴权/重定向）
   ▼
   │ 3. 匹配路由表：/user/:id → User 组件（可能懒加载，先拉 chunk）
   ▼
   │ 4. history.pushState 更新地址栏（hash 模式则改 location.hash）
   ▼
   │ 5. 响应式数据变化 → 卸载旧组件、挂载新组件（keep-alive 可缓存）
   ▼
   │ 6. afterEach：滚动行为恢复、页面标题、埋点
```

React Router 对应：`<Link>` 内部调 `navigate()` → 更新 `location` state → `RouterProvider` 上下文变化 → 所有 `<Route>` 重新匹配 → 命中的元素替换渲染。

### 4. history 模式的 404 问题与 Nginx 回退配置

```
首次进入 https://spa.com/ ──► 服务器返回 index.html ──► OK
进入站内后 pushState 到 /user/42 ──► 纯前端行为 ──► OK
用户直接刷新 /user/42 ──► 浏览器真的向服务器 GET /user/42
                        └─► 服务器上没有这个文件 ──► 404！

解法：服务端把所有"找不到文件"的请求回退到 index.html，
     交给前端路由去解析 pathname
```

```nginx
server {
  listen 80;
  root /usr/share/nginx/html;

  location / {
    # try_files 依次尝试：$uri → $uri/ → 最后回退 index.html
    try_files $uri $uri/ /index.html;
  }

  # 静态资源加 hash 名可长期缓存；index.html 不缓存
  location = /index.html {
    add_header Cache-Control "no-cache";
  }
}
```

要点：`try_files` 的兜底目标必须是 `/index.html`；真实 API 请求要放在 `try_files` 之前用单独的 `location /api` 代理，否则接口 404 也会被"回退成 HTML"，前端拿到一坨 HTML 当 JSON 解析。

### 5. hash vs history 全面对比

| 维度 | hash 模式 | history 模式 |
| --- | --- | --- |
| URL 形态 | `/#/path` 带井号，不够美观 | `/path` 正常路径 |
| SEO | 差，`#` 后内容服务器不可见 | 好，路径可被爬虫抓取 |
| 兼容性 | 极老浏览器也支持 | 需 H5 History API，IE10+ |
| 刷新/直达 | 永远 200（服务器只见 `/`） | 服务端不配置就 404 |
| 服务端要求 | **无** | 必须配 try_files / 通配回退 |
| 可携带页面信息 | 无路径语义 | 路径即语义，利于分享、埋点 |
| 典型场景 | 内部系统、静态托管不想改配置 | 对外站点、需要 SEO |

补充第三种：**abstract 模式**（Vue Router 的 `createMemoryHistory`）——不依赖任何浏览器 API，用内存数组模拟历史栈，供非浏览器环境使用（小程序、Node SSR、单元测试、原生壳内嵌渲染）。路由行为与 history 模式一致，只是 pushState 换成内存记录，URL 根本不变。

### 6. Vue Router 与 React Router 实现要点差异

| 维度 | Vue Router | React Router (v6+) |
| --- | --- | --- |
| 路由表形态 | 集中式 `createRouter({ routes })` 配置数组 | 组件式 `<Routes><Route/>` 嵌套 JSX（data 模式也有配置式） |
| 切换触发 | 依赖 Vue 响应式：`location` 是 ref，pushState 后视图自动更新 | 依赖 React 重渲染：`navigate` 更新 Router context 的 state |
| 导航守卫 | 全局/路由/组件三级 `beforeEach` 等 | 无显式守卫，用 `loader`/`action` + 重定向组件（如 `<RequireAuth>`）实现 |
| 懒加载 | `component: () => import(...)` | `React.lazy` + `Suspense`，或路由级代码分割 |
| 模式选择 | `createWebHistory` / `createWebHashHistory` 显式二选一 | `BrowserRouter` / `HashRouter` 两个 Provider 二选一 |
| 底层共同点 | 都是"拦截点击 → pushState/hash → 监听 popstate/hashchange → 匹配渲染"，pushState 不触发事件都需内部主动同步 | 同左 |

## 面试答法

### 30 秒版（可背诵）

> 前端路由的本质是"URL 变但页面不整页刷新，由 JS 按路由表切换组件"。hash 模式改 `location.hash`，监听 `hashchange` 事件，服务器永远只收到根路径请求，天然无 404 问题，但 URL 带井号、SEO 差；history 模式用 `pushState` 改写真实路径，URL 干净、利于 SEO，但刷新时浏览器会真的请求该路径，服务端必须用 Nginx 的 `try_files ... /index.html` 做回退。最大的坑是 `pushState` 不会触发 `popstate`，所以路由库的 push 是"改 URL + 手动渲染"两步，`popstate` 只负责兜住浏览器前进后退键。

### 深入版（被追问时按编号展开）

1. **画 URL 结构图**：标出 `#` 前后，讲清 hash 不发请求、history 是真实路径
2. **画两条监听流程**：hashchange 自动触发；pushState 静默 + popstate 只管前进后退
3. **点出核心坑**：pushState 不触发 popstate → 路由库必须劫持点击并主动渲染
4. **手写极简路由**：navigate 函数 = pushState + renderRoute，popstate 兜底
5. **404 与 Nginx**：刷新直达路径 → 服务端 try_files 回退 index.html，API 要单独代理
6. **框架差异收尾**：Vue Router 靠响应式 location，React Router 靠 context 重渲染，底层事件机制相同

### 常见追问

- **pushState 和 location.href 赋值的区别？** → `href` 赋值是真实导航，整页卸载重载；`pushState` 只往历史栈压一条记录并改地址栏，不发请求、不触发 popstate
- **popstate 的 state 参数哪来的？** → pushState 第一个参数存入历史条目，前进后退时浏览器原样带回；hashchange 事件则带 oldURL/newURL
- **为什么 hash 模式 SEO 差？** → 爬虫按 URL 请求，服务器只返回 `/`，`#` 后内容不进请求；搜索引擎历史上明确忽略 fragment
- **history 模式能完全替代 hash 吗？** → 功能上可以，但静态托管（GitHub Pages、OSS 直链）改不了服务端配置时只能用 hash，或托管平台的重写规则
- **SPA 首屏慢和路由模式有关吗？** → 无关；首屏慢在 JS bundle，优化靠路由懒加载、代码分割、SSR，路由模式只影响 URL 形态和服务端配置
- **浏览器地址栏手输 URL 走哪个事件？** → 都不走，那是真实页面加载；路由库只在"页面已加载后的站内导航"里起作用
