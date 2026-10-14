# render 和 h 函数

## 概念

三个都是 Vue3 中和虚拟 DOM 相关的 API。

## 1. h — 创建虚拟节点

`h` 是 `createElement` 的简写（hyperscript），用于**创建虚拟节点**。

```typescript
import { h } from 'vue'

// 创建一个 div 虚拟节点
const vnode = h('div', { class: 'box' }, 'hello')

// 创建组件虚拟节点
const vnode = h(MyComponent, { title: 'test' })
```

等价于：

```typescript
import { createVNode } from 'vue'

const vnode = createVNode('div', { class: 'box' }, 'hello')
```

## 2. createVNode — 底层 API

`createVNode` 是更底层的创建虚拟节点的方式，`h` 内部就是调用它。

```typescript
import { createVNode } from 'vue'

const vnode = createVNode('div', { class: 'box' }, 'hello')
```

### 区别

- `h` 是 `createVNode` 的语法糖，用法更简洁
- `createVNode` 可以指定更多参数（如 patchFlag、dynamicProps 等优化标记）
- 日常用 `h` 就够了，内部库或编译器产物用 `createVNode`

## 3. render — 渲染虚拟节点到容器

`render` 用于把虚拟节点**渲染到真实 DOM**。

```typescript
import { h, render } from 'vue'

const vnode = h('div', { class: 'box' }, 'hello')

// 渲染到 body
render(vnode, document.body)

// 清除（传 null）
render(null, document.body)
```

## 对比总结

| API | 作用 | 类比 |
|-----|------|------|
| `h` | 创建虚拟节点 | `document.createElement` |
| `createVNode` | 创建虚拟节点（底层） | 同上，更底层 |
| `render` | 把虚拟节点渲染到 DOM | `appendChild` |

## 在 createDialog 中的用法

```typescript
import { h, render } from 'vue'
import Message from './Message.vue'

// 1. 用 h 创建组件虚拟节点
const vnode = h(Message, {
  type: 'success',
  message: '操作成功',
  onClose: () => {
    // 2. 传 null 清除
    render(null, container)
  }
})

// 3. 用 render 渲染到容器
const container = document.createElement('div')
render(vnode, container)
document.body.appendChild(container)
```

## 类比理解

```javascript
// 传统 DOM 操作
const div = document.createElement('div')   // 相当于 h
div.textContent = 'hello'
document.body.appendChild(div)              // 相当于 render

// Vue3
const vnode = h('div', null, 'hello')       // 创建虚拟节点
render(vnode, document.body)                // 渲染到 DOM
```

**简单说**：`h` 是"创建"，`render` 是"渲染"。

## VNode 结构

```typescript
interface VNode {
  type: string | Component   // 标签名或组件
  props: Record<string, any> // 属性
  children: VNode[] | string // 子节点
  el: Element | null         // 对应的真实 DOM
  // ...其他内部属性
}

// h('div', { class: 'box' }, 'hello') 会创建
{
  type: 'div',
  props: { class: 'box' },
  children: 'hello',
  el: null
}
```

## 渲染流程

```typescript
import { h, render } from 'vue'

// 1. 创建 VNode
const vnode = h('div', { class: 'box' }, [
  h('span', null, 'hello'),
  h('span', null, 'world')
])

// 2. 渲染到 DOM
const container = document.getElementById('app')
render(vnode, container)

// 3. 更新（创建新 VNode 对比 diff）
const newVnode = h('div', { class: 'box updated' }, 'changed')
render(newVnode, container)

// 4. 卸载
render(null, container)
```

## 手动渲染组件示例

```typescript
import { h, render, ref, defineComponent } from 'vue'

// 定义组件
const Counter = defineComponent({
  props: { initial: { type: Number, default: 0 } },
  setup(props) {
    const count = ref(props.initial)
    return { count }
  },
  render() {
    return h('div', [
      h('span', null, `Count: ${this.count}`),
      h('button', { onClick: () => this.count++ }, '+')
    ])
  }
})

// 手动渲染
const vnode = h(Counter, { initial: 10 })
const container = document.createElement('div')
render(vnode, container)
document.body.appendChild(container)
```
