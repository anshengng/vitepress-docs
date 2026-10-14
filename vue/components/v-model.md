# v-model 原理

v-model 是编译器实现的**语法糖**，运行时没有任何"双向绑定"的魔法。编译器把它拆成两半：**数据下行走 props，更新上行走事件**。

## 表单元素上：语法糖的等价展开

概念上，`v-model="msg"` 等价于：

```vue
<input :value="msg" @input="msg = $event.target.value" />
```

但真实实现不是模板层面的简单替换，而是编译成**运行时指令**。`<input v-model="msg" />` 的编译产物（实测 compiler-dom 输出）：

```typescript
// 编译后的 render 函数（节选）
import { vModelText as _vModelText, withDirectives as _withDirectives } from 'vue'

return function render(_ctx, _cache) {
  return _withDirectives(
    (_openBlock(), _createElementBlock("input", {
      "onUpdate:modelValue": $event => ((_ctx.msg) = $event)
    }, null, 8 /* PROPS */, ["onUpdate:modelValue"])),
    [
      [_vModelText, _ctx.msg]   // 指令 + 绑定值
    ]
  )
}
```

要点：

| 部分 | 职责 |
|---|---|
| `onUpdate:modelValue` 监听 | 编译出来的赋值语句 `msg = $event`，负责"上行" |
| `vModelText` 指令 | 在 mounted/beforeUpdate 钩子里同步 `el.value`，负责"下行" |

为什么值绑定用指令而不是直接编译成 `:value`？因为 checkbox、radio、select 的"值"和"事件"各不相同（`checked` + `change`、`value` + `change`），按元素类型分发不同指令实现（`vModelText` / `vModelCheckbox` / `vModelRadio` / `vModelSelect`），还能把 IME 组合输入这类细节收进指令里统一处理。

### vModelText 指令（简化源码）

```typescript
// 三个修饰符都在 created 钩子里实现
const vModelText = {
  created(el, { modifiers: { lazy, trim, number } }, vnode) {
    // 从编译产物里拿到赋值函数（就是那行 msg = $event）
    const assign = getModelAssigner(vnode)
    // type="number" 的输入框即使不写 .number 也自动转数字
    const castToNumber = number || vnode.props?.type === 'number'

    el.addEventListener(lazy ? 'change' : 'input', e => {
      if (e.target.composing) return      // 中文输入法组词过程中不触发更新
      let value = el.value
      if (trim) value = value.trim()      // .trim：赋值前去首尾空格
      if (castToNumber) value = looseToNumber(value)  // .number：转数字
      assign(value)                        // → msg = value
    })
  },
  mounted(el, { value }) {
    el.value = value == null ? '' : value          // 父状态 → input
  },
  beforeUpdate(el, { value }) {
    if (el.value !== value) el.value = value       // 父状态变化 → 同步回 input
  },
}

// 取出编译产物里的 onUpdate:modelValue
function getModelAssigner(vnode) {
  const fn = vnode.props['onUpdate:modelValue']
  return Array.isArray(fn) ? v => fn.forEach(f => f(v)) : fn
}

// .number 的转换函数（@vue/shared）
const looseToNumber = (val: string) => {
  const n = parseFloat(val)
  return isNaN(n) ? val : n          // 转不成数字就保持原值
}
```

### 三个修饰符

| 修饰符 | 实现方式 | 效果 |
|---|---|---|
| `.lazy` | 监听 `change` 而不是 `input` | 失焦/回车才同步 |
| `.trim` | 赋值前 `value.trim()`，并额外在 change 时清一次输入框内空格 | 首尾空格不进状态 |
| `.number` | `looseToNumber` 转换 | 状态保持 number 类型 |

## 组件上：modelValue + onUpdate:modelValue

`<MyInput v-model="msg" />` 的编译产物（实测）：

```typescript
return (_openBlock(), _createBlock(_component_MyInput, {
  modelValue: _ctx.msg,                                       // 下行：prop
  "onUpdate:modelValue": $event => ((_ctx.msg) = $event)      // 上行：事件
}))
```

### 手写自定义输入组件（props + emit 写法）

```vue
<!-- MyInput.vue -->
<script setup lang="ts">
defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const onInput = (e: Event) => {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}
</script>

<template>
  <input :value="modelValue" @input="onInput" />
</template>
```

### defineModel（Vue 3.4+）

3.4 起官方推荐 `defineModel`，子组件里用起来像一个可读写的 ref：

```vue
<!-- MyInput.vue -->
<script setup lang="ts">
const msg = defineModel<string>()
</script>

<template>
  <input v-model="msg" />
</template>
```

它是编译宏，实测编译产物做了三件事：

```typescript
export default _defineComponent({
  props: {
    "modelValue": { type: String },      // 1. 自动声明同名 prop
    "modelModifiers": {},               //    以及修饰符 prop
  },
  emits: ["update:modelValue"],          // 2. 自动声明更新事件
  setup(__props) {
    const msg = _useModel(__props, "modelValue")  // 3. 换成 useModel 调用
    return { msg }
  },
})
```

运行时 `useModel`（源码简化）本质是 `customRef` 包一层 props + emit：

```typescript
function useModel(props, name) {
  const instance = getCurrentInstance()!
  return customRef((track, trigger) => ({
    get() {
      track()
      return props[name]                      // 读 → 读 prop（父组件是数据源）
    },
    set(value) {
      instance.emit(`update:${name}`, value)   // 写 → 通知父组件更新
    },
  }))
}
```

真实源码还处理了：父组件没绑 v-model 时的本地回退（此时表现接近普通 ref）、get/set 值转换选项、父组件未回写时的本地强制同步等。

## 多个 v-model：带参数

`v-model:参数名` 一个组件可以绑多个双向值（Vue 2 时代要靠 `.sync`）：

```vue
<UserProfile v-model:name="name" v-model:page="page" />
```

等价展开就是 `:name="name"` + `@update:name`、`:page="page"` + `@update:page`。编译产物里参数名替换 modelValue 的位置（实测）：

```typescript
return _createBlock(_component_UserProfile, {
  name: _ctx.name,
  "onUpdate:name": $event => ((_ctx.name) = $event),
  page: _ctx.page,
  "onUpdate:page": $event => ((_ctx.page) = $event),
})
```

## 自定义修饰符：modelModifiers prop

`v-model.capitalize="msg"` 的编译产物（实测）：

```typescript
return _createBlock(_component_MyInput, {
  modelValue: _ctx.msg,
  "onUpdate:modelValue": $event => ((_ctx.msg) = $event),
  modelModifiers: { capitalize: true },   // 修饰符变成一个 prop 传进来
})
```

组件里声明同名 prop 接住并处理：

```vue
<!-- MyInput.vue -->
<script setup lang="ts">
const props = defineProps<{
  modelValue: string
  modelModifiers?: { capitalize?: boolean }
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const onInput = (e: Event) => {
  let value = (e.target as HTMLInputElement).value
  if (props.modelModifiers?.capitalize) {
    value = value.charAt(0).toUpperCase() + value.slice(1)
  }
  emit('update:modelValue', value)
}
</script>
```

带参数时命名为 `参数名 + Modifiers`：`v-model:title.mod` → 组件接收 `titleModifiers` prop。

## Vue2 vs Vue3 变化

| 对比项 | Vue 2 | Vue 3 |
|---|---|---|
| 默认 prop / 事件 | `value` / `input` | `modelValue` / `update:modelValue` |
| 自定义默认 prop | `model: { prop, event }` 选项 | 移除，改用 `v-model:xxx` 参数 |
| `.sync` 修饰符 | `:title.sync` 独立存在 | 移除，合并进 `v-model:title` |
| 多个 v-model | 不支持（`value` 只能一个） | 支持，`v-model:a` + `v-model:b` |
| 组件自定义修饰符 | 无官方机制，组件拿不到 | `modelModifiers` / `xxxModifiers` prop |
| 表单修饰符 | `.lazy` `.trim` `.number` | 保留，实现同理 |

`value → modelValue` 的动机：`value` 与 HTML 属性重名，`model` 选项又让每个组件的"双向契约"都不一样。统一成显式的 `modelValue` + `update:modelValue` 后，命名固定、可带参数，一个组件天然支持多个 v-model，不再需要任何配置。

## 原理总结

```
v-model="msg"
      ↓  模板编译器
┌──────────────────────────────────────────────────┐
│ 数据下行：props（modelValue / value）              │
│ 更新上行：事件（onUpdate:modelValue / input 等）  │
└──────────────────────────────────────────────────┘
      ↓  运行时
子组件 emit('update:modelValue', v)
      ↓
父组件执行 msg = v（响应式触发父组件重新渲染）
      ↓
新的 msg 通过 props 流回子组件
```

所谓"双向绑定"，实际是**单向下行 + 事件上行的约定闭环**：父组件状态是唯一数据源，子组件从不直接修改它，只是通过 emit"请求"父组件修改；父组件改完后数据再经 props 流回来。数据流向依然单向可追踪，这正是 v-model 不破坏响应式架构的原因。

## 面试答法

v-model 本质是编译器语法糖，会被拆成 props 和事件监听两部分，运行时不存在真正的"双向"。在表单元素上，它编译成 `onUpdate:modelValue` 赋值回调加 `vModelText` 运行时指令：指令监听 input 事件（`.lazy` 换成 change），并在 mounted/beforeUpdate 中同步 `el.value`，`.trim` 和 `.number` 就是在赋值前做 trim 和数字转换。在组件上，它编译成 `modelValue` prop 加 `onUpdate:modelValue` 事件：子组件 emit 更新事件，父组件执行赋值后数据再通过 props 流回子组件——父组件始终是唯一数据源，这就是"双向"的全部真相。Vue 3.4 的 defineModel 只是编译期自动声明 prop 和事件、运行时用 customRef 封装这套 props + emit，让子组件像操作普通 ref 一样读写。另外 Vue 3 把 `.sync` 合并成带参数的 `v-model:title`，天然支持多个 v-model，自定义修饰符通过 `modelModifiers` prop 传给组件。
