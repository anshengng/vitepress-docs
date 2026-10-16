# 事件捕获、冒泡与事件委托

## 题目

> 事件传播分几个阶段？addEventListener 第三个参数有哪些用法？什么是事件委托，原理是什么，有什么好处？e.target 和 e.currentTarget 有什么区别？stopPropagation 和 stopImmediatePropagation 呢？Vue 的事件修饰符和 React 的合成事件跟这些是什么关系？

## 为什么需要

一个 10000 条的列表要点任意一行做操作：给每个 li 绑监听？绑一万个函数占一万份内存，而且动态追加的行**根本没有监听**。事件委托利用"事件会冒泡"这个特性——**只在父容器上绑一个监听器，靠冒泡收集所有子元素的事件，再看 e.target 判断点的是谁**。

## 核心要点

### 1. 事件传播三阶段

```
DOM 树：window > document > div > ul > li(被点击)

        ┌──── ① 捕获阶段（capture：从外到内，window → li）
        ▼
     window
       document
         div
           ul
             li   ◄── ② 目标阶段（在 li 自身触发）
           ul
             div
       document
         div
window ─┘
        ▲
        └──── ③ 冒泡阶段（bubble：从内到外，li → window）

addEventListener 默认监听【冒泡阶段】；传 capture 才在捕获阶段触发。
同元素上多个监听：按注册顺序执行（捕获/冒泡只影响跨元素顺序）。
```

### 2. addEventListener 第三个参数

| 写法 | 效果 |
| --- | --- |
| `false`（默认） | 冒泡阶段触发 |
| `true` | 捕获阶段触发 |
| `{ capture: true }` | 对象写法，等价 true |
| `{ once: true }` | 触发一次后自动移除监听 |
| `{ passive: true }` | 承诺回调里不会 `preventDefault()`，浏览器可立刻滚动（touch/wheel 性能优化） |

```
坑：passive 默认值随规范变化——Chrome 里 window/document 的
    touchstart/touchmove/wheel 默认 passive:true，
    在这类监听里调 preventDefault() 无效并告警。
```

### 3. 事件委托原理 + 手写

```
没有委托：每个 li 各绑一个            有委托：只绑 ul 一个
 ul                                ul  ← 唯一监听器
  ├ li ← fn1                        ├ li
  ├ li ← fn2                        ├ li     点击冒泡到 ul，
  ├ li ← fn3      vs                ├ li     用 e.target 判断来源
  └ li ← fn4                        └ li     （新追加的 li 自动生效）
（10000 行 = 10000 个函数）          （10000 行 = 1 个函数）
```

```javascript
const ul = document.querySelector('ul')
ul.addEventListener('click', e => {
  // closest 向上找最近的 li（点到 li 里的 span 也能命中）
  const li = e.target.closest('li')
  if (li && ul.contains(li)) {          // 确认确实在本容器内
    handle(li.dataset.id)
  }
})
// 动态追加的行无需任何额外处理
ul.insertAdjacentHTML('beforeend', '<li data-id="5">新行</li>')
```

三大好处：**动态元素自动生效**、**内存占用小**、**统一管理**（增删行不用同步增删监听）。

### 4. target vs currentTarget

```
ul > li > span，在 ul 上绑监听，点击 span：

e.target        = span  ← 事件真正发生的最深元素
e.currentTarget = ul    ← 当前正在执行监听器的元素（等于回调里的 this）

委托的本质 = 用 target 判断"谁被点了"，用 currentTarget 限定"在哪一层处理"
```

### 5. 两个 stop 的区别

```
li   监听A ── stopPropagation() ──► 冒泡止步于 li，
li   监听B（同元素其他监听）        但 B 照常执行
                                   └ ul 上的委托收不到事件 ❌

li   监听A ── stopImmediatePropagation() ──► 冒泡止步 + 同元素
li   监听B                                   的 B 也被屏蔽 ❌❌
```

| 方法 | 阻止继续冒泡 | 阻止同元素后续监听 | 备注 |
| --- | --- | --- | --- |
| `preventDefault()` | 否 | 否 | 只取消默认行为（链接跳转、表单提交） |
| `stopPropagation()` | ✅ | 否 | |
| `stopImmediatePropagation()` | ✅ | ✅ | |

### 6. Vue / React 的对应关系

| 需求 | Vue 修饰符 | React 写法 |
| --- | --- | --- |
| 阻止冒泡 | `@click.stop` | `e.stopPropagation()` |
| 阻止默认 | `@click.prevent` | `e.preventDefault()` |
| 捕获阶段 | `@click.capture` | `addEventListener(..., {capture:true})` |
| 只触发一次 | `@click.once` | 手动 remove / useRef 标志 |
| 只处理自身 | `@click.self`（内部判 `e.target===e.currentTarget`） | 同左，回调里自己判断 |
| 被动监听 | `@click.passive` | React 合成事件里 passive 有限制，原生用 addEventListener |
| 按键限定 | `@keyup.enter` | `if (e.key==='Enter')` |

React 补充：React 17+ 把**所有合成事件委托到根容器**（root）而非 document，一个应用只有一层原生监听，这也是"事件委托"思想的工程化应用。

## 面试答法

### 30 秒版（可背诵）

> 事件传播分三个阶段：从 window 往下到目标元素的捕获、目标元素自身触发、再往上冒泡回 window。addEventListener 第三个参数默认 false 监听冒泡，传 true 或 capture 选项监听捕获，once 触发一次自动移除，passive 承诺不阻止默认行为以优化滚动。事件委托就是利用冒泡，只在父容器绑一个监听器，通过 e.target 判断实际被点的子元素，好处是动态新增元素自动生效、监听器数量少省内存、方便统一管理。target 是最初触发事件的元素，currentTarget 是绑定监听器的元素，委托就是靠这两个配合。阻止冒泡用 stopPropagation，它不影响同元素其他监听，stopImmediatePropagation 连这些一起屏蔽。Vue 的 .stop .self .capture 等修饰符是对这些 API 的封装，React 则把合成事件统一委托到根容器。

### 深入版（被追问时按编号展开）

1. **三阶段**：画 window→…→target→…→window 的完整路径，说明默认冒泡阶段触发
2. **第三参数表**：true/false/once/passive，顺带提 touch 事件 passive 默认值的坑
3. **委托手写**：ul 一个监听 + `e.target.closest('li')` + `ul.contains` 防越界
4. **好处三条**：动态元素、内存、统一管理；对比"每行一个监听"的代价
5. **target/currentTarget**：ul>li>span 点 span 的例子，self 修饰符就是判二者相等
6. **两个 stop**：冒泡止步 vs 同元素后续监听也屏蔽；preventDefault 是另一维度
7. **框架落地**：Vue 修饰符对照表；React 合成事件委托到 root 的设计

### 常见追问

- **委托到 document 和委托到容器上有什么区别？** → 委托到具体容器范围更小、更快、不怕外部点击误触发；React 委托到 root 就是为了限定应用范围
- **为什么 mouseover/mouseenter 一个能委托一个不能？** → mouseover 会冒泡可委托；mouseenter/mouseleave 不冒泡，只能靠 mouseover + 判断 relatedTarget 模拟（jQuery 的 hover 委托就这么做）
- **focus 能委托吗？** → 原生 focus 不冒泡，但捕获阶段能收到（focusin 才冒泡），所以表单委托常用 `addEventListener('focusin', ...)`
- **once 和手动 removeEventListener 有什么区别？** → once 由浏览器保证"恰好一次"且自动清理；注意匿名函数每次执行都是新引用，remove 时必须保存同一函数引用
- **为什么 passive 里 preventDefault 无效？** → 浏览器为了滚动流畅，在监听器执行前就开始合成滚动；passive 是告诉浏览器"放心滚"，再调 preventDefault 就违约，被忽略并告警
