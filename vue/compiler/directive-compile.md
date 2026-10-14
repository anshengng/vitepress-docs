# 指令编译：v-if / v-for / v-on / v-model 变成什么代码

## 核心思路

指令是模板语法的"语法糖"，它本身在运行时并不存在。
编译器在 transform 阶段把每条指令改写成普通表达式或普通 prop，到 generate 阶段就只剩下一段朴素的 JS。
所以理解指令编译，关键不是记产物字符串，而是理解**每一步改写发生在哪个 transform 里**。

## 总体一览表

| 模板写法 | 编译后节点 / 产物 | 依赖的 helper |
|---------|-----------------|--------------|
| `<p v-if="ok">A</p>` | 三元表达式（分支各自成块） | `_openBlock`、`_createElementBlock` |
| `<p v-else>B</p>` | 三元表达式另一分支 | 同上 |
| `<li v-for="(item, i) in list">` | `_renderList` 调用 + 回调 + Fragment | `_renderList`、`_Fragment`、`_createElementBlock` |
| `@click="handler"` | `onClick: handler` | 无 |
| `@click="count++"` | 带缓存的内联箭头函数 | `_cache` |
| `@click.stop="fn"` | `onClick: _withModifiers(fn, ["stop"])` | `_withModifiers` |
| `v-model="msg"`（普通元素） | `_withDirectives` + `_vModelText`（运行时指令） | `_withDirectives`、`_vModelText` |
| `v-model="msg"`（自定义组件） | `modelValue` + `onUpdate:modelValue` | 无 |
| `v-show="ok"`（运行时指令） | `_withDirectives` + `_resolveDirective` | `_withDirectives`、`_resolveDirective` |

## v-if / v-else / v-else-if

`v-if` 链在 transformIf 里被整体收集成一个 `NodeTypes.IF` 结构：它有一个 `branches` 数组，每项包含 `condition` 与 `children`。
节点遍历结束后，这个 IF 节点已经取代了原来的元素节点，generate 时再把它"还原"成条件表达式。

```
<p v-if="ok">A</p>
<p v-else>B</p>
        ↓ transformIf：两条元素 → 一个 IF 节点（branches: [{condition: ok, children: A}, {condition: null, children: B}]）
IF 节点
        ↓ generate：条件 ? 分支0 : 分支1
```

编译产物：

```typescript
_ctx.ok
  ? (_openBlock(), _createElementBlock("p", { key: 0 }, "A"))
  : (_openBlock(), _createElementBlock("p", { key: 1 }, "B"))
```

几个要点：

| 细节 | 说明 |
|------|------|
| 多于两个分支 | 嵌套三元：`cond1 ? b0 : cond2 ? b1 : b2`（`v-else` 的 condition 为 null，直接落到最后一层） |
| 自动加 key | 编译器给每个分支补 `key: 0 / 1 / …`，让运行时 diff 能判定"换分支了"，直接替换而非复用 |
| 每分支成 Block | 每个分支单独 `_openBlock()`，因为分支内部结构不可预测，需要各自的 dynamicChildren |
| Fragment 包裹 | 分支内是多个平级节点时，会用 `_createElementBlock(_Fragment, ...)` 把它们包成一个子节点 |

同一分支内的兄弟节点由 Fragment 包裹，保证了"一个分支 = 一个可整体替换的 vnode"。

## v-for

`v-for` 由 transformFor 处理，生成 `NodeTypes.FOR` 节点，记录 `source`（迭代源）、`value`（item）、`key`、`index` 与内部的 `renderExp`。
generate 时，FOR 节点被展开成 `_renderList(源, (item, i) => { ... })`，并把回调返回的节点再包一层 Fragment。

```
<li v-for="(item, i) in list" :key="item.id">{{ item.name }}</li>
        ↓ transformFor：元素 → FOR 节点（source=list, value=item, index=i）
        ↓ generate：_renderList 回调 + Fragment 包裹
```

编译产物：

```typescript
(_openBlock(true), _createElementBlock(_Fragment, null,
  _renderList(_ctx.list, (item, i) => {
    return (_openBlock(), _createElementBlock("li", { key: item.id }, _toDisplayString(item.name), 1))
  }),
  128 /* KEYED_FRAGMENT */
))
```

要点：

| 细节 | 说明 |
|------|------|
| `_renderList` | 统一处理数组、数字、字符串、对象、可迭代对象，返回 vnode 数组 |
| `_openBlock(true)` | 参数 `true` 表示"禁用 tracking"，列表本身不往父 Block 收集，自己当独立 Block |
| KEYED_FRAGMENT(128) | 写了 `:key`，运行时用 key 做 diff 与移动 |
| UNKEYED_FRAGMENT(256) | 没写 `:key`，只能按索引就地复用 |

key 缺失时产物里的 flag 会从 128 变成 `256 /* UNKEYED_FRAGMENT */`，这正是 patchChildren 决定走"key 比对"还是"索引比对"的依据。

## v-on

`v-on` 由 directiveTransforms 里的 transformOn 处理，产物是一条以事件名命名、首字母大写并加 `on` 前缀的 prop：`@click` → `onClick`，
`@mouseenter` → `onMouseenter`（注意驼峰化只影响首字母，不改变原有大小写）。

两种写法产物不同：

```vue
<template>
  <button @click="handler">点我</button>
  <button @click="count++">加一</button>
</template>
```

```typescript
// @click="handler"：直接引用已有函数
_createElementVNode("button", { onClick: _ctx.handler }, "点我")

// @click="count++"：内联语句 → 生成箭头函数，并用 _cache 缓存引用（cacheHandlers）
_createElementVNode("button", {
  onClick: _cache[0] || (_cache[0] = (...args) => (_ctx.count++))
}, "加一")
```

内联语句必须包成函数才能作为 handler，而 `_cache` 保证每次 render 复用同一个函数引用，避免 props 引用变化触发无意义更新。

### 修饰符如何编译

修饰符不是运行时概念，transformOn 会把它们分三类处理：

| 修饰符 | 编译方式 | 产物示例 |
|--------|---------|---------|
| `.stop` / `.prevent` / `.self` / `.ctrl` / `.shift` / `.alt` / `.meta` / `.exact` / `.middle` | 用 `_withModifiers` 包裹 | `onClick: _withModifiers(fn, ["stop"])` |
| `.enter` / `.esc` / `.tab` / `.left` / `.right` 等按键修饰符 | 用 `_withKeys` 包裹 | `onKeyup: _withKeys(fn, ["enter"])` |
| `.once` / `.capture` / `.passive` | 拼进事件名后缀 | `onClickOnce` / `onClickCapture` / `onClickPassive` |

`.once`、`.capture`、`.passive` 是事件监听选项，编译器直接把它们合并进事件名，运行时按名字透传给 `addEventListener` 的 options。

## v-model

`v-model` 在两种场景下语义不同：普通元素上它是**运行时指令**，自定义组件上则是**一组 prop**。

### 普通表单元素：运行时指令

```vue
<template>
  <input v-model="msg">
</template>
```

```typescript
_withDirectives(
  _createElementVNode("input", {
    "onUpdate:modelValue": $event => (_ctx.msg = $event)
  }, null, 512 /* NEED_PATCH */),
  [[_vModelText, _ctx.msg]]
)
```

原生元素没有组件的 `props` / `emit` 协议，双向绑定要真正写进 DOM（读 `input.value`、写 `input.value`），这属于运行时行为，
所以编译器把它交给一条运行时指令：`_withDirectives` 把指令挂到 vnode 的 `dirs` 上，`_vModelText` 在挂载 / 更新时负责读写 DOM 并派发 `input` 事件。
`onUpdate:modelValue` 这条 prop 由指令在事件触发时调用，二者配合完成双向绑定。

指令按元素类型选择：`_vModelText`（input / textarea）、`_vModelCheckbox`、`_vModelRadio`、`_vModelSelect`，
以及当 `type` 动态变化时兜底的 `_vModelDynamic`（运行时按实际 type 决定用哪条）。

### 组件：modelValue + onUpdate:modelValue

```vue
<template>
  <MyInput v-model="msg" />
</template>
```

```typescript
_createVNode(_component_MyInput, {
  modelValue: _ctx.msg,
  "onUpdate:modelValue": $event => (_ctx.msg = $event)
})
```

组件有自己的 `props` / `emit` 协议，所以直接落成"一个值 prop + 一个更新事件 prop"，
等价于 `:modelValue` 加上 `@update:modelValue`，组件内部用 `defineProps` + `defineEmits` 对接。
带参数时（`v-model:title`）则是 `title` / `onUpdate:title`。可见组件上的 `v-model` 只是把双向绑定拆成了单向数据流 + 一个赋值回调，没有魔法。

### 不同元素与修饰符的处理

transformModel 会按元素类型和修饰符改写事件名、赋值体或所选指令：

| 场景 | 处理 |
|------|------|
| 普通 input / textarea | 指令 `_vModelText`，事件名 `input` |
| `input type="checkbox"` / `radio` | 指令 `_vModelCheckbox` / `_vModelRadio`，读写 `checked` |
| `select` | 指令 `_vModelSelect`，事件名 `change` |
| `type` 动态变化 | 指令 `_vModelDynamic`，运行时按实际 type 选择 |
| `.lazy` | 事件名由 `input` 改为 `change`，失焦 / 回车才同步 |
| `.number` | 赋值时用 `_looseToNumber` 转换 |
| `.trim` | 赋值时对值做 `trim()` |

多种元素、多种修饰符的组合逻辑都收敛在同一个 transformModel 里，这也是它比其它指令 transform 复杂得多的原因。

## 插件机制：nodeTransforms 与 directiveTransforms

编译过程本质是**一堆可插拔的 transform 函数，在深度优先遍历 AST 时被依次调用**。
Vue 把 transform 分成两层，各管一件事：

| 机制 | 触发时机 | 输入 | 特点 |
|------|---------|------|------|
| `nodeTransforms` | 每个节点进入时都调用一遍 | `(node, context)` | 节点级：谁都需要就都能预处理，靠 `node.type` 判断 |
| `directiveTransforms` | 只有在节点带指令时 | `(dir, node, context)` | 指令级：以指令名为 key 分派，`v-on → transformOn` 等 |

```
遍历 AST（进入节点）
    ↓ 顺序执行 nodeTransforms
transformElement / transformText / transformIf / transformFor / transformExpression / transformSlotOutlet
    ↓ 遍历到的指令按 dir.name 查表分派
directiveTransforms： v-model → transformModel， v-on → transformOn， v-bind → transformBind
    ↓ 部分 transform 有"副作用"：返回退出函数，离开节点时再执行
带 codegenNode 的 AST
    ↓ generate
render 函数代码
```

常见内置 transform 及职责：

| transform | 类型 | 职责 |
|-----------|------|------|
| transformElement | nodeTransform | 处理元素节点：合并 props、静态提升、打 patchFlag |
| transformText | nodeTransform | 把相邻文本 / 插值合并成 Text 或 CompoundExpression |
| transformIf | nodeTransform | v-if 链 → IF 节点（branches 数组） |
| transformFor | nodeTransform | v-for → FOR 节点（source / value / key / index） |
| transformExpression | nodeTransform | 表达式加 `_ctx.` 前缀、过滤全局对象 |
| transformSlotOutlet | nodeTransform | `<slot>` → `_renderSlot` |
| transformBind（v-bind） | directiveTransform | 绑定属性 → props |
| transformOn（v-on） | directiveTransform | 事件 → onClick 等 prop |
| transformModel（v-model） | directiveTransform | 值 + 更新事件两个 prop |

### 如何自定义

两种 transform 都可以通过编译选项扩展。nodeTransform 的签名是"接收节点、返回可选的退出函数"：

```typescript
import { compile, type NodeTransform } from '@vue/compiler-dom'

// 节点级 transform：进入时执行，返回的函数在离开节点时执行
const myNodeTransform: NodeTransform = (node, context) => {
  if (node.type === 1 /* ELEMENT */) {
    context.addIdent(node.tag)
  }
  // 返回退出函数（可选）
  return () => {
    /* 离开该节点时执行 */
  }
}

const result = compile(template, {
  nodeTransforms: [myNodeTransform],
  directiveTransforms: {
    // 按指令名注册：模板里写 v-focus 时命中这里
    focus: (dir, node, context) => ({
      props: [/* 生成的 props 描述 */]
    })
  }
})
```

要点：

- 自定义 `nodeTransforms` 是**追加**，内置的那些仍按顺序执行；顺序会影响结果（前一个 transform 把节点换成别的 type，后一个就见不到原 type 了）。
- `directiveTransforms` 以指令名分派，返回一个 `props` 数组（描述要往元素上写哪些属性）与可选的 `needRuntime`。

### 运行时指令：resolveDirective 与 withDirectives

有些指令无法在编译期完全展开，比如 `v-show`——它必须绑定到真实 DOM 上去改 `display`，属于运行时行为。
编译器对这类指令的处理是：保留指令本身，把产物包成 `_withDirectives(vnode, [[_resolveDirective("show"), value]])`。

```typescript
// <div v-show="ok"> 的产物（简化）
_withDirectives(
  _createElementVNode("div", null, "内容"),
  [[_resolveDirective("show"), _ctx.ok]]
)
```

- `_resolveDirective` 负责按名字从当前实例的指令注册表中找到指令对象（对应组件 `directives` 选项）。
- `_withDirectives` 把指令挂到 vnode 的 `dirs` 上，运行时在挂载 / 更新 / 卸载的生命周期里调用指令的钩子。

这也解释了 `v-show` 与 `v-if` 的本质差异：`v-if` 是编译期展开的条件表达式，`v-show` 是运行期保留的指令。

## 面试答法

指令编译的本质是"语法糖在编译期被拆掉"。v-if 由 transformIf 收成一个 IF 节点，generate 时展开成三元表达式，每个分支独立成块并自动加 key，便于运行时判等替换；v-for 由 transformFor 生成 FOR 节点，展开成 `_renderList` 加回调，外面包一层 Fragment，写了 key 就是 KEYED_FRAGMENT、没写就是 UNKEYED_FRAGMENT；v-on 由 transformOn 生成首字母驼峰的事件 prop，比如 `@click` 变 `onClick`，内联语句会用 `_cache` 缓存成函数引用，修饰符则展开成 `_withModifiers` / `_withKeys` 或拼进事件名。v-model 分两条路径：组件上由 transformModel 归一成 `modelValue` 和 `onUpdate:modelValue` 两个 prop；原生元素上则交给运行时指令 `_withDirectives` + `_vModelText`（按类型选 Checkbox / Radio / Select / Dynamic），再按 `.lazy` / `.number` / `.trim` 等修饰符改写事件名与赋值逻辑。整个流程靠两套可插拔机制驱动：nodeTransforms 按节点跑、directiveTransforms 按指令名分派，两者都能通过编译选项自定义扩展；对于 v-show 这类纯运行时指令，编译器则保留指令并用 `_withDirectives` + `_resolveDirective` 处理。
