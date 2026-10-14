# Vue Router 原理

## 核心思路

Vue Router 4 的本质是**一个把 URL 与组件树解耦的运行时**：它监听 URL 变化 → 用路由表匹配出一个"当前路由记录" → 交给响应式的全局状态 → 再驱动 `<router-view>` 渲染对应组件。

| 概念 | 作用 |
|------|------|
| Router | 全局路由实例，持有路由表、当前路由（响应式）、监听器 |
| RouteRecord | 一条路由定义编译后的记录，嵌套路由形成层级 |
| RouteLocation | 解析后的当前路由对象（path / params / query / matched） |
| router-view | 出口组件，按 `matched` 深度决定渲染哪一层 |

## 两种路由模式

| 模式 | API | URL 形态 | 是否请求服务器 |
|------|-----|---------|--------------|
| hash | createWebHashHistory | `/#/user/1` | 否，`#` 之后内容由前端接管 |
| history | createWebHistory | `/user/1` | 是，直接请求该路径 |

### hash 模式

浏览器把 `#` 后面的部分当作 fragment，改变它不会触发页面刷新，只触发 `hashchange` 事件。因此 hash 模式**不需要任何服务端配置**，刷新也稳定。

### history 模式为什么要服务端配置

history 模式用 `history.pushState` / `replaceState` 修改 URL，不刷新页面。但一旦用户**在 `/user/1` 上手动刷新**，浏览器会真的向服务器请求 `/user/1`；服务器默认找不到这个物理文件就返回 404。

所以必须在 nginx 里配置回退：

```text
location / {
  try_files $uri $uri/ /index.html;
}
```

含义是：先找真实文件，找不到就统一返回 `index.html`，让前端路由接管。`/index.html` 兜底这一步就是 history 模式"必须有服务端配合"的原因。

## 创建路由实例

```typescript
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', component: Home },
    {
      path: '/user/:id',
      component: User,
      name: 'user',
      meta: { requiresAuth: true },
      children: [{ path: 'profile', component: Profile }]
    }
  ]
})
```

`createRouter` 内部做的关键事情：

```text
createRouter
    ↓ 归一化 routes，生成 matcher（path-to-regexp 思路）
matcher
    ↓ 解析初始 URL，得到当前 location
reactive 的 currentRoute（含 matched 数组）
    ↓ 注册 history 监听器（popstate / hashchange）
router.install(app)：app.provide(routerKey, router) + 全局组件注册
```

## 路由匹配

Vue Router 4 把每条 path 编译成一个匹配器，思路与 path-to-regexp 一致：把字符串路径变成带正则的分段。

| 写法 | 匹配结果 |
|------|---------|
| `/user/:id` | `params = { id: '1' }` |
| `/user/:id?` | 可选参数 |
| `/user/:id+` | 一个或多个（`repeatable`） |
| `/user/:id*` | 零个或多个 |
| `/user/:rest(.*)` | 自定义正则 |
| `/files/:path(.*)/:name` | 贪婪匹配 |

匹配流程：

```text
path 字符串
    ↓ 分词：静态片段 / 动态片段（:id） / 通配（*）
生成 tokens 与正则
    ↓ 对 URL 逐段匹配
命中 → 抽取 params，返回 RouteRecord
未命中 → 返回 undefined（渲染 404）
```

### 嵌套路由的层级

嵌套路由在 matcher 里被展开成一条**带 parent 链的记录**：

```text
routes: /user/:id  →  children: profile
    ↓ 展开
RouteRecord
  ├── path: /user/:id          （深度 0）
  └── child: /user/:id/profile （深度 1，parent 指向上层）
```

当导航到 `/user/1/profile`，匹配结果的 `matched` 是一个数组：

```text
matched = [ /user/:id 记录, /user/:id/profile 记录 ]
```

这个 `matched` 数组就是 router-view 分层的依据。

## router-view 的渲染流程

`router-view` 是一个**函数式组件**（无自身状态，渲染依赖外部响应式数据），它的核心逻辑：

```text
router-view 渲染
    ↓ 从 inject 拿到的 router 中读取 currentRoute
currentRoute.matched（响应式）
    ↓ 通过 props.depth / 自身在组件树中的深度计算
matched[depth] 对应的组件
    ↓ h(Component, routeProps)
渲染该组件
```

关键点：

| 机制 | 说明 |
|------|------|
| provide 注入 | `install` 时 `app.provide(routerKey, router)`，router-view 用 inject 拿到 router |
| depth 计算 | 每层 router-view 通过父级已渲染深度递增，决定取 `matched[depth]` |
| 响应式 | currentRoute 是 `shallowRef`，变化触发 router-view 重渲染 |
| 传参 | 默认把 matched 记录的 props 透传，配合 `props: true` 把 params 变成组件 props |

## 导航守卫

### 三类守卫

| 类型 | API | 能否取消导航 |
|------|-----|-------------|
| 全局 | beforeEach / beforeResolve / afterEach | 前两个可返回 false 或路由对象中断/重定向 |
| 路由独享 | beforeEnter（写在某条 route 上） | 可 |
| 组件内 | beforeRouteEnter / beforeRouteUpdate / beforeRouteLeave | 可 |

### 完整解析流程 resolve

一次导航从触发到落地，完整顺序（含守卫）：

```text
触发导航（router.push / 点击 router-link / popstate）
    ↓
1. 离开被放弃的组件：beforeRouteLeave（旧组件内）
    ↓
2. 全局 beforeEach
    ↓
3. 重用的组件：beforeRouteUpdate（同一组件不同参数）
    ↓
4. 进入路由的 beforeEnter（路由独享）
    ↓
5. 解析异步路由组件（若有，懒加载 chunk）
    ↓
6. 被激活组件内 beforeRouteEnter（此时组件实例还没创建，拿不到 this）
    ↓
7. 全局 beforeResolve
    ↓
8. 导航被确认
    ↓
9. 全局 afterEach（无法取消，常用于改标题/埋点）
    ↓
10. 触发 DOM 更新 → router-view 渲染
    ↓
11. beforeRouteEnter 的 next 回调执行（此时可拿到实例）
```

守卫的返回值语义：

```text
return false            → 中断导航
return '/login'         → 重定向到新地址
return { name: 'login' }→ 按命名路由重定向
return true / undefined → 放行
```

### beforeRouteEnter 与实例回调

```typescript
beforeRouteEnter(to, from, next) {
  // 此时组件实例尚未创建，this === undefined
  next((vm) => {
    // 回调在挂载后才执行，vm 是组件实例
    vm.loadData()
  })
}
```

## 懒加载与路由元信息

```typescript
const router = createRouter({
  routes: [
    {
      path: '/about',
      // 动态 import 返回 Promise，打包器自动代码分割成独立 chunk
      component: () => import('../views/About.vue'),
      meta: { title: '关于', requiresAuth: true }
    }
  ]
})

router.beforeEach((to) => {
  // meta 会随嵌套层级合并：子路由能读到父路由的 meta
  if (to.meta.requiresAuth && !isLogin()) return { name: 'login' }
  document.title = (to.meta.title as string) ?? ''
})
```

`meta` 是合并语义：一路 `matched` 上的 meta 会被浅合并到 `to.meta`，子级覆盖父级。

## router-link 原理

`router-link` 渲染成一个 `<a>` 标签，但拦截了原生跳转：

| 环节 | 处理 |
|------|------|
| href 生成 | 用 router.resolve 得到目标 URL，写入 href |
| click 处理 | 拦截普通左键（无修饰键）点击，`preventDefault` 后调用 `router.push` |
| 放行场景 | 右键、按住 ctrl/meta/shift、`target="_blank"`、`download` 等走原生 |
| 激活态 | 根据当前路由计算并添加 `router-link-active` / `router-link-exact-active` 类 |

自定义渲染用 `custom` + `v-slot`：

```vue
<router-link to="/about" custom v-slot="{ href, navigate, isActive }">
  <li :class="{ active: isActive }">
    <a :href="href" @click="navigate">关于</a>
  </li>
</router-link>
```

## 面试答法

Vue Router 4 的核心是把 URL 映射成一条路由记录，再用响应式的 currentRoute 驱动 router-view 渲染。它有两种历史模式：hash 模式基于 fragment 变化监听 hashchange，不需要服务端配置；history 模式用 pushState 改地址，但用户直接刷新深层路径时服务器会真的去请求它，所以必须在 nginx 里配置 try_files 把找不到的路径回退到 index.html，否则就 404。匹配方面，它把 path 编译成正则匹配器，动态参数通过 :id 这类语法抽取成 params，嵌套路由在匹配结果的 matched 数组里形成层级，router-view 是个函数式组件，通过 inject 拿到 router，再按自身深度从 matched 里取出对应组件渲染。导航守卫按离开、全局 beforeEach、组件 beforeRouteUpdate、路由 beforeEnter、异步组件解析、组件 beforeRouteEnter、全局 beforeResolve、确认、afterEach 这个顺序执行，返回 false 中断、返回路径则重定向；router-link 最终渲染成 a 标签，拦截普通左键点击转成 router.push，其余交给浏览器原生行为。
