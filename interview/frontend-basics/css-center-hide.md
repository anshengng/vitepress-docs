# CSS 居中的方式、CSS 隐藏元素

## 为什么需要

- **居中**是面试出镜率最高的 CSS 基础题，考点不是"背八种写法"，而是能否根据**子元素尺寸是否已知、能否改父容器、兼容要求**选择合适的方案，并说清每种方案背后的定位/格式化上下文原理。
- **隐藏**考察对"布局、事件、无障碍、SEO"四个维度的理解。实际项目中选错隐藏方式会直接产生 bug：`opacity:0` 的"隐形按钮"仍能点击、`display:none` 切换导致布局跳动、`clip` 用法不当让屏幕阅读器读错内容。

## 核心要点

### 1. 居中方案决策树（ASCII）

```
要居中什么？
 ├─ 行内内容（文字/图标）
 │    ├─ 水平 ──► text-align: center
 │    └─ 垂直（单行）──► line-height = 容器高度
 ├─ 块级元素水平居中 ──► margin: 0 auto（需已知宽度）
 └─ 水平 + 垂直同时居中
      ├─ 能改父容器 ─────────────► flex（首选）/ grid（最短）
      ├─ 只能动子元素、尺寸未知 ──► absolute + translate(-50%,-50%)
      ├─ 尺寸已知、不想用 transform ► absolute + inset:0 + margin:auto
      ├─ 尺寸已知、老兼容(IE8) ────► absolute + 负 margin
      └─ 表格语义/老兼容 ─────────► display: table-cell + vertical-align
```

### 2. 各方案代码

**① Flex 居中（最常用）**

```css
.parent {
  display: flex;
  justify-content: center; /* 主轴（默认水平）居中 */
  align-items: center;     /* 交叉轴（默认垂直）居中 */
}
```

**② Grid 居中（一行搞定）**

```css
.parent {
  display: grid;
  place-items: center; /* place-items = align-items + justify-items 简写 */
}
```

**③ absolute + transform（子元素尺寸未知也可用）**

```css
.parent { position: relative; } /* 建立定位上下文 */
.child {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%); /* 偏移量基于自身宽高 */
}
```

**④ absolute + margin:auto（子元素需固定宽高）**

```css
.child {
  position: absolute;
  inset: 0;        /* 等价 top/right/bottom/left: 0，四边被拉伸 */
  margin: auto;    /* 四个 auto 外边距均分剩余空间 → 居中 */
  width: 200px;
  height: 100px;
}
```

**⑤ absolute + 负 margin（需已知宽高，老项目兼容）**

```css
.child {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 200px;
  height: 100px;
  margin: -50px 0 0 -100px; /* 上/左各回拉自身高度/宽度的一半 */
}
```

**⑥ table-cell（垂直居中老方案）**

```css
.parent {
  display: table-cell;
  text-align: center;     /* 水平 */
  vertical-align: middle; /* 垂直，仅对表格单元/行内块生效 */
}
```

**⑦ 伪元素撑高法（行内元素垂直居中的经典 trick）**

```css
.parent { text-align: center; }
.parent::after {
  content: '';
  display: inline-block;
  height: 100%;           /* 伪元素撑满容器高度 */
  vertical-align: middle; /* 作为基准线 */
}
.child {
  display: inline-block;
  vertical-align: middle; /* 与伪元素同基线 → 垂直居中 */
}
```

**⑧ 单行文本居中**

```css
.box {
  text-align: center;  /* 水平 */
  line-height: 200px;  /* 行高 = 容器高度，仅适用单行文本 */
}
```

### 3. 居中方案对比表

| 方案 | 子元素需已知尺寸 | 需改父容器 | 兼容性 | 典型场景 |
| --- | --- | --- | --- | --- |
| flex | 否 | 是 | 现代浏览器 | 通用首选，弹窗/卡片 |
| grid place-items | 否 | 是 | 现代浏览器 | 代码最短，新项目 |
| absolute + transform | 否 | 父需 relative | IE9+ | 浮层/下拉，尺寸未知 |
| absolute + inset + margin auto | **是** | 父需 relative | IE8+ | 尺寸固定的弹窗 |
| absolute + 负 margin | **是** | 父需 relative | 全兼容 | 老项目兜底 |
| table-cell | 否 | 是 | 全兼容 | 老式垂直居中 |
| line-height | 否 | 否 | 全兼容 | 单行文字/图标按钮 |

### 4. 隐藏元素的方式与四维影响对比

| 方式 | 占布局空间 | 响应鼠标事件 | 可被 Tab 聚焦 | 屏幕阅读器可读（无障碍） | 典型用途 |
| --- | --- | --- | --- | --- | --- |
| `display: none` | ❌ 不占 | ❌ | ❌ | ❌ 移出无障碍树 | 彻底隐藏、v-show |
| `visibility: hidden` | ✅ 占位 | ❌ | ❌ | ❌ | 占位隐藏，子元素可设 visible 恢复 |
| `opacity: 0` | ✅ 占位 | ✅ **仍可点击** | ✅ | ✅ 仍可读 | 淡入淡出过渡 |
| `clip / clip-path: inset(50%)` | ✅ 占位 | ❌（不可见区域不命中） | ✅ | ✅ | sr-only 视觉隐藏 |
| 移出视口（`left: -9999px` / `translateX(-200%)`） | absolute 不占流；transform 仍占 | ❌（在屏外） | ✅（Tab 会跳走） | ✅ | 老式 sr-only、抽屉动画 |
| `width:0; height:0; overflow:hidden` | ❌ 不占 | ❌ | 视浏览器而定 | ✅ 内容仍在树中 | 折叠内容 |
| `hidden` 属性 | ❌ 不占 | ❌ | ❌ | ❌ | 语义化隐藏（等价 display:none） |
| `aria-hidden="true"` | ✅ 照常显示 | ✅ | ✅ | ❌ 仅对读屏隐藏 | 装饰性图标 |
| `pointer-events: none` | ✅ 占位可见 | ❌ 仅禁事件 | ✅ | ✅ | 禁用交互而非隐藏 |

**SEO 说明**：搜索引擎会抓取并索引隐藏文本，但 `display:none` 的大段内容可能被降权（历史上被用于"隐藏关键词"作弊，过度使用有被判 cloaking 的风险）；`alt`、`aria-*` 提供的替代信息反而有利于 SEO 与无障碍。

### 5. 手写 sr-only（视觉隐藏但读屏可读）

```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);  /* 老写法兼容 */
  clip-path: inset(50%);   /* 新写法 */
  white-space: nowrap;     /* 防止文本换行溢出 1px 盒子 */
  border: 0;
}
```

## 面试答法

### 30 秒版本（可直接背诵）

> 居中分场景：行内文字用 text-align 加 line-height；块级水平居中用 margin auto；水平垂直都居中首选父容器 flex（justify-content + align-items）或 grid（place-items: center）；不能动父容器时用 absolute + top/left 50% + translate(-50%,-50%)，尺寸已知还可以用 inset:0 + margin:auto 或负 margin。隐藏元素要按影响选：display:none 不占空间、无事件、读屏不可见；visibility:hidden 占空间但无事件；opacity:0 占空间且**仍可点击、仍可被屏幕阅读器读到**，适合做过渡动画；要让内容对视觉隐藏但对无障碍可见，用 clip 或 clip-path 的 sr-only 方案。

### 深入展开

1. **先给决策树**：按"能否改父容器、尺寸是否已知、兼容性要求"三问收敛到方案，体现工程思维而非背诵。
2. **讲原理**：`translate(-50%,-50%)` 的百分比基于自身尺寸；`inset:0 + margin:auto` 是绝对定位元素四边拉伸后 auto 边距均分剩余空间。
3. **对比隐藏四维影响**：布局（是否占位）、事件（是否可点）、无障碍（是否在 accessibility tree）、SEO（是否被当作隐藏内容）。
4. **主动提 sr-only**：展示无障碍意识，是加分项；顺带说明 `opacity:0` 做隐藏的坑（隐形可点击区域、读屏仍朗读）。
5. **联系框架**：Vue `v-show` 本质是 `display:none`，`v-if` 是销毁 DOM——与隐藏方式的取舍一脉相承。

### 常见追问

- **opacity:0 和 display:none 都能点吗？** → 都不能算"安全隐藏"：display:none 彻底不可交互；opacity:0 仍占位、仍可点击、仍可聚焦，只是看不见，用它"隐藏"会留下透明可点区域。
- **visibility:hidden 的子元素能显示吗？** → 能，子元素设 `visibility: visible` 可覆盖，因为该属性可继承。
- **为什么不用 top:50% 不配 transform？** → top:50% 只把元素**顶边**放到中线，还需回拉自身一半高度，尺寸未知时只能用 transform 或 margin auto。
- **flex 居中对子元素有什么副作用？** → 子元素变成 flex item，块级/行内特性被规整（如 margin 垂直不合并），嵌套布局时注意上下文变化。
- **隐藏内容还能被搜索到吗？** → 能，爬虫抓取的是 HTML 源码；但 display:none 大段文本可能被降权，纯装饰内容建议 aria-hidden 或直接删除。
