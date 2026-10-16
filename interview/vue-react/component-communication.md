# 组件通信方式大全

## 题目

> Vue 组件之间有哪些通信方式？父子、兄弟、跨层级分别怎么选？provide/inject 原理是什么？React 里怎么通信，为什么没有事件总线？

## 为什么需要

组件是隔离的（各自有独立作用域），但页面是协作的（购物车数量要同时出现在头部角标和结算栏）。先看清组件间的**关系拓扑**，再对号入座选方案：

```
        ┌──────── App ────────┐        关系类型：
        │                     │        ① 父子（直上直下）
   ┌─ Header ─┐          ┌─ Cart ─┐    ② 兄弟（同父）
   │  角标     │          │  列表   │    ③ 跨层级（祖先↔深层后代）
   └──────────┘          └────────┘    ④ 全局（任意两处）
```

## 核心要点

### ① 父子：props 向下 + emit 向上（最基础）

```
父 <User :name="张三" @update="onUpdate"/>
        │ props(只读，单向数据流) ▼
      ┌─子────────────┐
      │ props: name   │
      │ emit('update')│
        ▲ 事件(自定义) │
      └───────────────┘
```

```js
// 子组件
const props = defineProps(['name'])
const emit = defineEmits(['update'])
emit('update', newValue)   // 子不直接改父的数据，只"通知"
```

单向数据流的意义：**数据所有权归父组件**，子改数据只能通过事件让父改，来源可追踪。

- `v-model`（Vue3 默认是 `modelValue` prop + `update:modelValue` 事件）就是这套的语法糖；支持 `v-model:title`、`v-model:visible` 多绑定。Vue2 时代的 `.sync` 已被 v-model 参数取代
- 需要子暴露方法给父调用：子 `defineExpose({ reset })` + 父模板 `ref` 拿实例调 `childRef.value.reset()`

### ② 兄弟：两条路

```
路 A：提升状态（推荐）        路 B：事件总线 mitt
        父(持有共享数据)             A ──emit──► mitt ──on──► B
       /        \                  （组件间解耦，但数据流向隐式，
     B1        B2                    大项目慎用，官方已移除 $on）
   props+emit  props+emit
```

```js
// mitt 极简用法
import mitt from 'mitt'
const bus = mitt()
bus.emit('evt', payload)
bus.on('evt', handler)   // ⚠️ unmounted 里记得 bus.off
```

### ③ 跨层级：provide / inject

祖先声明、任意深度后代注入，**中间层完全无感**（不用逐层 props 透传）：

```
App ── provide('theme', 响应式值)
 └─ Layout
     └─ Sidebar
         └─ MenuItem ── inject('theme') ✅ 直达，穿透 3 层
```

```js
// 祖先
provide('theme', themeRef)     // 传 ref/computed 才保持响应式
// 后代（任意层）
const theme = inject('theme')
```

典型应用：主题、语言、表单容器向任意深度字段注入校验规则（Element Plus 的 Form→FormItem 就是这么连的）。

### ④ 全局：Pinia

任意组件直接读写同一个 store，store 是中枢：

```
   组件A ──┐                        ┌── 组件C
           ├──►  Pinia Store  ◄──┤
   组件B ──┘   (state/getters/action) └── 组件D
```

```js
const cart = useCartStore()
cart.addItem(p)          // 调 action
watch(() => cart.count, ...)  // 跨组件响应式联动
```

### 补充：attrs 透传

父传给子的**非 props** 属性（class、style、自定义 attr）落在 `useAttrs()`，子组件根元素默认自动继承；做组件封装（如给 Button 包一层）时用 `v-bind="$attrs"` 把没声明的属性继续往下传，避免"属性掉在半路"。

### React 侧对照

| 场景 | Vue | React |
| --- | --- | --- |
| 父子 | props / emit | props / 回调函数（把函数当 prop 传下去） |
| 直接调方法 | expose + ref | forwardRef + useImperativeHandle |
| 跨层级 | provide/inject | Context |
| 兄弟 | 提升状态 / mitt | 提升状态（**没有事件总线**） |
| 全局 | Pinia / Vuex | Redux / Zustand / Context |

React 没有流行事件总线的原因：函数组件每次渲染都是**新执行**，`on` 的闭包会捕获旧 state、卸载清理难做对，天然不如"数据从顶层流下来"的单向模型可靠。

### 选型决策树

```
要通信的两个组件是什么关系？
├─ 父子 ────────────► props + emit（v-model 是糖）
├─ 兄弟 ────────────► 提升到共同父；不想提升 → mitt(小项目)
├─ 祖先↔深层后代 ────► provide/inject
└─ 任意/全局共享 ────► Pinia（React: Zustand/Redux/Context）
```

## 面试答法

### 30 秒版

> 按组件关系选方案：父子用 props 向下、emit 向上，v-model 本质就是这套的语法糖；兄弟优先把状态提升到共同父组件，不想提升可以用 mitt 事件总线，但数据流向会变隐式；跨层级用 provide/inject，祖先提供、任意深度后代注入，中间层无感；全局共享上 Pinia。React 侧对应的是 props 加回调、Context、Zustand 或 Redux，React 基本不用事件总线，因为函数组件每次渲染都是新闭包，总线监听很难管对生命周期。

### 深入版（被追问时按这条线展开）

1. **先画关系图**：父子/兄弟/跨层级/全局四类，逐类给方案，体现"对号入座"而非背清单
2. **props+emit 深挖**：单向数据流为什么这么设计（可追踪性）；v-model 的 prop+event 拆解；Vue2 `.sync` → Vue3 带参数 v-model 的演进
3. **provide/inject 深挖**：传 ref 才有响应式、注入是只读约定（改要暴露方法）、Element Form/FormItem 的真实用例
4. **Pinia 深挖**：为什么大项目偏爱 store 而不是层层透传；与 provide/inject 的边界（全局 vs 局部树）
5. **React 对照**：Context 为什么不能滥用（Provider 变化导致整棵子树重渲染）；回调上抛 vs emit 的差别

### 常见追问

- **emit 和回调 prop 有区别吗？** → 机制相同（都是子调函数），emit 多了事件名约定与 `emits` 声明校验
- **provide/inject 和 Pinia 选哪个？** → 只在某棵子树内共享、不想进全局 store → provide/inject；跨路由跨页面 → Pinia
- **兄弟组件一定需要总线吗？** → 不必，状态提升到父组件是最正统做法；总线适合"点状通知"而非共享状态
- **Context 和 provide/inject 谁更强？** → 都能穿透层级；Vue 注入的是响应式引用天然细粒度，React Context 值变化会重渲染所有 Consumer，需要拆小 Context 或配合 memo
