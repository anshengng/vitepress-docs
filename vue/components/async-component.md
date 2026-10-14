# 异步组件与 defineAsyncComponent

## 为什么需要异步组件

同步 import 会把组件代码全部打进首屏包，首屏包越大，解析与执行越慢。异步组件把「组件代码的加载」推迟到真正需要渲染时，实现：

| 收益 | 说明 |
|------|------|
| 代码分割 | 打包器把异步组件拆成独立 chunk，按需下载 |
| 首屏优化 | 首屏只加载必需代码，其余延后 |
| 按需渲染 | 大组件（图表、编辑器、弹窗）用到才加载 |
| 弱网体验 | 加载期间可展示 loading 占位 |

## 基本用法

```typescript
import { defineAsyncComponent } from 'vue'

// 工厂函数必须返回 Promise，import() 返回的就是 Promise
const AsyncComp = defineAsyncComponent(() => import('./BigChart.vue'))
```

```vue
<template>
  <AsyncComp />
</template>
```

## 完整选项

```typescript
const AsyncComp = defineAsyncComponent({
  // 1. 加载器：返回 Promise<组件定义>
  loader: () => import('./Heavy.vue'),

  // 2. 加载中展示的组件
  loadingComponent: Loading,

  // 3. 延迟多少毫秒后才显示 loading，避免闪烁
  delay: 200,

  // 4. 加载失败展示的兜底组件
  errorComponent: ErrorView,

  // 5. 超时毫秒数，超时视为加载失败
  timeout: 3000,

  // 6. 是否交给上层 <Suspense> 处理
  suspensible: false,

  // 7. 加载失败回调，可决定重试或放弃
  onError(error, retry, fail, attempts) {
    if (attempts <= 3 && error.message === 'fetch failed') retry()
    else fail()
  }
})
```

| 选项 | 默认 | 作用 |
|------|------|------|
| loader | 必填 | 返回 Promise 的加载函数 |
| loadingComponent | 无 | pending 时展示的占位组件 |
| delay | 200 | loading 展示延迟，配合 loadingComponent 使用，抑制闪烁 |
| errorComponent | 无 | rejected 时展示的兜底组件 |
| timeout | Infinity | 超过该毫秒数即置为 rejected |
| suspensible | true | 是否被 `<Suspense>` 接管 |
| onError | 无 | 允许重试 / 失败决策，签名 `(error, retry, fail, attempts)` |

## 加载状态机

```text
defineAsyncComponent(loader)
    │
    ▼
pending ── 调用 loader() ──► Promise 产生
    │                              │
    │                       ┌──────┴───────┐
    ↑ delay 期间无渲染      │              │
    │              resolve  │              │ reject / timeout
    │                    ▼                 ▼
    │              resolved               rejected
    │              → 渲染真实组件           → errorComponent / onError
    │                                       → 可 retry 回到 pending
    └───────────────────────────────────────┘
```

源码里的实现（简化）：

```typescript
// runtime-core/src/apiAsyncComponent.ts
export function defineAsyncComponent(source) {
  if (isFunction(source)) source = { loader: source }
  const {
    loader, loadingComponent, errorComponent,
    delay = 200, timeout, suspensible = true, onError
  } = source

  let pendingRequest          // 记录 Promise，避免并发重复加载
  let resolvedComp            // 缓存已解析的组件
  let retries = 0

  const load = () => {
    // 执行 loader，返回 Promise；失败时走 onError（可能 retry）
    return loader().catch((err) => {
      if (onError) { /* 交给用户决定 retry / fail */ }
      else throw err
    })
  }

  // 包装组件：真正的异步组件是它
  const AsyncComponent = defineComponent({
    name: 'AsyncComponentWrapper',
    __asyncLoader: load,               // 供 Suspense 识别
    async setup(_, { expose }) {
      // 1. 已解析过：直接用缓存，不再加载
      if (resolvedComp) return () => createInnerComp(resolvedComp, instance)

      // 2. 首次加载，pendingRequest 去重
      let request = pendingRequest
      if (!request) {
        request = pendingRequest = load().then((comp) => {
          resolvedComp = isESModule(comp) ? comp.default : comp
          return resolvedComp
        })
      }

      // 3. 处理超时：超时后把 request 置为 rejected
      if (timeout) { /* setTimeout 到时 reject */ }

      // 4. 被 Suspense 接管：把 Promise 抛给 Suspense 等待
      if (isSuspense(instance.vnode.shapeFlag) && suspensible) {
        return request
      }

      // 5. 未被接管：等加载完成后返回渲染函数，先渲染占位
      return new Promise((resolve) => {
        request.then(() => resolve(() => createInnerComp(resolvedComp, instance)))
      })
    },
    // 依据状态选择 loading / error / 真实组件
    render() { /* ... */ },
    errorCaptured(err) { /* 触发 errorComponent */ }
  })

  return AsyncComponent
}
```

要点：

1. 异步组件不是「组件本身异步」，而是用一个**包装组件（AsyncComponentWrapper）代理**，内部用响应式状态记录 pending / resolved / rejected。
2. 加载完成（resolve）后包装组件重新渲染，进而渲染真实组件，这也是它需要响应式状态来触发重渲染的原因。
3. `__asyncLoader` 与 `__asyncResolved` 是给 Suspense 识别的标记；`pendingRequest` 用于去重，避免 Suspense 与本地两条路径重复加载。

## 与路由懒加载的关系

```typescript
// 路由懒加载本质上也是异步组件
const routes = [
  { path: '/detail', component: () => import('./Detail.vue') }
]
```

| 维度 | defineAsyncComponent | 路由 () => import() |
|------|----------------------|---------------------|
| 场景 | 组件级按需加载（任意组件内可用） | 路由级按需加载（进入路由时才加载） |
| 交互反馈 | 可配 loading / error / timeout | 加载期通常用路由守卫或进度条体现 |
| 底层 | 包装成带 `__asyncLoader` 的组件 | 路由器内部也会把它按异步组件处理 |

两者底层都是 `import()` 产生的代码分割，区别只是「在哪里使用、由谁承载加载态」。

## 与 Suspense 配合

```vue
<template>
  <Suspense>
    <template #default><AsyncChart /></template>
    <template #fallback><Loading /></template>
  </Suspense>
</template>
```

| 配置 | 行为 |
|------|------|
| suspensible 为 true 且在 `<Suspense>` 内 | async setup 把加载 Promise 抛给 Suspense，由 fallback 承载加载态 |
| suspensible: false | 异步组件自己管 loadingComponent，不走 Suspense |
| Suspense 内多个异步组件 | 全部 resolve 后一次性渲染，未完成时展示 fallback |

Suspense 会把异步组件 setup 返回的 Promise 收集起来，等全部 resolve 才渲染默认插槽，期间显示 fallback。

## 面试答法

异步组件是为了做代码分割和首屏优化：同步 import 会把所有组件打进首屏包，而把组件定义改成返回 Promise 的工厂函数后，打包器就能把它拆成按需加载的独立 chunk。`defineAsyncComponent` 除了 loader，还支持 loadingComponent、errorComponent、delay、timeout、suspensible 和 onError，加载期先渲染 loadingComponent、失败渲染 errorComponent，delay 用来抑制 loading 闪烁，onError 里可以 retry。它的实现不是组件本身异步，而是用一个带 `__asyncLoader` 标记的包装组件代理，内部用响应式状态记录 pending / resolved / rejected，加载完成后触发包装组件重渲染、再渲染真实组件，并用 pendingRequest 去重避免重复加载。它和路由的 `() => import()` 一样，底层都是 `import()` 做代码分割，区别只是使用位置和谁承载加载态；在 Suspense 内且 suspensible 为 true 时，加载 Promise 会交给 Suspense 统一等待，由 fallback 承载加载态。
