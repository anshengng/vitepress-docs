# 虚拟列表与长列表性能优化

## 题目

> 十万条数据的列表怎么渲染不卡？虚拟列表的原理是什么？startIndex/endIndex 怎么算？为什么要撑一个总高度的占位容器？动态高度的虚拟列表难在哪？和分页、无限滚动、content-visibility 有什么区别？滚动白屏是怎么回事？为什么用 translateY 而不是 top 做偏移？

## 为什么需要

浏览器渲染 10 万个 DOM 节点，卡点不在"数据"而在**每个节点都要走一遍渲染流水线**：

```
10 万条数据 → 10 万个 DOM 的代价：

JS 执行          创建 10 万个元素对象 + 组件实例（Vue 响应式代理 ×10万）
   │
样式计算         每个节点算一遍 CSSOM（10 万次 matchStyle）
   │
布局 Layout      回流：一个节点位置变化可能牵连整棵树重算，
   │             首屏一次性排 10 万行 → 主线程阻塞数秒
   │
分层/绘制/合成   光栅化 10 万个节点的像素，显存暴涨
   │
内存             DOM 节点 + 事件监听 + 响应式依赖 → 轻松几百 MB

一句话：DOM 数量 ∝ 渲染开销，而用户一屏只看得到 10~20 条！
```

类比：**图书馆找书**。全量渲染是把馆藏 10 万本书全搬到桌上（找得到但桌子垮了）；虚拟列表是桌上只摆当前翻到的那一排书架格子，其余书留在库里，你翻页时**换桌上的书、不动库里的架子**——永远只维护视口内 + 少量缓冲的节点。

```
真实 10 万条，视口只看得见 10 条：

滚动前                        滚动 3 行后
┌─视口───────┐               ┌─视口───────┐
│ #0         │               │ #3         │  ▲
│ #1         │               │ #4         │  │ 只渲染
│ #2         │               │ #5         │  │ 这 10 个
│ ...        │               │ ...        │  ▼
│ #99999     │               │ #12        │
└────────────┘               └────────────┘
 渲染 10 万节点                 依然只渲染 ~10 个，
                              数据靠"窗口切片"移动
```

## 核心要点

### 1. 虚拟列表核心结构：三层容器 + 偏移公式

```
DOM 结构（三层）：
┌ container（滚动容器，固定 height: 600px, overflow-y: auto）
│ ┌ phantom（占位层，height = 总条数 × 行高，如 100000×40=400 万 px）
│ │  ▲ 作用：撑起真实滚动条，让 scrollTop 有意义
│ │  ┌ mover（内容层，transform: translateY(offsetY)）
│ │  │   只放视口内的 ~15 个真实节点
│ │  │   #12 ─┐
│ │  │   #13  │ 这 15 个 DOM 被"推"到
│ │  │   ...  │ 视口当前应该显示的位置
│ │  │   #26 ─┘
│ │  └──mover──
│ └──phantom──
└──container──

滚动时三个量：
  scrollTop      = 用户滚了多少（container 提供）
  offsetY        = 窗口第一项到列表顶部的距离 = startIndex × 行高
  可见条数       = 视口高度 / 行高

计算公式（固定高度）：
  startIndex = floor(scrollTop / itemHeight)
  endIndex   = min(startIndex + ceil(viewportHeight / itemHeight) + buffer, total)
  渲染数据   = list.slice(startIndex, endIndex)
  translateY = startIndex × itemHeight
```

buffer（缓冲区，上下各多渲染 3~5 条）是关键：快速滚动时新行已提前挂好，不至于露出空白。

### 2. 手写核心逻辑（固定高度版）

**Vue 3 关键片段：**

```vue
<template>
  <div class="container" ref="containerRef" @scroll="onScroll">   <!-- 滚动容器 -->
    <div class="phantom" :style="{ height: totalHeight + 'px' }"> <!-- 占位撑滚动条 -->
      <div class="mover" :style="{ transform: `translateY(${offsetY}px)` }">
        <div v-for="item in visibleList" :key="item.id" class="row">
          {{ item.name }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({ list: Array })
const ITEM_H = 40, BUFFER = 4
const viewportH = ref(600)
const scrollTop = ref(0)

const startIndex = computed(() =>
  Math.max(0, Math.floor(scrollTop.value / ITEM_H) - BUFFER))     // 上缓冲
const endIndex = computed(() =>
  Math.min(props.list.length,
    Math.ceil((scrollTop.value + viewportH.value) / ITEM_H) + BUFFER))
const visibleList = computed(() => props.list.slice(startIndex.value, endIndex.value))
const offsetY = computed(() => startIndex.value * ITEM_H)         // 窗口顶到列表顶的距离
const totalHeight = computed(() => props.list.length * ITEM_H)

let ticking = false
function onScroll(e) {                                           // rAF 节流，每帧最多算一次
  if (ticking) return
  ticking = true
  requestAnimationFrame(() => {
    scrollTop.value = e.target.scrollTop
    ticking = false
  })
}
</script>
```

**React 关键片段：**

```jsx
function VirtualList({ list, itemHeight = 40, height = 600 }) {
  const [scrollTop, setScrollTop] = useState(0)
  const buffer = 4

  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - buffer)
  const end = Math.min(list.length,
    Math.ceil((scrollTop + height) / itemHeight) + buffer)
  const visible = list.slice(start, end)

  return (
    <div style={{ height, overflowY: 'auto' }}
         onScroll={(e) => setScrollTop(e.target.scrollTop)}>
      {/* 占位层撑起总滚动高度 */}
      <div style={{ height: list.length * itemHeight, position: 'relative' }}>
        {/* 内容层用 transform 平移到视口位置 */}
        <div style={{ transform: `translateY(${start * itemHeight}px)` }}>
          {visible.map((item, i) => (
            <div key={item.id} style={{ height: itemHeight }}>{item.name}</div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

生产建议直接用 `vue-virtual-scroller` / `react-window` / `react-virtuoso`，面试手写是为了证明懂原理。

### 3. 动态高度难点：预估 + 测量修正 + 偏移累加数组

固定高度时 `index × itemHeight` 一步到位；行高不定（评论、商品卡片）就没有乘法公式可用了：

```
难点：滚到第 500 行时，它的 y 坐标 = 前 499 行高度之和，
     而每行多高在渲染前根本不知道 → 必须先"猜"再"量"再"修"

方案 A：预估高度 + 渲染后测量修正（react-window 动态模式思路）
  1. 未渲染的行用预估高（如平均 80px）参与总高计算
  2. 行真正渲染后，用 ResizeObserver/getBoundingClientRect 量真实高度
  3. 与预估有差 → 更新高度表 → 修正 translateY 和占位总高
  坑：修正发生在滚动中，用户视觉会"跳一下"，需保持锚定行不动

方案 B：offsets 累加数组 + 二分查找（vue-virtual-scroll 常用）
  offsets[i] = 第 0..i-1 行的累计高度（单调递增数组）
  例：offsets = [0, 80, 150, 150+40=190, ...]

  已知 scrollTop 求 startIndex：
    在 offsets 里二分找"最后一个 ≤ scrollTop 的 i" → O(log n)
    （线性扫描是 O(n)，10 万行每帧扫一遍就白做了）

  总高度 = offsets[n-1] + 最后一行高度（未测量的尾部用预估补齐）
```

```
二分查找示意（找 scrollTop=160 落在哪一行）：
offsets:  [0,   80,  150,  190,  300, ...]
               ▲____▲
               150≤160<190 → 第 2 行是可见首行
```

### 4. 横向对比：长列表优化的四条路

| 方案 | 原理 | 优点 | 局限 | 适用 |
| --- | --- | --- | --- | --- |
| 虚拟滚动 | 只渲染视口窗口，占位撑滚动条 | 任意位置直达、滚动条真实 | 实现复杂，动态高度难 | 聊天记录、表格、Feed 流 |
| content-visibility | CSS 属性，屏外子树跳过渲染 | 零 JS，一行代码 | 不省 DOM 数量与内存；跳过的块需 contain-intrinsic-size 估高 | 节点数中等（几千）、想低成本提速 |
| 分页 / 无限滚动 | 数据按需分段，DOM 随滚动增长 | 实现简单、对 SEO/接口友好 | 无限滚动 DOM 持续累积，滚到几千条后照样卡（需配合回收） | 搜索结果、电商列表 |
| Fragment 分片渲染 | 时间切片：每帧只渲染一批（如 50 条） | 不丢节点，首屏不阻塞 | 总 DOM 和内存不变，治标不治本 | 一次性展示的中量列表 |

```
DOM 数量随时间变化：
虚拟滚动   ▁▁▂▂▃▃▃▂▂▁▁  恒定 ~20 个
无限滚动   ▁▂▃▄▅▆▇██    只增不减 → 后期卡
分片渲染   ▁▃▆█▇▇▇▇▇▇    快速爬升后恒定（全量）
```

### 5. 两个高频追问的原理

**滚动白屏原因**：滚动速度 > 渲染速度。scroll 事件/重算/挂载新行需要时间，窗口切片还没更新完，视口里就露出 phantom 的空白。对策：加大 buffer、scroll 处理用 rAF 对齐帧、行组件保持轻量、避免在滚动回调里做重计算。

**为什么用 translateY 不用 top**：

```
改 top：触发 Layout（回流）→ 重绘 → 可能连累祖先重排，跑在主线程
改 transform：合成器线程直接搬图层，跳过 Layout/Paint → 不阻塞主线程
             且可提升为独立合成层（will-change: transform）
滚动本身是高频动画，偏移必须走"最便宜"的路径 → transform
```

## 面试答法

### 30 秒版（可背诵）

> 十万条 DOM 卡是因为每个节点都要走创建、样式计算、布局、绘制全流程，而用户一屏只看十几条。虚拟列表的思路是"三层结构"：外层滚动容器固定高度，中间占位层用总条数乘行高撑起真实滚动条，内层内容层只渲染视口附近的十几个节点，再用 translateY 把窗口平移到当前滚动位置。核心公式是 startIndex = floor(scrollTop / itemHeight)，endIndex 加上视口行数和缓冲区，数据用 slice 取窗口。动态高度没有乘法公式，要靠预估高度加渲染后测量修正，或者维护累计高度数组用二分查找定位。优化细节：滚动监听用 rAF 节流、缓冲区防白屏、偏移用 transform 走合成层而不是 top 触发回流。

### 深入版（被追问时按编号展开）

1. **画渲染流水线**：JS→样式→布局→绘制，10 万节点每步都 ×10 万，布局最致命
2. **画三层容器图**：container/phantom/mover，讲清占位层存在的意义（滚动条真实性）
3. **推公式**：startIndex、endIndex、translateY、buffer 各自防什么问题
4. **手写固定高度版**：Vue 用 computed 切片 + rAF 节流；React 用 useState(scrollTop)
5. **动态高度**：预估+ResizeObserver 修正的"跳动"问题；offsets 累加数组二分 O(log n)
6. **对比表收尾**：content-visibility 省渲染不省 DOM、无限滚动 DOM 累积、分片治标
7. **追问储备**：白屏=滚动快过渲染，加 buffer；transform 走合成、top 走回流

### 常见追问

- **滚动白屏怎么产生、怎么治？** → 滚动快于窗口更新，露出占位层空白；加大上下 buffer、rAF 节流、精简行组件、滚动回调里不做同步重计算
- **为什么 translateY 而不是 top？** → top 触发 Layout 回流跑主线程；transform 只动合成层，可由合成器线程处理，滚动高频场景不卡主线程
- **占位层高度为什么必须精确？** → 它决定滚动条比例和 scrollTop 的语义，动态高度下未测尾部用预估补齐，测到后回填修正
- **快速拖动滚动条到列表中部怎么办？** → scroll 事件仍逐帧算窗口，rAF 保证每帧一次；若单帧跨度大，直接按新 scrollTop 重算 slice，中间行从未渲染过也无所谓
- **无限滚动 DOM 累积怎么救？** → 顶部回收（回收后补 scrollTop 防跳动）或直接升级成虚拟滚动
- **虚拟列表对可访问性/打印有影响吗？** → 有，屏外内容在 DOM 里不存在，读屏和全文搜索会漏；对 SEO 页面慎用，Feed 类可接受
