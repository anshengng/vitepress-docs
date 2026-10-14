# 事件处理与修饰符原理

## v-on 的两种写法与编译差异

`v-on`（简写 `@`）支持方法引用和内联语句两种形态，编译产物不同：

| 写法 | 示例 | 编译产物 |
|------|------|---------|
| 方法引用 | `@click="onClick"` | 直接传函数引用 `_ctx.onClick` |
| 内联调用 | `@click="onClick($event, 1)"` | 包一层箭头函数 |
| 内联语句 | `@click="count++"` | 包一层箭头函数 `$event => (count++)` |

```typescript
// @click="onClick"（方法引用）
_createElementVNode("button", {
  onClick: _ctx.onClick
}, null, 8 /* PROPS */)

// @click="count++"（内联语句，需包一层）
_createElementVNode("button", {
  onClick: $event => (_ctx.count++)
}, null, 8 /* PROPS */)
```

方法引用直接复用原函数，不产生新函数；内联语句必须包一层箭头函数。这就是"为什么内联箭头会被缓存"的伏笔，详见 cacheHandlers 一节。

## 修饰符一览

Vue 的修饰符按作用阶段分两类：**JS 层守卫**（`.stop/.prevent/.self/.exact/按键/系统/鼠标`）和**原生 addEventListener 选项**（`.once/.capture/.passive`）。

| 修饰符 | 类别 | 效果 |
|--------|------|------|
| `.stop` | JS 守卫 | 调用 `event.stopPropagation()` |
| `.prevent` | JS 守卫 | 调用 `event.preventDefault()` |
| `.self` | JS 守卫 | 仅当 `event.target === event.currentTarget` 才触发 |
| `.once` | 原生选项 | 注册 `{ once: true }` |
| `.capture` | 原生选项 | 在捕获阶段注册 |
| `.passive` | 原生选项 | 注册 `{ passive: true }` |
| `.exact` | JS 守卫 | 精确匹配系统修饰键组合 |
| `.left/.middle/.right` | JS 守卫 | 鼠标按键判定 |
| `.enter/.esc/.space` 等 | JS 守卫 | 按键判定（配 `_withKeys`） |
| `.ctrl/.shift/.alt/.meta` | JS 守卫 | 系统修饰键判定 |

## 按键、系统、鼠标修饰符

```vue
<input @keyup.enter="submit" />
<input @keyup.page-down="onPageDown" />
<div @click.ctrl.exact="onCtrlOnly">仅按住 ctrl</div>
<button @click.right.prevent="onContext">右键</button>
```

- 按键修饰符：`.enter`、`.tab`、`.esc`、`.space`、`.up/.down/.left/.right`、`.delete` 等，也支持任意按键名（kebab-case，如 `.page-down`）。编译期判定为按键修饰符时用 `_withKeys` 包裹。
- 系统修饰符：`.ctrl/.alt/.shift/.meta`，可与按键或鼠标修饰符叠加。
- 鼠标按键：`.left/.middle/.right`。
- `.exact`：要求系统修饰键的组合完全精确，多按了别的修饰键就不触发。

## 修饰符的编译实现

编译期把修饰符分成两组分别处理：

```
@click.stop.prevent="fn"
      ↓ transformOn
sysGuard: [stop, prevent]  →  on 值 = _withModifiers(_ctx.fn, ["stop", "prevent"])

@keyup.enter="fn"
      ↓
on 值 = _withKeys(_ctx.fn, ["enter"])

@click.once / .capture / .passive
      ↓
拼进事件名：onClickOnce / onClickCapture / onClickPassive
```

编译产物示意：

```typescript
// @click.stop.prevent="fn"
_createElementVNode("button", {
  onClick: _withModifiers(_ctx.fn, ["stop", "prevent"])
}, null, 8 /* PROPS */)

// @click.once="fn"
_createElementVNode("button", {
  onClickOnce: _ctx.fn
}, null, 8 /* PROPS */)
```

为什么要分成两类？`.stop/.prevent/.self/.exact` 必须在 JS 回调里手动执行，所以要包一层守卫函数；而 `.once/.capture/.passive` 对应浏览器 `addEventListener` 的第三个参数，属于注册行为，直接体现在事件键名的后缀上即可，运行时 `patchEvent` 会解析这些后缀并映射为注册选项。

## _withModifiers 的运行时代码

```typescript
export const withModifiers = (fn: Function, modifiers: string[]) => {
  return (event: Event, ...args: unknown[]) => {
    for (let i = 0; i < modifiers.length; i++) {
      const guard = modifierGuards[modifiers[i]]
      // 守卫返回真值表示"拦截"，直接 return，用户回调不执行
      if (guard && guard(event, modifiers)) return
    }
    return fn(event, ...args)
  }
}

const modifierGuards: Record<string, (e: Event, modifiers?: string[]) => unknown> = {
  stop: e => e.stopPropagation(),
  prevent: e => e.preventDefault(),
  self: e => e.target !== e.currentTarget,
  ctrl: e => !(e as KeyboardEvent).ctrlKey,
  shift: e => !(e as KeyboardEvent).shiftKey,
  alt: e => !(e as KeyboardEvent).altKey,
  meta: e => !(e as KeyboardEvent).metaKey,
  left: e => 'button' in e && (e as MouseEvent).button !== 0,
  middle: e => 'button' in e && (e as MouseEvent).button !== 1,
  right: e => 'button' in e && (e as MouseEvent).button !== 2
}
```

关键点：它是**守卫链**。按修饰符顺序生成一串判断，任一守卫返回真就短路，用户回调根本不执行。注意 `.stop/.prevent` 这类守卫执行完动作后返回 `undefined`（假值），所以不会拦截，只是顺手阻止了冒泡或默认行为。这点在面试里常被追问：为什么 `.stop` 只会阻止冒泡、仍然会执行用户回调。

按键修饰符则换成另一套 helper：

```typescript
export const withKeys = (fn: Function, modifiers: string[]) => {
  return (event: KeyboardEvent) => {
    if (!('key' in event)) return
    const eventKey = hyphenate(event.key)
    // modifiers 命中按键名或其别名（esc → escape）才放行
    if (modifiers.some(k => k === eventKey || keyNames[k] === eventKey)) {
      return fn(event)
    }
  }
}

const keyNames = {
  esc: 'escape',
  space: ' ',
  up: 'arrow-up',
  left: 'arrow-left',
  right: 'arrow-right',
  down: 'arrow-down',
  delete: 'backspace'
}
```

`.esc`、`.space` 之类的别名靠 `keyNames` 映射到真实的 `event.key` 值。

## .passive 与 .prevent 冲突

`.passive` 向浏览器承诺"这个监听器不会调用 preventDefault"，浏览器因此可以不等 JS 执行就直接滚动，从而提升滚动性能。既然做了承诺，监听器里再调 `preventDefault` 就无效——浏览器会忽略它，开发环境还会给出警告。

```
@scroll.passive="onScroll"
   ↓ patchEvent
addEventListener('scroll', fn, { passive: true })
   ↓ onScroll 内调用 e.preventDefault()
浏览器忽略该调用，滚动照常；dev 环境打印警告
```

Vue 在编译期就把两者视为互斥，`@click.passive.prevent` 会触发生成警告，且逻辑上毫无意义。移动端常见用法是 `@touchstart.passive`、`@scroll.passive` 提升滚动流畅度。

## 自定义事件与原生事件

| 维度 | 原生事件 | 组件自定义事件 |
|------|---------|--------------|
| 监听对象 | 真实 DOM 节点 | 组件（通过 emit 触发） |
| 触发方式 | 浏览器派发 | 子组件调用 `emit` / `$emit` |
| 同名冲突 | 无 | 需在 `emits` 声明以区分 |
| 事件名大小写 | 原样（DOM 事件名小写） | 推荐 kebab-case |

组件上监听自定义事件：

```vue
<script setup>
const emit = defineEmits(['submit'])

function onClick() {
  emit('submit', payload)
}
</script>

<template>
  <button @click="onClick">提交</button>
</template>
```

```vue
<!-- 父组件 -->
<MyButton @submit="onSubmit" />
```

编译后 `@submit` 变成 prop `onSubmit`；子组件 `emit('submit')` 时查找 `props.onSubmit` 并调用。**未在 `emits` 里声明的监听器会作为透传属性留在组件上，最终落到根元素**——这正是"给组件加原生事件监听没反应、或莫名其妙作用到根元素"的原因。要区分自定义事件与同名原生事件，必须显式声明 `emits`。

## 事件名大小写

DOM 模板（浏览器直接解析的 `index.html`）里，HTML 属性名会被转成小写，`@myEvent` 会变成 `@myevent`，与 `@my-event` 对不上。所以**统一用 kebab-case**：

| 写法 | SFC 编译 | DOM 模板 | 建议 |
|------|----------|----------|------|
| `@my-event`（emit `'my-event'`） | 有效 | 有效 | 推荐 |
| `@myEvent`（emit `'myEvent'`） | SFC 有效 | 被转小写、失效 | 避免 |

emit 的字符串与监听名要能对上。SFC 编译时 `@my-event` 归一化为 `onMyEvent`，`@myEvent` 同样归一化，二者在 SFC 里都可用，但跨 DOM 模板场景只有 kebab-case 可靠。

## 为什么内联箭头函数会被缓存（cacheHandlers）

```vue
<template>
  <button @click="count++">{{ count }}</button>
</template>
```

内联语句必须包成箭头函数。若不做缓存：

```typescript
// 缓存关闭：每次 render 都生成新函数
_createElementVNode("button", {
  onClick: $event => (_ctx.count++)
}, _toDisplayString(_ctx.count), 9 /* TEXT, PROPS */)
```

每次重渲染生成新函数引用，props 比较无法通过引用相等跳过，可能引发无意义更新。cacheHandlers 默认开启后：

```typescript
export function render(_ctx, _cache) {
  return _createElementVNode("button", {
    onClick: _cache[0] || (_cache[0] = $event => (_ctx.count++))
  }, _toDisplayString(_ctx.count), 9 /* TEXT, PROPS */)
}
```

首个 render 把箭头函数存进 `_cache[0]`，之后复用同一引用。`_ctx` 是同一个 Proxy，闭包不会过期，函数每次执行读到的仍是最新状态。

注意：方法引用（`@click="onClick"`）本身不是每次新建的，不需要也不受益于缓存。

## 面试答法

v-on 的修饰符分两类：`.stop/.prevent/.self/.exact` 以及按键、系统、鼠标修饰符属于 JS 层守卫，编译器用 `_withModifiers`、`_withKeys` 把用户回调包一层守卫链，任一守卫命中就短路、不执行回调；而 `.once/.capture/.passive` 是原生 addEventListener 的选项，编译期直接拼进事件名变成 `onClickOnce`、`onClickCapture`、`onClickPassive`，运行时 patchEvent 解析后缀并映射为注册选项。`_withModifiers` 按修饰符名从 `modifierGuards` 取对应守卫，`.stop` 调 stopPropagation、`.prevent` 调 preventDefault、`.self` 判断 target 是否等于 currentTarget，这些动作型守卫返回假值所以不会拦截回调。`.passive` 与 `.prevent` 互斥，因为浏览器在 passive 监听里会忽略 preventDefault，Vue 在编译期就会告警。组件上的自定义事件本质是 `emit` → `onXxx` 的 props 回调，名字推荐 kebab-case 以兼容大小写不敏感的 DOM 模板，未在 emits 声明的事件会透传到根元素。内联箭头函数靠 cacheHandlers 缓存在 `_cache` 上，避免每次渲染生成新函数引发子组件无意义更新，而方法引用天然不需要缓存。
