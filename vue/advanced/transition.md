# Transition 与过渡动画

## 内置组件 Transition 的工作原理

`<Transition>` 本身**不渲染任何 DOM**，它只在被包裹的元素（或组件根节点）插入、移除、切换时，按阶段性地给这个元素添加/移除 CSS 类名，并在类名切换后监听 `transitionend` / `animationend` 决定何时结束。

```text
<Transition> 包裹单个元素/组件
    ↓ 监听子节点的 patch 类型
插入 → 加 enter 类 → 下一帧切到 active → 监听结束 → 移除类
移除 → 加 leave 类 → 下一帧切到 active → 监听结束 → 真正卸载
```

触发自动过渡的四个来源：

| 来源 | 说明 |
|------|------|
| v-if / v-else | 条件分支切换 |
| v-show | 只切 display 也支持过渡 |
| 动态组件 `<component :is>` | 组件间切换 |
| 改变 key | 同组件不同 key 视为替换 |

## CSS 过渡 class 命名

Vue 自动切换三组类名，前缀默认为 `v-`（可用 `name` 属性改）：

```text
进入（enter）：
  v-enter-from     → 进入的起始状态
  v-enter-active   → 进入的过渡过程（含 transition/animation 声明）
  v-enter-to       → 进入的结束状态

离开（leave）：
  v-leave-from     → 离开的起始状态
  v-leave-active   → 离开的过渡过程
  v-leave-to       → 离开的结束状态
```

时序：

```text
enter： from 与 active 同时加
        ↓ 下一帧
        from 移除，to 加上（此时开始过渡）
        ↓ 过渡/动画结束
        active 与 to 移除

leave： 同理，方向相反
```

示例：

```vue
<template>
  <Transition name="fade">
    <p v-if="show">内容</p>
  </Transition>
</template>

<style>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
```

## :duration、:css=false 与纯 JS 钩子

| 配置 | 作用 |
|------|------|
| `:duration="300"` | 手动指定时长，不依赖 transitionend 事件 |
| `:duration="{ enter: 300, leave: 500 }` | 进入/离开分别指定 |
| `:css="false"` | 关闭 CSS 类名切换，完全由 JS 钩子接管 |
| `:type="'animation'"` | 显式声明用 animation 而非 transition 判定结束 |

`:css="false"` 的意义：当动画由第三方库（GSAP 等）驱动、或不走 CSS 时，关闭 CSS 检测，避免 Vue 错误地等待一个不存在的 transitionend。

## JS 钩子与 done 回调

```vue
<Transition
  :css="false"
  @before-enter="onBeforeEnter"
  @enter="onEnter"
  @after-enter="onAfterEnter"
  @enter-cancelled="onEnterCancelled"
  @before-leave="onBeforeLeave"
  @leave="onLeave"
  @after-leave="onAfterLeave"
  @leave-cancelled="onLeaveCancelled"
>
  <div v-if="show">内容</div>
</Transition>
```

钩子签名与 done：

```typescript
// el：过渡的元素；done：显式通知 Vue 过渡结束
function onBeforeEnter(el: Element) {
  // 进入前设置初始状态
}

function onEnter(el: Element, done: () => void) {
  // 用 JS 驱动动画，结束后必须调用 done，Vue 才知道可以继续
  const anim = el.animate([{ opacity: 0 }, { opacity: 1 }], 300)
  anim.onfinish = done
}

function onLeave(el: Element, done: () => void) {
  const anim = el.animate([{ opacity: 1 }, { opacity: 0 }], 300)
  anim.onfinish = done
}
```

```text
有 done 参数      → Vue 等待 done 被调用后才结束过渡
没有 done 参数    → Vue 按 transitionend/animationend 或同步结束处理
```

## TransitionGroup 列表过渡

`<TransitionGroup>` 用于多个元素的列表，**默认渲染成一个容器元素**（默认 `<span>`，可用 `tag` 指定），并要求每个子元素**必须带唯一 key**。

```vue
<template>
  <TransitionGroup name="list" tag="ul">
    <li v-for="item in items" :key="item">{{ item }}</li>
  </TransitionGroup>
</template>
```

它比 `<Transition>` 多出一组类名：`v-move`（同样受 `name` 前缀影响，如 `list-move`），用于处理元素移动。

| 阶段 | 处理的类名 |
|------|-----------|
| 插入 | enter 三兄弟 |
| 移除 | leave 三兄弟 |
| 移动 | `v-move` 类（配合位置变化） |

FLIP 思路：

```text
列表顺序变化时
    ↓ First：记录每个元素变化前的旧位置
Last：计算变化后的新位置
    ↓ Invert：用 transform 把元素"视觉上"先拉回旧位置（制造假位移）
Play：移除 transform，CSS 过渡把元素从旧位平滑移到新位
```

这就是 `v-move` 起作用的前提——Vue 不直接改元素的 left/top，而是用 transform 做假位移再过渡，避免布局抖动。

```css
.list-move {
  transition: transform 0.3s ease;
}
```

## 与 v-show、动态组件的配合

| 场景 | 行为 |
|------|------|
| `v-show` | 只切 display，用 `<Transition>` 包裹仍可过渡，但元素始终在 DOM 中 |
| 动态组件 | 用 `<component :is>` 配合 `<Transition>`，切换时按 enter/leave 处理 |
| 多元素切换 | `v-if` / `v-else` 需 `<Transition>` 内**只放一个根级分支**（可用 `mode="out-in"` 串行） |

`mode` 控制切换时序：

```text
mode="in-out"  默认：新元素先进入，旧元素后离开
mode="out-in"  旧元素先离开，再让新元素进入（常用，避免重叠）
```

## 为什么根节点需要单一元素

`<Transition>` 只能作用于**一个**子节点，因为它需要明确"给哪个 DOM 元素加类名"。

```text
<Transition> 子节点数量
    ↓
恰好一个 → 找出该元素的 DOM 节点，施加过渡
多个     → 无法确定目标，控制台警告，过渡不生效
组件多根 → 组件有多根节点时同样无法定位
```

组件的处理方式：如果被 `<Transition>` 包裹的组件是多根（fragment），Vue 无法自动定位，会给出"Transition expects exactly one child"之类的警告，过渡不生效。正确的做法不是去"指定某个根"，而是让被包裹的组件保持单一根节点，或者把 `<Transition>` 下移到组件内部包住具体的那个元素：

```vue
<!-- 组件内部自己包住单根元素，而不是在外部包整个多根组件 -->
<template>
  <Transition name="fade">
    <div v-if="visible">内容</div>
  </Transition>
  <footer>多根的另一部分</footer>
</template>
```

因此实践建议是：被 `<Transition>` 直接包裹的目标**保持单一根节点**，多根组件则应在内部对需要过渡的那个元素单独包裹 `<Transition>`。

## 面试答法

Transition 是一个不渲染 DOM 的内置组件，它的工作是监听被包裹元素的插入与移除，在合适的时机切换一组 CSS 类名，并在切换后监听 transitionend 或 animationend 来判断过渡是否结束。进入是 enter-from、enter-active、enter-to，离开是 leave-from、leave-active、leave-to，active 类负责声明 transition 或 animation，from 和 to 负责起止状态，Vue 会在下一帧把 from 换成 to 来触发过渡。它支持用 :duration 手动指定时长、用 :css=false 关闭 CSS 检测让纯 JS 钩子接管，JS 钩子里如果声明了 done 参数，Vue 就会等你调用 done 才结束过渡。TransitionGroup 用来做列表过渡，要求每个子元素有唯一 key，除了 enter/leave 还会处理 v-move，本质是用 FLIP 思路先记录旧位置、再用 transform 做假位移并过渡到新位置，避免布局抖动。它只能作用于单一根元素，多根或 v-if 多分支时会无法定位而告警，所以要用 mode 或保证单根结构。
