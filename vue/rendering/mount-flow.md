# 应用挂载与组件挂载流程

## 问题

`App.vue` 是根组件，它的子组件是怎么被"挂载"到页面上的？`mount` 过程到底发生了什么？

## 入口代码

```typescript
import { createApp } from 'vue'
import App from './App.vue'

const app = createApp(App)
app.mount('#app')
```

## 大致流程

```
createApp(App)
    ↓
app.mount('#app')
    ↓
createVNode(App)            创建根组件的 VNode
    ↓
render(vnode, container)    渲染器入口
    ↓
patch(null, vnode)          新旧对比（首次旧节点为 null）
    ↓
processComponent            发现是组件类型 VNode
    ↓
mountComponent              创建实例、执行 setup、建立渲染 effect
    ↓
renderComponentRoot         执行组件的渲染函数 → 得到子树 VNode
    ↓
patch(子树)                 子树里遇到组件 VNode → 递归 mountComponent
                            遇到元素 VNode → 创建真实 DOM
    ↓
container.append(el)        真实 DOM 自下而上组装并插入
```

## 源码解析

### mount：创建根 VNode 交给渲染器

```typescript
// runtime-dom（简化）
const mount = (rootContainer) => {
  // 1. 根组件只是一个组件定义，先包装成 VNode
  const vnode = createVNode(rootComponent, rootProps)
  // 2. 交给渲染器，从 null（无旧节点）开始 patch
  render(vnode, rootContainer)
}
```

### patch：按 VNode 类型分发

```typescript
// runtime-core（简化）
const patch = (n1, n2, container) => {
  if (n1 === n2) return

  // 组件类型 → 走组件挂载/更新
  if (typeof n2.type === 'object' || typeof n2.type === 'function') {
    processComponent(n1, n2, container)
  } else {
    // 元素类型 → 创建/更新真实 DOM，并递归处理子节点
    processElement(n1, n2, container)
  }
}
```

### mountComponent：组件真正"活"起来的一步

```typescript
// runtime-core（简化）
const mountComponent = (vnode, container) => {
  // 1. 创建组件实例（就是那个普通对象）
  const instance = createComponentInstance(vnode)

  // 2. 初始化：执行 setup，处理 props/slots
  setupComponent(instance)   // setup 的返回值：状态或渲染函数

  // 3. 建立渲染 effect：组件的响应式依赖在这里收集
  setupRenderEffect(instance, container)
}

const setupRenderEffect = (instance, container) => {
  effect(() => {
    // 执行渲染函数得到子树 VNode（template 编译成的 render）
    const subTree = renderComponentRoot(instance)
    // 递归 patch 子树：子树里可能还有组件 VNode
    patch(null, subTree, container)
    // 子树的真实 DOM 全部就位后，记录到实例上
    instance.subTree = subTree
  })
}
```

**关键在递归**：`setupRenderEffect` 里 `patch` 子树，子树里若还有组件 VNode，会再次进入 `processComponent → mountComponent`，一层层深入到叶子节点（纯元素）为止。

## 几个关键点

### 1. VNode 自上而下创建，DOM 自下而上插入

```
App render()
  → Header 的 VNode 创建（还没有真实 DOM）
  → Main 的 VNode 创建
      → Sidebar 的 VNode 创建
      → Content 的 VNode 创建
  → Footer 的 VNode 创建

真实 DOM 组装：反过来的
  Sidebar 的 DOM 完成 → 挂到 Main
  Content 的 DOM 完成 → 挂到 Main
  Main 的 DOM 完成 → 挂到 App 的容器
  Header / Footer 同理
  整棵树插入 #app
```

### 2. mounted 钩子：子先父后

因为 DOM 是自下而上组装的，所以 `mounted` 的触发顺序是**最深的子组件先触发，根组件最后**。`onMounted` 里拿 `ref`、DOM 一定可用。

### 3. 挂载完成后组件并不"持有" DOM

组件实例上记录的是 `subTree`（VNode），后续数据变化时重新执行渲染 effect 生成新 VNode，新旧 VNode 做 diff（patch）再更新真实 DOM。

## 用比喻说

把组件树当成公司组织架构：

- `createApp(App)` = 注册成立总公司
- `mount('#app')` = 总公司入驻写字楼（容器）
- 每个"子组件挂载" = 成立一家子公司，子公司还得等自己的下属部门（真实 DOM 节点）装修完才能挂牌
- 挂牌顺序：最底层的部门先完工，逐级向上，最后总公司揭牌（`mounted` 子先父后）

## 总结

`mount` 的本质是一条**递归的 patch 链**：根组件 VNode → `mountComponent`（创建实例 + setup + 渲染 effect）→ 渲染函数产出子树 VNode → 子树里再有组件就递归 `mountComponent`，遇到元素就创建真实 DOM。VNode 自上而下创建，真实 DOM 自下而上组装，这决定了 `mounted` 钩子的子先父后顺序。
