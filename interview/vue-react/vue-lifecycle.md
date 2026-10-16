# Vue 生命周期

## 题目

> 讲讲 Vue 的生命周期？每个钩子分别能做什么？created 和 mounted 有什么区别，请求放哪个？父子组件的生命周期执行顺序是怎样的？卸载时要清理什么？

## 为什么需要关心生命周期

一个组件从"出生"到"销毁"，本质是**模板编译 → 建立响应式 → 生成 DOM → 更新 → 移除**的过程。钩子就是这条流水线上预留的"检查点"：

```
你无法在 DOM 还没造出来时操作 DOM，
也无法在响应式还没建立时访问 data——
生命周期钩子就是告诉你：什么时候"能做什么事"。
```

## 核心要点

### 完整时间轴（Vue3，标注 Vue2 差异）

```
【创建阶段】(JS 对象世界，还没有 DOM)
  beforeCreate/setup   实例刚 new 出来，data/props/methods 全不可用
        │              ⚠️ 唯一"啥也干不了"的钩子
        ▼
  ① 初始化响应式(data/props/computed/watch 就位)
        ▼
  created (Vue3 中 ≈ setup 之后)
        │  ✅ 能访问 data、发请求、订阅全局事件
        │  ❌ 拿不到 DOM（$el 是 undefined）
        ▼
【挂载阶段】(开始造真实 DOM)
  beforeMount
        │  ❌ 仍拿不到最终 DOM；$el 指向旧的/空容器
        ▼
  ② 编译模板 render → 生成 VNode → patch 出真实 DOM
        ▼
  mounted
        │  ✅ DOM 完整可用：操作 DOM、初始化图表/第三方库、
        │     拿元素尺寸、发请求（若依赖 DOM 尺寸则必须在这）
        ▼
【更新阶段】(响应式数据变化时循环)
  beforeUpdate
        │  data 已变，DOM 还没更新（拿到的旧 DOM 与新 data 不一致）
        ▼
  ③ 重新 render + diff + patch DOM
        ▼
  updated
        │  DOM 与新 data 同步了；⚠️ 别在这改状态，会死循环
        ▼
【卸载阶段】
  beforeUnmount (Vue2: beforeDestroy)
        │  DOM 还在，做最后的同步清理
        ▼
  unmounted (Vue2: destroyed)
        │  DOM 已移除，清定时器/解绑事件/断开观察器
```

### 每个钩子的典型用途

| 钩子 | 此刻能做什么 | 典型用途 | Vue2 对应 |
| --- | --- | --- | --- |
| setup / beforeCreate | 几乎啥都不能 | — | beforeCreate |
| created | 访问 data、发请求 | 初始化数据、非 DOM 依赖的请求 | created |
| beforeMount | 拿不到最终 DOM | 极少用 | beforeMount |
| mounted | DOM 完整 | 操作 DOM、第三方库初始化、依赖布局的请求 | mounted |
| beforeUpdate | data 新、DOM 旧 | 访问更新前的 DOM（少见） | beforeUpdate |
| updated | data 与 DOM 都新 | 依赖新 DOM 的后续操作 | updated |
| beforeUnmount | DOM 还在 | 清理前的最后读取 | beforeDestroy |
| unmounted | 全没了 | 清定时器/事件/observer | destroyed |

### 图解：为什么 created 就能 this.xxx？

响应式初始化发生在 created **之前**，所以 data 已就位：

```
new Component()
     │
     ├─ initState:  把 data() 返回值用 reactive 包起来，
     │              并代理到实例上 → this.msg 可访问 ✅
     ├─ initProps / initComputed / initWatch
     │
     ├─ 调用 created 钩子 ◄── 此时 this.msg 已经是响应式的
     │
     └─ 直到挂载阶段才 compile + createElement 出 DOM ◄── mounted 才有 DOM
```

### 父子组件嵌套顺序（重点）

挂载时"父先开始、子先结束"；更新/卸载同理——**子组件总是比父组件更早完成**：

```
父 beforeCreate / setup
└─ 父 created
   └─ 父 beforeMount
      └─ 父 render 时发现子组件 → 触发子挂载：
         ├─ 子 beforeCreate / setup
         ├─ 子 created
         ├─ 子 beforeMount
         ├─ 子 render + patch
         └─ 子 mounted          ◄── 子先"完工"
      └─ 父 mounted             ◄── 所有子完工后父才 mounted
```

记忆口诀：**创建从外到内，挂载完成从内到外**（像盖楼：先搭外层框架，内层装修先验收）。卸载时也是子组件先 unmounted、父后 unmounted。

### 异步请求放哪个钩子？

```
接口只依赖参数        → created/setup（越早越好，不等 DOM）
接口依赖 DOM 尺寸/位置 → mounted（如滚动加载、图表自适应）
```

Vue3 组合式 API 里等价写法：`setup` 顶层直接调用即相当于 created 时机。

### unmounted 里必须清理什么

组件销毁 ≠ 你手动创建的东西消失，不清理会**内存泄漏**：

```js
onMounted(() => {
  timer = setInterval(poll, 1000)        // 定时器
  window.addEventListener('resize', fn)  // 全局事件
  observer = new ResizeObserver(cb)      // 观察器
  bus.on('evt', handler)                 // 事件总线
})
onUnmounted(() => {
  clearInterval(timer)
  window.removeEventListener('resize', fn)
  observer.disconnect()
  bus.off('evt', handler)
})
```

### keep-alive 补充

被 `<keep-alive>` 缓存的组件不销毁，只"休眠/唤醒"，额外触发 `activated` / `deactivated`——列表进详情再返回时刷新数据就靠它，其余钩子与普通组件一致。

## 面试答法

### 30 秒版

> Vue 生命周期分创建、挂载、更新、卸载四个阶段。关键分界线是 created 和 mounted：响应式初始化在 created 之前完成，所以 created 里就能访问 data、发请求，但拿不到 DOM；等模板编译、真实 DOM 生成后才有 mounted，需要操作 DOM 或依赖布局的请求放 mounted。父子组件是"创建从外到内、挂载完成从内到外"，子组件先 mounted。卸载时要在 unmounted 里清定时器、全局事件监听这些手动创建的资源，不然内存泄漏。被 keep-alive 缓存的组件再多一对 activated/deactivated，销毁换成休眠。

### 深入版（被追问时按这条线展开）

1. **画时间轴**：beforeCreate → 响应式初始化 → created → 编译/patch → mounted → beforeUpdate → updated → beforeUnmount → unmounted，每个点说"能做什么不能做什么"
2. **created vs mounted**：本质区别是"响应式就位"与"DOM 就位"两个里程碑，请求按是否依赖 DOM 选位置
3. **父子顺序**：用调用树讲"父 started 早、子 finished 早"，可延伸 Vue2 beforeDestroy → Vue3 beforeUnmount 改名
4. **组合式 API 映射**：setup ≈ beforeCreate+created；onMounted/onUnmounted 等注册回调，没有 onBeforeCreate/onCreated（setup 本身就是）
5. **清理与泄漏**：举定时器 + window 事件的例子，说明组件销毁不会自动回收外部资源
6. **keep-alive**：activated/deactivated 的缓存场景（列表-详情返回）

### 常见追问

- **为什么没有 onBeforeCreate/onCreated？** → setup 执行时机就在响应式建好前后，函数式写法里 setup 顶置代码等价于 created
- **updated 里改 data 会怎样？** → 触发新一轮更新，可能无限递归，应避免
- **父 mounted 时子组件一定好了吗？** → 是，子 mounted 先于父 mounted；但异步组件/插槽例外情况可提
- **路由切换会触发生命周期吗？** → 组件被销毁/重建就会；被 keep-alive 缓存则走 deactivated/activated
