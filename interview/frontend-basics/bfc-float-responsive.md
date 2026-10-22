# 清除浮动、BFC、响应式布局

## 为什么需要

- **BFC（块级格式化上下文）**是理解 CSS 普通流布局的钥匙：浮动脱流导致的父容器高度塌陷、相邻块级元素 margin 合并、两栏布局中文字环绕浮动——这三类经典 bug 的成因和解法全部落在 BFC 上。
- 面试把"清除浮动、BFC、响应式"放在一起问，实际是在考察：**普通流/浮动/定位的布局规则** + **多端适配的工程方案**，是从"会写样式"到"懂布局"的分水岭。

## 核心要点

### 1. 浮动为什么需要"清除"

```
浮动脱流：float 的子元素不再参与父容器高度计算

  <div class="parent">          未清除浮动：
    <div class="box"              ┌─ parent（高度 0，塌陷）
         style="float:left">      │   ┌────┐┌────┐
    子元素                          └───┤box ├┤box ├─ 浮出父容器
  </div>                                └────┘└────┘
  <div class="next">next 被浮动覆盖，页面错乱
  </div>
```

"清除浮动"的准确含义：**让父容器重新把浮动子元素计入高度**（clear 的本意是"清理"浮动影响，不是取消浮动）。

### 2. 清除浮动的四种方法

```css
/* ① clearfix 伪元素（最通用，推荐手写） */
.clearfix::after {
  content: '';
  display: block;     /* 块级才能触发 clear */
  clear: both;        /* 清到浮动元素之下 */
  height: 0;          /* 不占视觉空间 */
  visibility: hidden; /* 兼容老浏览器：隐藏这个空块 */
}
```

| 方法 | 写法 | 优缺点 |
| --- | --- | --- |
| clearfix 伪元素 | 如上 | 语义无损、复用性强，首选 |
| 父容器触发 BFC | `overflow: hidden` / `flow-root` | 一行解决；hidden 会裁剪溢出内容（如阴影、下拉） |
| 末尾加空清理元素 | `<div style="clear:both"></div>` | 额外空节点污染 DOM，不推荐 |
| 改用 flex/grid | 父容器 `display:flex` | 现代方案：浮动子元素在 flex 下不再脱流，从根上避免问题 |

### 3. BFC：触发条件与应用

BFC 是一块**独立的渲染区域**：内部子元素的布局不影响外部，外部也不影响内部；它是一块**块级**区域，内部按普通流排列。

```
两个相邻普通流块：margin 合并（10+20 → 取大 20）
   ┌────┐
   │ A  │ margin-bottom:10
   └────┘
   ┌────┐  ← 重叠，实际间距 20
   │ B  │ margin-top:20
   └────┘
两个块分属不同 BFC：不合并（10+20 → 30）
   ┌────┐
   │ A  │
   └────┘
     ↕ 30px（各自独立）
   ┌────┐
   │ B  │
   └────┘
```

**触发条件**（正确清单）：

| 类别 | 具体值 |
| --- | --- |
| 根元素 | `<html>` 本身 |
| 浮动 | `float: left/right`（非 none） |
| 绝对定位 | `position: absolute / fixed` |
| overflow | 非 `visible`：`hidden / auto / scroll / clip` |
| display | `flow-root / inline-block / table-cell / table-caption / flex / grid / table` 及 `inline-flex / inline-grid`、flex/grid 的子项 |
| 现代属性 | `contain: layout / paint / content`、`content-visibility` |

> ⚠️ 常见误区（面经原话"任何不为 auto 的 width/height 触发 BFC"是**错误**的）：单纯的宽高值不触发 BFC；是伴随的 float/absolute 等属性在起作用。

**BFC 四大应用**：

1. **清除浮动/自适应高度**：父容器 `overflow:hidden` 或 `display:flow-root`（flow-root 是专为触发 BFC 设计、无裁剪副作用的现代写法）。
2. **阻止 margin 合并**：父子 margin 穿透合并时，给父容器设 BFC 隔离。
3. **两栏布局防环绕**：左栏 `float:left`，右栏触发 BFC（如 `overflow:hidden`），则不与浮动重叠，自动占满剩余宽度。
4. **截断超长内容**：`overflow:hidden` 配合 BFC 裁剪子元素溢出。

```css
/* 经典两栏：左固定右自适应 */
.left  { float: left; width: 200px; }
.right { overflow: hidden; /* 触发 BFC，不伸到浮动下方 */ }
```

### 4. 响应式布局方案

| 方案 | 原理 | 示例/要点 |
| --- | --- | --- |
| 媒体查询 | 按断点切换样式 | `@media (max-width: 768px) { ... }` |
| Flex/Grid 弹性布局 | 内容自适应伸缩 | `grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))` |
| 百分比 + vw/vh | 相对视口宽度/高度 | 1vw = 视口宽度的 1% |
| rem | 相对根字号 | JS 设 `html{font-size}` = 视口宽/设计稿基准×基准字号 |
| clamp() | 流式 + 上下限 | `font-size: clamp(14px, 2vw, 20px)` |
| 容器查询 | 按父容器尺寸适配 | `@container (min-width: 400px)`（组件级响应式，加分项） |

```css
/* rem 方案核心：JS 动态设根字号（375 设计稿、基准 16px） */
function setRem() {
  const w = document.documentElement.clientWidth;
  document.documentElement.style.fontSize = (w / 375) * 16 + 'px';
}
setRem();
window.addEventListener('resize', setRem);
```

```css
/* vw 方案：免 JS，直接用视口单位换算 */
/* 设计稿 375px 宽，元素 75px → 75/375×100 = 20vw */
.box { width: 20vw; }
```

## 面试答法

### 30 秒版本（可直接背诵）

> 浮动元素脱离文档流，导致父容器高度塌陷、后续内容被覆盖，清除浮动本质是让父容器重新包含浮动：首选 clearfix 伪元素加 clear:both，也可以给父容器设 overflow:hidden 或 display:flow-root 触发 BFC，现代项目直接改 flex。BFC 是独立的渲染区域，内部布局不影响外部，触发条件有 float、absolute/fixed、overflow 非 visible、display 为 flow-root/inline-block/flex/grid/table-cell、根元素等；应用是包含浮动、阻止 margin 合并、两栏自适应防环绕、裁剪溢出。响应式方案组合使用：媒体查询切断点、flex/grid 弹性排布、rem 或 vw 做尺寸适配，现代还可以用 clamp 和容器查询。

### 深入展开

1. **先画浮动塌陷示意图**，说明"清除"是清理影响而非取消浮动。
2. **BFC 定义 + 触发条件表**，主动纠正"宽高触发 BFC"的误区，体现理解深度。
3. **margin 合并 ASCII 图**：相邻兄弟、父子穿透两种合并场景。
4. **两栏布局代码**：float + overflow:hidden 的 BFC 应用是高频手写点。
5. **响应式按维度讲**：断点维度（媒体查询）、布局维度（flex/grid）、尺寸维度（rem/vw/clamp）、组件维度（容器查询）。

### 常见追问

- **display:flow-root 和 overflow:hidden 清除浮动有何区别？** → 都触发 BFC；flow-root 专为创建 BFC 设计、无裁剪副作用，overflow:hidden 会裁掉溢出内容（下拉菜单、阴影）。
- **为什么 float 元素自己也是 BFC？** → 浮动需要独立布局上下文以环绕文本，规范规定 float 创建 BFC。
- **margin 合并只发生在什么方向？** → 垂直方向；且 `display:inline-block` 不合并（这是它和 BFC 隔离的相似效果）。
- **rem 和 em 区别？** → em 相对**父元素**字号，rem 始终相对**根元素**字号，嵌套时 rem 更可控。
- **移动端 1px 边框、安全区适配怎么处理？** → 1px 用 transform:scale 或 vw；安全区用 `env(safe-area-inset-bottom)`（展示实战经验）。
- **媒体查询断点怎么定？** → 不背固定值，按内容断点（content-driven breakpoints）：在样式开始"破"的宽度加断点。
