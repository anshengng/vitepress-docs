# 组件的本质形态

## 问题

Vue 每个组件都是一个对象吗？是不是必须有 `render` 和 `setup`？

## 结论先行

**组件定义是对象或函数，组件实例永远是对象**。大多数情况下组件是对象，唯一例外是函数式组件。

## 组件定义通常长这样（对象）

```typescript
import { h, ref } from 'vue'

const MyComponent = {
  props: { title: String },
  setup(props) {
    const count = ref(0)
    return () => h('div', null, [props.title, count.value])
  },
}
```

### setup 返回渲染函数时，不需要单独的 render

`setup` 和 `render` **不是必须同时有**，优先级是：

```typescript
const MyComponent = {
  // 方式一：setup 返回渲染函数（Composition API 推荐）
  setup() {
    const count = ref(0)
    return () => h('div', null, count.value)
  },
}

const MyComponent2 = {
  // 方式二：setup 返回状态对象，render 负责渲染
  setup() {
    return { count: ref(0) }
  },
  render() {
    return h('div', null, this.count)
  },
}
```

如果 `setup` 返回的是函数，Vue 直接把它当渲染函数用，`render` 字段会被忽略。

## 单文件组件最终也会变成对象

`<script setup>` 只是编译期语法糖：

```vue
<script setup>
import { ref } from 'vue'
const count = ref(0)
</script>

<template>
  <div>{{ count }}</div>
</template>
```

编译后等价于：

```typescript
export default {
  setup() {
    const count = ref(0)
    return { count }
  },
  render() {
    return h('div', null, this.count)
  },
}
```

所以不管写法多花哨，**SFC 落到运行时就是一个组件对象**。

## Options API 也是对象

```typescript
export default {
  data() {
    return { count: 0 }
  },
  methods: {
    increment() { this.count++ }
  },
  template: '<div @click="increment">{{ count }}</div>',
}
```

## 例外：函数式组件是函数

```typescript
// 一个普通函数就是合法组件：props 为第一个参数
const FunctionalButton = (props, { slots }) => {
  return h('button', { class: 'btn' }, slots.default?.())
}
```

函数式组件没有自身实例状态（没有 `setup`、没有生命周期），Vue 遇到函数类型的组件定义时直接调用它拿 VNode，性能开销更小，适合纯展示场景。

## 组件定义 vs 组件实例

这是最容易混淆的一对概念：

| | 组件定义 | 组件实例 |
|---|---|---|
| 谁写的 | 开发者 | Vue 内部创建 |
| 形态 | **对象或函数** | **永远是对象** |
| 数量 | 一份（可复用） | 每次使用创建一个 |
| 内容 | setup / render / options | props、state、subTree、proxy 等 |

```typescript
// 开发者给出定义（对象）
const MyComponent = { setup() { ... } }

// Vue 内部为每次使用创建实例（永远是对象）
const instance = {
  type: MyComponent,   // 指向组件定义
  props: {},
  setupState: {},
  subTree: null,       // render 产出的 VNode
  isMounted: false,
  proxy: new Proxy({}, {/* 代理到 instance 的各数据源 */}),
}
```

## 总结

1. 组件定义通常是对象（setup/render 对象、SFC 编译产物、Options API），但函数式组件是函数
2. `setup` 和 `render` 不必同时存在：setup 返回函数时它就是渲染函数
3. 组件实例由 Vue 内部创建，永远是对象——"每个组件是一个对象"在实例层面永远成立
