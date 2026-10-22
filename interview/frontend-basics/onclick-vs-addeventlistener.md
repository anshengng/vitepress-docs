# onclick 和 addEventListener 的区别

## 为什么需要

这是事件体系的第一道题：表面比两个 API，实际考察是否理解**事件绑定的本质**（属性赋值 vs 监听器列表）、**事件流三阶段**、以及**解绑/复用**的工程细节。框架的 `@click`、`onClick` 底层都落在 addEventListener 上，理解差异才能理解封装。

## 核心要点

### 1. 两种写法（面经基础用法）

```html
<button id="btn">Click me</button>
<script>
  const btn = document.getElementById('btn')
  // 方式 A：onclick 属性（DOM property，也可写在 HTML 标签里）
  btn.onclick = function () { console.log('A') }
  // 方式 B：addEventListener（DOM 方法）
  btn.addEventListener('click', function () { console.log('B') })
</script>
```

注意 onclick 有两种存在形态：**HTML 内联属性** `onclick="..."` 与 **JS 的 DOM property** `el.onclick = fn`，二者互相覆盖（本质是同一个事件处理程序槽位）；addEventListener 走的是另一套**监听器列表**，互不覆盖。

### 2. 五大核心区别（面经逐条展开）

**① 多个处理程序：覆盖 vs 共存**

```js
btn.onclick = fn1
btn.onclick = fn2   // fn1 被顶掉，只有 fn2 生效（属性赋值语义）

btn.addEventListener('click', fn1)
btn.addEventListener('click', fn2) // 两个都执行，按注册顺序
```

**② 移除方式**

```js
btn.onclick = null                        // 置空即可
btn.removeEventListener('click', fn1)     // 必须传入同一函数引用
// 坑：匿名函数无法 remove（每次执行都是新引用）
btn.addEventListener('click', () => {})    // ❌ 删不掉
const handler = () => {}                   // ✅ 保存引用才能删
btn.removeEventListener('click', handler)
```

**③ 事件流阶段：冒泡 vs 捕获可选**

```js
btn.onclick = fn                       // 只能冒泡阶段
btn.addEventListener('click', fn, true) // 第三参数：捕获阶段触发
btn.addEventListener('click', fn, { once: true, passive: true }) // 选项对象
```

**④ this 指向**：两者普通函数里 `this` 都指向**绑定监听器的元素**（currentTarget）；箭头函数下 this 变成定义时外层作用域——这不是二者差异，而是函数类型差异。

**⑤ 事件名格式**：onclick 用 `on` 前缀属性名；addEventListener 用**不带 on 的事件类型字符串**（`'click'` 而非 `'onclick'`）。

### 3. 对比表（核心交付物）

| 维度 | onclick（属性） | addEventListener |
| --- | --- | --- |
| 绑定本质 | 给属性赋值 | 往监听器列表 push |
| 同事件多处理程序 | ❌ 后者覆盖前者 | ✅ 全部按序执行 |
| 移除 | 置 `null` | `removeEventListener`（需同一引用+同 capture 选项） |
| 捕获阶段 | ❌ 仅冒泡 | ✅ 第三参数 true/options |
| once/passive 选项 | ❌ | ✅ |
| HTML 内联 | ✅ `onclick="..."` | ❌ 只能 JS |
| 事件名 | `onclick` | `'click'` |
| 老 IE（≤8） | 部分支持 | 不支持，用 `attachEvent` |
| 默认 preventDefault 控制 | 返回 `false` 可阻止默认（内联） | 显式 `e.preventDefault()` |

### 4. 执行顺序综合示例

```js
const box = document.getElementById('box')
box.addEventListener('click', () => console.log('1 捕获'), true)
box.onclick = () => console.log('2 onclick')
box.addEventListener('click', () => console.log('3 冒泡'))
// 点击 box：1 捕获 → 2 onclick → 3 冒泡
// 同元素上 onclick 与 addEventListener 冒泡监听按"注册先后"排，
// onclick 先注册就先跑；捕获监听永远先于冒泡监听。
```

## 面试答法

### 30 秒版本（可直接背诵）

> onclick 是给 DOM 属性赋值，同一个事件只能挂一个处理函数，后绑覆盖先绑，移除置 null 即可，只支持冒泡阶段；addEventListener 是往监听器列表添加，同一事件可以绑多个、按注册顺序全部执行，用 removeEventListener 移除且必须传同一函数引用，第三个参数支持捕获、once、passive 等选项。两者 this 都指向绑定元素，事件名一个带 on 一个不带。老 IE 里对应的是 attachEvent。现代开发一律推荐 addEventListener，onclick 只在简单场景或内联属性里见。

### 深入展开

1. **先讲本质**：属性赋值 vs 监听器列表——所有差异（覆盖/共存/移除）都由此推出。
2. **逐条过五大区别**：多处理程序、移除、捕获、this、事件名。
3. **讲 remove 的坑**：匿名函数删不掉、capture 选项要一致。
4. **讲执行顺序示例**：捕获 → onclick/冒泡按注册序。
5. **延伸**：内联 onclick 返回 false 阻止默认；框架封装（Vue `@click`、React 合成事件委托到 root）底层都是 addEventListener。

### 常见追问

- **removeEventListener 为什么有时删不掉？** → 三个条件任一不满足：函数引用不同（匿名/新 bind/新箭头）、capture 标志不一致、事件类型不一致。
- **箭头函数当监听器 this 指向谁？** → 指向定义时外层作用域而非元素，需要元素用 `e.currentTarget`。
- **onclick 和 addEventListener 谁先执行？** → 同阶段按注册先后混排；onclick 本质是冒泡阶段监听器。
- **passive 是干什么的？** → 承诺不调 preventDefault，让浏览器在 touch/wheel 时立即滚动不等 JS，优化滚动流畅度。
- **老 IE 的 attachEvent 差异？** → 事件名带 on（'onclick'）、只能冒泡、this 指向 window、可叠加多个监听；现代已无需关心。
- **内联 onclick="return false" 有什么用？** → 属性型处理器返回 false 等价 preventDefault，可阻止链接跳转/表单提交。
