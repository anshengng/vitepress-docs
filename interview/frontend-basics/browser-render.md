# 浏览器渲染原理

## 题目

> 浏览器拿到 HTML 后是怎么一步步变成屏幕上的像素的？DOM 和 CSSOM 是串行还是并行构建的？渲染流水线有哪几步？重排和重绘的区别，什么时候只触发合成？will-change / transform 为什么能提速？合成层是什么，GPU 加速的原理？

## 为什么需要

把渲染想成**盖房子**：

- HTML 是**设计图纸**（结构），CSS 是**装修标准**（样式）。施工队（渲染引擎）必须同时拿到两本才能开工——缺装修标准就先不刷墙，缺图纸则根本不知道墙在哪。
- **重排**=拆了墙改户型（位置尺寸变了，后面所有房间都要重新量）；**重绘**=只换墙漆颜色（户型不动）；**合成**=预制板在工厂（GPU）做好直接吊装，现场只拼装不施工。

理解这条流水线的价值：你能准确判断"这个动画/这次 DOM 操作到底贵在哪一步"，性能优化才不是玄学。

```
渲染流水线全景（主流浏览器 Chromium 模型）：

 HTML 字节 ─► 解析 ─► DOM Tree ─────┐
                                    ├─► Style ─► Layout ─► Paint ─► Composite ─► 屏幕
 CSS 字节 ─► 解析 ─► CSSOM Tree ────┘        几何    绘制指令   分层合成
                                    │
                              Render Tree
                         （DOM×CSSOM 可见节点）
```

## 核心要点

### 1. HTML 解析与 CSSOM 构建：并行，但有阻塞规则

```
时间线（自上而下是 HTML 解析推进方向）：

t0 │ 解析 <head>...<link stylesheet>  ──► CSS 下载【异步发起】
   │        │                              │
t1 │ 继续解析 body（HTML 解析器不停）        │ CSS 下载/解析中
   │        │                              ▼
t2 │ 遇到 <script>（同步）             CSSOM 就绪
   │        ▼
t3 │ 【HTML 解析暂停】等 JS 下载+执行完 ──► JS 里 getComputedStyle？
   │        │                            必须等 CSSOM 先就绪！
t4 │ 恢复解析 ◄─ 脚本执行完
   │        │
t5 │ <script defer>：不阻塞解析，DOM 构建完按文档序执行
   │ <script async>：下载完立刻执行（可能打断解析、乱序）
   ▼
 DOMContentLoaded（DOM 完 + defer 脚本执行完）
```

三条规则：

1. **HTML 与 CSS 下载/解析并行**——`<link>` 不阻塞 HTML 解析器，但**阻塞渲染**（没 CSSOM 不构建 Render Tree，首屏宁可白屏也不裸奔）。
2. **同步 JS 阻塞 HTML 解析**——脚本可能读写样式/DOM，必须等 DOM 到当前位置 + CSSOM 就绪。
3. **JS 读样式属性会强制同步布局**（见第 4 小节"布局抖动"）。

### 2. 渲染流水线五步

```
DOM + CSSOM
   │ ① Style/Render Tree：合两树，只留可见节点
   │    display:none 不进树；visibility:hidden 进树占位；
   │    opacity:0 进树且占位
   ▼ ② Layout（回流/重排）：算每个盒子的 x/y/宽/高
   │    从根开始递归，输出 Layout Tree（几何信息）
   ▼ ③ Paint：生成绘制记录（文本、颜色、阴影、渐变…）
   │    按层分组，交给光栅化线程
   ▼ ④ Rasterize：把绘制指令变成位图纹理（tile 分块光栅化）
   ▼ ⑤ Composite：合成线程把各层纹理按 z 序变换、拼成最终帧
        交给 GPU 上屏（VSync 节拍，约 16.7ms/帧）
```

### 3. 重排 vs 重绘 vs 仅合成

| 触发 | 走到的步骤 | 代价 | 例子 |
| --- | --- | --- | --- |
| 重排 Reflow | Style→**Layout**→Paint→Composite | 最贵（几何重算+重绘+可能连锁） | width/height、margin、display、字体大小、增删 DOM、窗口 resize |
| 重绘 Repaint | Style→**Paint**→Composite | 中（不重算几何） | color、background、box-shadow、visibility |
| 仅合成 Composite | **只** Composite | 最便宜（GPU 搬运纹理） | transform、opacity（有独立层时） |

```
代价阶梯（动画为什么首选 transform/opacity）：

重排： Layout 整棵树重算 ──────────► ~几十 ms，掉帧
重绘： 该区域重新光栅化 ──────────► ~几 ms，可能掉帧
合成： 已有纹理做矩阵变换 ────────► ~0.1 ms，GPU 顺手完成
```

### 4. 合成层与 GPU 加速

浏览器把页面拆成多个**层**（layer），多数元素画在同一"内容层"上；满足条件时元素被**提升为独立合成层**，拥有自己的纹理，合成线程可独立变换它。

```
未分层：  动画元素每帧重绘整块区域
          ┌────────────────────┐
          │ 内容层：所有像素一起 │ ─► 每帧重画
          └────────────────────┘

分层后：  动画元素独占一层，纹理只画一次
          ┌──────────┐ ┌─────┐
          │ 内容层    │ │ 弹层│ ─► 合成线程只对它做 translate/缩放
          ┌──────────┐ ┌─────┐
          │ 背景层    │ │导航 │    矩阵变换 = GPU 的本职工作
          └──────────┘ └─────┘
```

提升为合成层的常见条件：3D transform（translateZ(0)/rotate3d）、`will-change: transform/opacity`、video/canvas、opacity/transform 动画播放中、被合成层覆盖的兄弟节点（层爆炸风险）。

- **will-change 的本质**：提前告诉渲染引擎"这元素要动"，让它先建层、备好纹理，避免动画开始那帧才提升导致的卡顿。用完要设 `auto`，否则层常驻吃显存。
- **GPU 为什么快**：合成是海量独立像素的矩阵运算（平移/缩放/旋转），天生适合 GPU 并行；而 Layout 是带依赖的树递归，难并行，只能 CPU。

### 5. 高频性能陷阱与对策

```
布局抖动（Layout Thrashing）：读写交替，每次读都强制同步 Layout

  for (...) {
    el.style.height = el.offsetHeight + 10 + 'px'   // 写→读→写…
  }
  时间线： W R W R W R   ← 每个 R 都插队触发一次同步重排（N 次）
  优化：   先批量读 → 再批量写   RRRR... → WWWW...   （1 次）
```

| 陷阱 | 对策 |
| --- | --- |
| 循环中改样式又读几何属性 | 读写分离；用 `offsetHeight` 前先缓存 |
| 动画用 top/left | 改 transform（合成层，免重排重绘） |
| 频繁增删 DOM | DocumentFragment / innerHTML 一次性替换 |
| 文字回流 | 绝对定位脱离文档流、contain: layout |
| 层爆炸（过度 will-change） | 动画结束清除；DevTools→Layers 面板检查 |
| 首屏白屏 | 关键 CSS 内联、CSS 异步化（media/print） |

## 面试答法

### 30 秒版（可背诵）

> 浏览器拿到 HTML 后，解析器构建 DOM 树，同时并行下载解析 CSS 构建 CSSOM；两棵树合成渲染树（只含可见节点），然后走五步流水线：样式计算、布局（算几何）、绘制（生成绘制指令）、分块光栅化、合成（GPU 把各层纹理拼成帧）。改变位置尺寸触发重排，代价最大；只改颜色背景触发重绘；transform 和 opacity 在独立合成层上只走合成，最便宜——这就是动画优先用 transform 的原因。will-change 提前提示浏览器建层，把纹理准备从动画首帧挪到空闲期。常见性能问题是布局抖动：JS 读写样式交替导致每次读都强制同步重排，对策是批量读、批量写。

### 深入版（被追问时按编号展开）

1. **画并行时间线**：CSS 异步下载但阻塞渲染、同步 JS 阻塞解析、defer/async 差异
2. **五步流水线逐个讲**：Render Tree 可见性规则 → Layout 几何 → Paint 指令 → 光栅化 → Composite
3. **三级代价对比表**：重排/重绘/合成的触发属性 + 走到流水线哪一步
4. **合成层机制**：分层示意图 + 提升条件 + GPU 并行为何适合矩阵变换
5. **will-change 两面性**：提前建层防首帧卡顿 vs 滥用导致层爆炸/显存压力
6. **布局抖动**：读写交替强制同步 Layout 的时间线 + 读写分离修复
7. **收尾加分**：Chromium 的 CC 线程、VSync 节拍、Content-Paint-Only 的 containment 属性

### 常见追问

- **visibility:hidden 和 display:none 渲染差异？** → display:none 不进渲染树不占位；visibility:hidden 进树占位，只跳过绘制
- **transform 动画一定不重排吗？** → 2D transform 改变视觉位置但不改布局盒；若动画中元素尺寸由内容变化仍可能重排；只有合成层上的 transform/opacity 才保证仅合成
- **为什么 CSS 阻塞渲染但 JS 阻塞解析？** → 渲染必须样式正确否则白屏闪烁；解析被 JS 阻塞是因为脚本可能 document.write 改写后续文档
- **如何观察重排重绘？** → DevTools Performance 面板看紫色 Layout/绿色 Paint 条；Rendering 面板开启 Paint flashing（绿色高亮重绘区）
- **大量 box-shadow 为什么卡？** → 绘制指令复杂、阴影需模糊计算，且元素若未分层每次重绘都重算
- **contain 属性是干什么的？** → 声明子树隔离（layout/paint/size），缩小重排重绘影响范围，长列表优化利器
