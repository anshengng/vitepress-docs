# SFC 编译：@vue/compiler-sfc 如何处理 .vue 文件

## 一个 .vue 文件的三块结构

单文件组件（SFC）本质是"一个文件里放三种语言块"，由 `@vue/compiler-sfc` 把三块拆开、分别编译、再拼回一个标准 JS 模块。

| 语法块 | 内容 | 由谁处理 |
|--------|------|---------|
| `<template>` | 模板语法 | `compileTemplate()`（复用 `@vue/compiler-core`） |
| `<script>` / `<script setup>` | 组件逻辑 | `compileScript()` |
| `<style>` / `<style scoped>` / `<style module>` | 样式 | `compileStyle()`（基于 PostCSS 插件） |
| `<customBlock>` | 自定义块（i18n、docs 等） | 编译器只拆出，内容交给用户 |

`<script>` 与 `<script setup>` 可共存：普通块放 `export default` 之外的选项（`name`、`inheritAttrs`），setup 块放逻辑，由 `compileScript()` 合并。

## 编译流程总览

```
.vue 文本
    ↓ parse()  按 <template>/<script>/<style> 切块
SFCDescriptor
  ├── descriptor.template      → compileTemplate()  → render 函数代码
  ├── descriptor.script        ┐
  ├── descriptor.scriptSetup   ┘ → compileScript()  → 组件选项 + bindingMetadata
  └── descriptor.styles[]      → compileStyle()     → 改写后的 CSS
    ↓ 三路产物拼装
最终 JS 模块：import + _sfc_main + render + __scopeId + export default
```

关键点：**parse 只做切分，不做编译**，唯一产出是记录每块内容、位置、属性（`scoped`、`module`、`lang`）的 `SFCDescriptor`；`compileScript` 消费 script/scriptSetup 产出组件选项与 `bindingMetadata`，`compileTemplate` 产出 render，`compileStyle` 产出改写后的 CSS。

## parse()：拆出 descriptor

`parse(source, options)` 返回的 `SFCDescriptor` 字段：

| 字段 | 含义 |
|------|------|
| `template` | `<template>` 块（含 `content`、`lang`、`attrs`） |
| `script` / `scriptSetup` | 普通 / setup 脚本块，可能为 null |
| `styles` | `<style>` 块数组（可多个） |
| `customBlocks` | 自定义块数组 |
| `source` / `filename` | 原始文本、文件路径 |

## template 与 script 如何合并

非 `<script setup>` 组件里，render 是独立函数，运行时由组件实例调用，参数即"注入上下文"：`_ctx` 是实例 Proxy，模板标识符统一解析成 `_ctx.xxx`，因此 `props`、`data`、`computed` 都能按名字取到。

```typescript
// 编译器生成的 render 签名
function render(_ctx, _cache, $props, $setup, $data, $options) {
  return (_openBlock(), _createElementBlock("div", null, _toDisplayString(_ctx.msg)))
}
```

`<script setup>` 不同：`compileScript` 支持 `inlineTemplate`，把 render 内联进 `setup` 闭包：

```typescript
setup(__props, { emit: __emit }) {
  const msg = ref("hi")
  return (_ctx, _cache) => {          // 返回的就是 render 函数
    return _createElementBlock("div", null, _toDisplayString(msg.value))
  }
}
```

模板里的 `msg` 被直接编译成闭包变量 `msg.value`，**不走 `_ctx` 代理**——编译期已知标识符来源，生成直接引用，省掉 Proxy 拦截与查找，这就是 script setup 的性能点。

## `<script setup>` 编译宏

### 宏总览

| 宏 | 编译产物 | 用途 |
|----|---------|------|
| `defineProps` | `props` 选项 + setup 参数 `__props` | 声明 props |
| `defineEmits` | `emits` 选项 + `__emit` | 声明自定义事件 |
| `defineExpose` | setup 内 `__expose({...})` | 暴露给父组件 ref |
| `defineModel` | `props.modelValue` + `update:modelValue` + 可写计算属性 | 双向绑定 |
| `defineOptions` | 展开进组件选项 | 声明 name、inheritAttrs 等 |

### defineProps

```vue
<script setup>
const props = defineProps({ title: String })
</script>
```

编译后：

```typescript
export default {
  props: { title: String },
  setup(__props) {
    const props = __props   // 模板里可直接用 title 或 props.title
  }
}
```

### defineEmits

```vue
<script setup>
const emit = defineEmits(['change'])
emit('change', 1)
</script>
```

编译后：

```typescript
export default {
  emits: ['change'],
  setup(__props, { emit: __emit }) {
    const emit = __emit
    emit('change', 1)
  }
}
```

### defineExpose

编译成 setup 内调用注入的 `__expose`，暴露对象挂到实例 `exposed`，父组件经模板 ref 访问：

```typescript
setup(__props, { expose: __expose }) {
  function focus() { /* ... */ }
  __expose({ focus })   // 父组件 ref.value.focus() 可调用
}
```

注意 `<script setup>` 组件**默认闭合**：不调 `defineExpose`，父组件就拿不到任何内部状态。

### defineModel（Vue 3.4+）

`const model = defineModel()` 相当于同时声明 props、emits，并生成一个可读写引用；编译器实际走内部 `useModel`（含缺省值、本地暂存），语义即"props + emits + 可写 computed"：

```typescript
props: { modelValue: {} },
emits: ['update:modelValue'],
setup(__props, { emit: __emit }) {
  const model = computed({
    get: () => __props.modelValue,
    set: (v) => __emit('update:modelValue', v)
  })
}
```

### defineOptions

`defineOptions({ name: 'MyButton', inheritAttrs: false })` 把字段**展开进组件选项**，编译后相当于：

```typescript
export default {
  name: 'MyButton',
  inheritAttrs: false,
  setup() { /* ... */ }
}
```

### 宏不是运行时函数

`defineProps`、`defineEmits` 这些名字**不是从 vue 导入的函数**，运行时也不会被调用，而是 `compileScript` 识别并替换掉的语法标记——所以不需要 import，也不需要 auto-import。也正因此它们只在 `<script setup>` 顶层作用域合法，写进普通函数里编译器会报错。

## 顶层绑定暴露：bindingMetadata

`compileScript` 扫描 `<script setup>` 顶层，生成 `bindingMetadata`（`Bindings` 类型），模板编译器据此决定标识符"直接引用"还是"走 `_ctx`"。

| 绑定类型 | 对应代码 | 模板里的引用方式 |
|---------|---------|----------------|
| `setup-const` | `const a = 1` | 直接引用 `a` |
| `setup-let` | `let a = 1` | 直接引用 `a` |
| `setup-ref` | `ref()` / `computed()` | `a.value` |
| `setup-maybe-ref` | 可能 ref 也可能普通值（如函数返回） | `_unref(a)` |
| `setup-reactive-const` | `reactive()` / `shallowReactive()` | 直接引用 `a`（不 `.value`） |
| `props` | defineProps 声明的 | 直接引用 `__props.xxx` |
| `literal-const` | `const a = 'x'` 字面量 | 常量内联，可参与静态提升 |

一句话规则：**ref 加 `.value`，reactive 和普通变量直接引，props 走 `__props`**，全部在编译期定死，运行时无需代理。

## scoped 样式

`<style scoped>` 会让编译器给这个 SFC 生成唯一 id：`data-v-xxxxxxx`，由文件路径（及内容）哈希得到，同一文件所有块共用。模板元素编译产物里会注入该属性：

```typescript
_createElementVNode("div", { class: "box", "data-v-7ba5bd90": "" }, ...)
```

`compileStyle` 同时给选择器补上属性选择器：

| 源码 | 编译后 | 说明 |
|------|--------|------|
| `.foo` | `.foo[data-v-xxxxxxx]` | 只命中本组件元素 |
| `.foo .bar` | `.foo .bar[data-v-xxxxxxx]` | 只给最后一段加 |
| `:deep(.foo)` | `[data-v-xxxxxxx] .foo` | 穿透，命中子组件内部 |
| `:slotted(.foo)` | `.foo[data-v-xxxxxxx-s]` | 命中插槽内容 |
| `:global(.foo)` | `.foo` | 不加 scope，全局生效 |

子组件根节点无需额外处理：父组件的 scoped 样式同样作用于子组件根元素（根元素会带上父级 scopeId），这也是"没写穿透却影响了子组件根节点"的原因。

## 编译产物结构

一个带 `<script setup>` + `<style scoped>` 的 `.vue` 编译后大致长这样：

```javascript
import { defineComponent as _defineComponent, ref, computed,
         toDisplayString as _toDisplayString, openBlock as _openBlock,
         createElementBlock as _createElementBlock } from "vue"

const _sfc_main = /* @__PURE__ */ _defineComponent({
  __name: "Foo",
  props: { title: String },
  emits: ["change"],
  setup(__props, { emit: __emit, expose: __expose }) {
    const count = ref(0)
    const double = computed(() => count.value * 2)
    __expose({ count })
    return (_ctx, _cache) => {
      return (_openBlock(), _createElementBlock("div", {
        "data-v-7ba5bd90": "",
        onClick: _cache[0] || (_cache[0] = () => count.value++)
      }, _toDisplayString(double.value), 1 /* TEXT */))
    }
  }
})

_sfc_main.__scopeId = "data-v-7ba5bd90"
_sfc_main.__file = "src/components/Foo.vue"
export default _sfc_main
```

| 产物片段 | 作用 |
|---------|------|
| `import { ... } from "vue"` | 按需引入运行时辅助函数，tree-shaking 友好 |
| `_sfc_main` | 组件选项对象，含 props/emits/setup |
| 内联 render 闭包 | 直接引用顶层绑定，不过 `_ctx` |
| `__scopeId` / `__file` | scoped 的 id（运行时打标）/ 开发期告警定位来源 |

开发环境下 Vite 的 vue 插件还会在模块外层包一层 HMR 逻辑：给 `_sfc_main` 打上 `__hmrId`，注册 `__hmrId → 组件` 映射，更新时热替换该模块而不刷新页面。

## 面试答法

`@vue/compiler-sfc` 处理 .vue 分三步：先 `parse` 把文件切成 `SFCDescriptor`（template、script、scriptSetup、styles 各块），再分别用 `compileScript`、`compileTemplate`、`compileStyle` 编译，最后拼成一个标准 JS 模块。`<script setup>` 里的 `defineProps/defineEmits/defineExpose/defineModel/defineOptions` 都不是运行时函数，而是编译期被识别并消除的宏，这就是它们不用 import 的原因；编译器同时收集顶层绑定的 `bindingMetadata`，据此决定模板里标识符是直接引用还是走 `_ctx`，inline 模式下 render 被内联进 setup 闭包直接引用变量，绕开代理也是性能点。scoped 样式则给 SFC 生成 `data-v-xxxxxxx`，模板元素注入该属性、CSS 选择器补属性后缀，`:deep` 穿透、`:slotted` 命中插槽、`:global` 全局，最终产物是 `_sfc_main` 加上 `__scopeId`、`__file` 和 render。
