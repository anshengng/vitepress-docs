# 自定义渲染器原理

## 为什么 Vue 能跨端

`@vue/runtime-core` 是平台无关的：它负责组件系统、VNode、patch、diff，
但从不直接调用 DOM API。所有与平台相关的操作（创建节点、插入、删除、改属性）
都通过 `createRenderer(options)` 的 options 注入，这层接口通常称为 nodeOps 抽象层。

```
┌──────────────────────────────────────┐
│           @vue/runtime-core          │
│     组件系统 / VNode / patch / diff    │
│        （不含任何平台相关代码）         │
└──────────────┬───────────────────────┘
               │ 只调用注入的接口
               ↓
┌──────────────────────────────────────┐
│     RendererOptions（平台注入层）      │
│   createElement / insert / patchProp  │
└──────────────┬───────────────────────┘
               ↓
     浏览器 DOM │ Canvas │ WebGL │ 原生组件
```

换一套 options，同一套核心就能把组件渲染到任何目标环境。
跨端的本质就是"核心逻辑与平台操作解耦"。

## 一、createRenderer API

```typescript
import { createRenderer } from 'vue'

// createRenderer<HostNode, HostElement>(options)
// 泛型参数让"节点"的真实类型由平台决定：DOM 里是 Node，Canvas 里是自定义对象
const { render, createApp } = createRenderer({
  // nodeOps：节点操作
  createElement(tag: string) { /* 创建"元素" */ },
  createText(text: string) { /* 创建文本节点 */ },
  insert(child, parent, anchor) { /* 插入到 anchor 之前 */ },
  remove(child) { /* 删除 */ },
  parentNode(node) { /* 取父节点 */ },
  nextSibling(node) { /* 取后一个兄弟 */ },
  setText(node, text) { /* 更新文本节点内容 */ },
  setElementText(el, text) { /* 更新元素文本内容 */ },
  createComment(text) { /* 创建注释节点（锚点用） */ },
  querySelector(selector) { /* 查找挂载容器 */ },
  // patchProp：属性操作（class / style / 事件 / 普通属性）
  patchProp(el, key, prevValue, nextValue) { /* ... */ }
})
```

| 分类 | 方法 | 说明 |
|---|---|---|
| 节点创建 | createElement、createText、createComment | "节点"可以是任意结构 |
| 树结构 | insert、remove、parentNode、nextSibling | 维护虚拟树 |
| 内容更新 | setText、setElementText、patchProp | 文本与属性更新 |
| 挂载入口 | querySelector | 定位根容器 |

返回值中的 `createApp` 来自内部工厂 `createAppAPI(render)`，
说明应用入口本身就是平台无关的（见第四节）。

## 二、runtime-dom 的本质

`@vue/runtime-dom` = runtime-core + 浏览器 nodeOps 的组合：

```typescript
// @vue/runtime-dom 的简化本质
import { createRenderer } from '@vue/runtime-core'

const nodeOps = {
  createElement: (tag: string) => document.createElement(tag),
  createText: (text: string) => document.createTextNode(text),
  setText: (node: Text, text: string) => { node.nodeValue = text },
  setElementText: (el: HTMLElement, text: string) => { el.textContent = text },
  insert: (child: Node, parent: Node, anchor?: Node | null) =>
    parent.insertBefore(child, anchor || null),
  remove: (child: Node) => {
    const parent = child.parentNode
    if (parent) parent.removeChild(child)
  },
  parentNode: (node: Node) => node.parentNode,
  nextSibling: (node: Node) => node.nextSibling,
  createComment: (text: string) => document.createComment(text),
  querySelector: (selector: string) => document.querySelector(selector)
}

// patchProp 按 key 分发：class / style / on 开头事件 / 普通属性
const patchProp = (el: any, key: string, prev: any, next: any) => {
  if (key === 'class') el.className = next ?? ''
  else if (key === 'style') { /* 合并样式 */ }
  else if (key.startsWith('on')) { /* 事件增删 */ }
  else if (next == null) el.removeAttribute(key)
  else el.setAttribute(key, next)
}

// 平台差异全部收敛在 options，核心逻辑一行不改
export const { render, createApp } = createRenderer({ ...nodeOps, patchProp })
```

平时用的 `createApp(App).mount('#app')`，底层就是这套浏览器渲染器，
`vue` 包只是把 runtime-dom 的导出再转发出来。

## 三、手写一个 Canvas 渲染器

目标：让 Vue 组件渲染到 canvas。思路：让"元素"变成普通对象，
patch 过程中维护这棵对象树，再递归把它绘制到 canvas 上。

```typescript
import { createRenderer } from 'vue'

// 1. 元素定义：不依赖 DOM 的普通对象
interface DrawNode {
  type: string
  props: Record<string, any>
  children: DrawNode[]
  parent: DrawNode | null
  text?: string
}

// 2. nodeOps：维护这棵对象树
const nodeOps = {
  createElement: (tag: string): DrawNode =>
    ({ type: tag, props: {}, children: [], parent: null }),
  createText: (text: string): DrawNode =>
    ({ type: 'text', props: {}, children: [], parent: null, text }),
  createComment: (): DrawNode =>
    ({ type: 'comment', props: {}, children: [], parent: null }),
  setText: (node: DrawNode, text: string) => { node.text = text },
  setElementText: (node: DrawNode, text: string) => {
    node.children = [nodeOps.createText(text)]
  },
  insert: (child: DrawNode, parent: DrawNode, anchor?: DrawNode | null) => {
    child.parent = parent
    const i = anchor ? parent.children.indexOf(anchor) : -1
    if (i > -1) parent.children.splice(i, 0, child)
    else parent.children.push(child)
  },
  remove: (child: DrawNode) => {
    const parent = child.parent
    if (parent) parent.children.splice(parent.children.indexOf(child), 1)
  },
  parentNode: (node: DrawNode) => node.parent,
  nextSibling: (node: DrawNode) => {
    const siblings = node.parent?.children ?? []
    return siblings[siblings.indexOf(node) + 1] ?? null
  },
  querySelector: () => null
}

// 3. patchProp：把属性写到节点对象上（颜色、坐标等）
const patchProp = (el: DrawNode, key: string, _prev: any, next: any) => {
  el.props[key] = next
}

// 4. 组装渲染器
const { createApp } = createRenderer({ ...nodeOps, patchProp })
```

使用与绘制：

```typescript
// 挂载到"虚拟根节点"，而不是 DOM 元素
const root = nodeOps.createElement('root')
createApp(App).mount(root)

// 递归把树绘制到 canvas（只处理 rect / text，示意）
function draw(node: DrawNode, ctx: CanvasRenderingContext2D) {
  for (const child of node.children) {
    if (child.type === 'rect') {
      ctx.fillStyle = child.props.fill ?? '#000'
      ctx.fillRect(+child.props.x, +child.props.y,
        +child.props.width, +child.props.height)
    } else if (child.type === 'text') {
      ctx.fillStyle = child.props.color ?? '#333'
      ctx.fillText(child.text ?? '', +child.props.x, +child.props.y)
    }
    draw(child, ctx) // 递归子节点
  }
}
draw(root, canvas.getContext('2d')!)
```

```vue
<!-- 组件照常写，只是"元素"换成自定义标签 -->
<script setup lang="ts">
import { ref } from 'vue'
const count = ref(0)
</script>

<template>
  <rect :x="10" :y="10" :width="100" :height="40"
        :fill="count % 2 ? '#42b883' : '#ccc'" />
  <text :x="20" :y="35" :color="count % 2 ? '#fff' : '#000'">{{ count }}</text>
</template>
```

patch 过程中，Vue 调用我们注入的 insert / patchProp 维护对象树；
响应式数据变化触发重新 patch 后，再 draw 一次即可。
组件写法、响应式、diff 全部复用 runtime-core，只有"画"这一步是自己的。

## 四、自定义 createApp

`createApp` 由 `createAppAPI(render)` 生成，`mount(container)` 只是
把根组件 render 到容器，容器是什么类型完全由渲染器决定：

```typescript
// 简化版实现
function createAppAPI(render: Function) {
  return function createApp(rootComponent: any) {
    const app = {
      mount(rootContainer: any) {
        const vnode = createVNode(rootComponent)
        render(vnode, rootContainer) // 平台无关：容器类型由渲染器决定
      }
      // use / component / directive / provide ...
    }
    return app
  }
}
```

因此可以 mount 到 canvas 的虚拟根节点（上文），也可以 mount 到
Web Worker 中的对象树、终端字符画——只要提供对应 nodeOps。

## 五、跨端应用

| 方案 | 渲染目标 | 说明 |
|---|---|---|
| @vue/runtime-dom | 浏览器 DOM | 官方默认渲染器 |
| uni-app / Weex | 原生视图（iOS / Android） | nodeOps 换成原生组件桥接 |
| TresJS / troisjs | WebGL（three.js） | 基于 createRenderer，组件映射为 three.js 对象 |
| @vue/server-renderer | HTML 字符串 | 渲染目标是字符串（SSR） |
| 自研 Canvas / SVG 渲染器 | 2D 画布 / 图形 | 可视化、大屏场景 |

## 面试答法

Vue 3 的 runtime-core 是平台无关的，组件、VNode、patch、diff 都在里面，
但所有平台操作都通过 createRenderer 的 options 注入，
runtime-dom 本质就是 runtime-core 加上浏览器 nodeOps 的组合。
所以只要换一套 nodeOps，就能把同一套组件模型渲染到 Canvas、WebGL 甚至原生组件，
uni-app、Weex、TresJS 都是这个思路。
实际项目中如果需要跨端，我会基于 createRenderer 提供目标平台的节点操作，
组件代码和响应式逻辑完全不用改，这也是我对"渲染器与核心解耦"的落地理解。
