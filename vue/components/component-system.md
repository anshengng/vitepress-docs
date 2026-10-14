# 组件系统

## 组件本质

组件就是一个**对象或函数**，有自己的状态和渲染函数。

### Options API 组件

```typescript
const MyComponent = {
  props: { title: String },
  data() {
    return { count: 0 }
  },
  methods: {
    increment() { this.count++ }
  },
  render() {
    return h('div', null, this.count)
  }
}
```

### Composition API 组件（setup）

```typescript
const MyComponent = {
  props: { title: String },
  setup(props) {
    const count = ref(0)
    const increment = () => count.value++
    return { count, increment }
  },
  render() {
    return h('div', null, this.count)
  }
}
```

## 组件实例

```typescript
// 内部创建组件实例
const instance = {
  type: MyComponent,      // 组件定义
  props: { title: 'test' },// 传入的 props
  setupState: {},          // setup 返回的状态
  subTree: null,          // render 生成的 VNode
  isMounted: false,       // 是否已挂载
  // ...
}
```

## 模板编译

```vue
<template>
  <div class="box">
    <span>{{ msg }}</span>
  </div>
</template>

<!-- 编译后等价于 -->
<script>
export function render() {
  return h('div', { class: 'box' }, [
    h('span', null, this.msg)
  ])
}
</script>
```

## 根实例 vs 子组件

| | 根实例 | 子组件 |
|---|--------|--------|
| 创建方式 | `new Vue()` / `createApp()` | 内部自动创建 |
| 返回类型 | Vue 实例 | 组件实例对象 |
| API | 有 `$mount`、`$el` 等 | 没有 |

### 根实例 — 手动调用

```javascript
// main.js — 你手动调用的
const app = new Vue({
  render: h => h(App)
})

app.mount('#app')  // 挂载到 #app
```

时机：**应用启动时，你手动调用**

挂载位置：**你指定的容器**（如 `#app`）

### 子组件 — Vue 自动创建

```vue
<!-- App.vue -->
<template>
  <MyComponent />
</template>
```

当 Vue 渲染 `App` 时，遇到 `<MyComponent />`，会**自动**创建子组件实例。

时机：**父组件渲染时，Vue 内部自动调用**

挂载位置：**父组件的 DOM 内部**

## 完整渲染流程

```javascript
// 1. 你手动调用（根实例）
const app = new Vue(App)
app.mount('#app')
      ↓

// 2. Vue 自动执行
processComponent(appInstance, '#app')
      ↓

// 3. App 的 render() 生成 VNode 树
h('div', [
  h(MyComponent),    // ← 子组件 VNode
  h('span', 'text')
])
      ↓

// 4. Vue 遇到子组件 VNode，自动创建子实例
const childInstance = createComponentInstance(MyComponent)
      ↓

// 5. 子组件挂载到父组件 DOM 内部
#app
  └── div
      ├── <MyComponent /> 的 DOM
      └── <span>text</span>
```

## data 为什么是函数

### 问题演示

```javascript
// ❌ data 是对象（错误）
const MyComponent = {
  data: { count: 0 }  // 对象引用
}

// 复用组件
const instance1 = new Vue(MyComponent)
const instance2 = new Vue(MyComponent)

instance1.count++
console.log(instance2.count) // 1 — 被污染了！
```

因为 `instance1` 和 `instance2` 指向**同一个对象**。

### ✅ data 是函数（正确）

```javascript
const MyComponent = {
  data() {
    return { count: 0 }  // 每次返回新对象
  }
}

const instance1 = new Vue(MyComponent)
const instance2 = new Vue(MyComponent)

instance1.count++
console.log(instance2.count) // 0 — 互不影响
```

每次调用 `data()` 返回**全新的对象**。

### 根本原因：JavaScript 的引用类型

```javascript
// 对象是引用类型
const a = { count: 0 }
const b = a         // b 和 a 指向同一个对象
b.count++
console.log(a.count) // 1

// 函数返回新对象
const getA = () => ({ count: 0 })
const c = getA()
const d = getA()    // 新对象
d.count++
console.log(c.count) // 0
```

### 根组件例外

```javascript
// 根组件（new Vue）可以是对象，因为只有一个实例
new Vue({
  data: { count: 0 }  // 对象也行，只有一个根实例
})
```

### Vue3 Composition API

```typescript
// Vue3 的 ref/reactive 不存在这个问题
// 因为 setup() 本身就是一个函数，每次执行返回新对象
setup() {
  const count = ref(0)  // 每次实例化都是新的
  return { count }
}
```

这也是 Vue3 用 `setup()` 的原因之一——更自然，不会有这个坑。

## 生命周期

### Options API vs Composition API

```typescript
// Options API
export default {
  beforeCreate() {},  // 实例初始化
  created() {},       // 响应式/事件已就绪
  beforeMount() {},   // 挂载前
  mounted() {},       // 挂载后（可访问DOM）
  beforeUpdate() {},  // 更新前
  updated() {},       // 更新后
  beforeUnmount() {}, // 卸载前
  unmounted() {},     // 卸载后
}

// Composition API
import { onMounted, onUpdated, onUnmounted } from 'vue'

setup() {
  onMounted(() => {})      // 挂载后
  onUpdated(() => {})      // 更新后
  onUnmounted(() => {})    // 卸载前
}
```

## setup 语法糖

`<script setup>` 是编译器在**编译阶段**自动帮你生成返回值的。

### 你写的代码

```vue
<script setup>
import { ref } from 'vue'

const count = ref(0)
const name = ref('test')

const handleClick = () => {
  count.value++
}
</script>

<template>
  <div>{{ count }}</div>
</template>
```

### 编译器生成的代码

```vue
<script>
import { ref } from 'vue'

export default {
  setup() {
    const count = ref(0)
    const name = ref('test')
    
    const handleClick = () => {
      count.value++
    }
    
    // 编译器自动把顶层变量暴露出来
    return { count, name, handleClick }
  }
}
</script>
```

### 编译器做了什么

```typescript
// 编译器内部逻辑（简化）
function compileScriptSetup(source) {
  // 1. 解析所有顶层变量声明
  const bindings = findTopLevelBindings(source)
  // → ['count', 'name', 'handleClick']
  
  // 2. 生成 return 语句
  const returnStatement = `return { ${bindings.join(', ')} }`
  
  // 3. 插入到 setup 函数中
  return wrapInSetup(source, returnStatement)
}
```

### 编译流程

```
源码字符串
    ↓
@babel/parser 解析成 AST
    ↓
遍历 AST，找顶层的 const/let/function/import
    ↓
收集变量名
    ↓
生成 return { 变量1, 变量2, ... }
    ↓
插入到 setup() 里
```

就是解析 + 扫描 + 拼字符串，没有什么魔法。
