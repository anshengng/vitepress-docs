# 浅拷贝与深拷贝

## 题目

> 浅拷贝和深拷贝的区别是什么？JSON.parse(JSON.stringify()) 做深拷贝有什么问题？能手写一个深拷贝吗？循环引用怎么处理？

## 为什么需要

引用类型变量存的不是内容本身，而是**堆上内容的地址**。直接赋值只复制地址——两个人拿着同一把钥匙开了同一间房，谁都能改里面的东西。

```
const b = a          （赋值 = 只复制指针）

栈                          堆
┌─────────────┐        ┌──────────────────┐
│ a: 0x001 ────┼──────► │ { name: 'a',     │
│ b: 0x001 ────┼──────► │   inner: {x: 1} }│  ← 同一块内存
└─────────────┘        └──────────────────┘

b.name = 'b'  →  a.name 也变 'b'（同一间房，谁改都算数）
```

浅拷贝是"抄了个新对象，但**房里的钥匙还是旧的**"（第一层独立，嵌套层仍共享）；深拷贝是"整栋楼原样再造一栋，钥匙全套新的"。

## 核心要点

### 一、赋值 / 浅拷贝 / 深拷贝，一图分清

```
原始数据：a = { name: 'a', inner: { x: 1 } }

① 赋值  b = a
   b.name ──┐
   b.inner ─┴──► 完全指向 a（第一层都共享）
   改 b.name、b.inner.x → a 全跟着变 ❌

② 浅拷贝 c = { ...a }
   c.name = 'c'     → a.name 不变 ✅（第一层独立）
   c.inner ───────► a 的 inner（嵌套层仍共享）
   改 c.inner.x     → a.inner.x 跟着变 ❌

③ 深拷贝 d = deepClone(a)
   整棵树全新复制，改什么都不影响 a ✅
```

### 二、浅拷贝的三种写法（都只拷第一层）

| 写法 | 代码 | 备注 |
| --- | --- | --- |
| 展开运算符 | `{ ...obj }` / `[...arr]` | 最常用 |
| Object.assign | `Object.assign({}, obj)` | 第一个参数是目标对象 |
| 数组 slice | `arr.slice()` | 同类：concat / Array.from |

共享内层引用的对比图：

```
const c = { ...a }

     c（新对象）
     ├─ name: 'a'     基本类型，值复制，独立 ✅
     └─ inner ───┐
                 ├──► 堆上 { x: 1 }  ◄──── a.inner
c.inner.x = 99   →  a.inner.x 也变 99 ❌

结论：浅拷贝只解决"第一层赋值污染"，嵌套对象照样一改俱改
```

### 三、JSON.parse(JSON.stringify()) 的四个坑

```
原始对象                        JSON 往返之后
──────────────────────────────────────────────────
{ a: undefined }         →    {}            坑1：undefined 属性直接丢失
{ fn: () => {} }         →    {}            坑2：函数丢失
{ d: new Date() }        →    { d: "2026-10-15T..." }
                                  坑3：Date 变普通字符串，getTime() 报错
const o = {}; o.self = o →    ❌ TypeError: Converting circular
                                  structure to JSON
                                  坑4：循环引用直接抛异常
```

| 坑 | 原因 | 后果 |
| --- | --- | --- |
| undefined 丢失 | JSON 规范里没有 undefined | 属性在序列化后消失 |
| 函数丢失 | JSON 只序列化可 JSON 化的数据 | 方法没了 |
| Date 变字符串 | JSON 只有 string/number/boolean/null/数组/对象 | 不再是 Date 实例，方法全废 |
| 循环引用报错 | 序列化时无限递归 | 直接抛 TypeError |
| （附赠）NaN/Infinity | 转成 null | 数值语义丢失 |

适用场景：**纯 JSON 形状的数据**（接口返回的没有函数、Date、环的对象）——图省事时能用。

### 四、手写深拷贝（递归 + WeakMap 解循环引用）

```js
function deepClone(source, map = new WeakMap()) {
  // 1. 基本类型和函数直接返回
  if (source === null || typeof source !== 'object') return source

  // 2. 特殊对象：按类型新建
  if (source instanceof Date) return new Date(source)
  if (source instanceof RegExp) return new RegExp(source)

  // 3. 循环引用：查档案——拷过就直接返回上次结果，斩断环
  if (map.has(source)) return map.get(source)

  // 4. new constructor()：数组克隆出数组、对象克隆出对象（还保留原型）
  const target = new source.constructor()

  // 5. 先登记再递归（顺序不能反！环还没拷完之前档案必须先在）
  map.set(source, target)

  // 6. 递归拷贝每一层（Reflect.ownKeys 连 Symbol 键一起拿）
  Reflect.ownKeys(source).forEach(key => {
    target[key] = deepClone(source[key], map)
  })
  return target
}
```

循环引用为什么用 WeakMap：

```
const o = {}; o.self = o        （对象里套自己）

没有 map：                        有 WeakMap 档案：
deepClone(o)                       map: { o → o' }
  └ deepClone(o)                   deepClone(o)
       └ deepClone(o)                └ 查档：o 拷过！
            └ … 无限递归 💥            返回 o'，环安全闭合 ✅
```

选 WeakMap 而非 Map：键是**弱引用**，拷完后 key 能被垃圾回收正常回收，不造成内存泄漏。

### 五、structuredClone：现代原生方案

```js
const copy = structuredClone(original)   // 浏览器 / Node 17+
```

| 对比项 | structuredClone | JSON 往返 | 手写递归 |
| --- | --- | --- | --- |
| 循环引用 | ✅ 支持 | ❌ 报错 | ✅（配 map） |
| Date/RegExp/Map/Set | ✅ 原样保留 | ❌ 变字符串/丢失 | 视实现 |
| 函数 | ❌ 直接报错 | ❌ 静默丢弃 | ✅ 可自定 |
| Symbol 键 | ❌ 丢弃 | ❌ 丢弃 | ✅ 可处理 |
| 类实例原型 | ❌ 丢失（变普通对象） | ❌ 丢失 | ✅ 可保留 |

局限一句话：**函数拷不了、原型链保不住**，遇到类实例或函数还是得手写。

## 面试答法

### 30 秒版（可背诵）

> 核心是引用类型存的是堆地址：赋值只复制地址，所以一改俱改；浅拷贝复制第一层，嵌套层还是共享的；深拷贝才完全独立。常见的 JSON.parse(JSON.stringify()) 有四个坑：undefined 和函数会丢、Date 变字符串、循环引用直接报错。手写深拷贝就是递归加 WeakMap：递归处理每一层，WeakMap 存"原对象到新对象"的映射解决循环引用，顺带处理 Date、RegExp 这些特殊类型，用 new constructor() 保留原型。现在浏览器还有 structuredClone 原生 API，支持循环引用和 Date，但函数和原型还是搞不定。实际项目里纯 JSON 数据我用 JSON 方案图快，有环或有特殊类型才手写。

### 深入版（被追问时按编号展开）

1. **先画内存图**：栈存地址、堆存内容，赋值 = 复制指针 → 引出"同一间房"问题
2. **三种层次**：赋值（全共享）→ 浅拷贝（一层独立）→ 深拷贝（全独立），配对比图
3. **JSON 四坑**：undefined / 函数 / Date / 循环引用，逐条说原因，补一句"只适合纯 JSON 数据"
4. **手写思路**（重点）：边界判断 → 特殊类型 → WeakMap 断环（强调"先 set 再递归"）→ new constructor() 保原型 → Reflect.ownKeys 连 Symbol 一起拷
5. **收尾**：structuredClone 能用但有函数限制，体现知识更新度

### 常见追问

- **为什么必须先 map.set 再递归？** → o.self = o 这种环，如果递归发生在 set 之前，再次进来时档案里还没有记录，照样无限递归
- **WeakMap 和 Map 选哪个？** → WeakMap，弱引用键不阻止垃圾回收，不会内存泄漏
- **类实例怎么拷才不丢原型？** → new source.constructor() 天然继承原型链；structuredClone 会把类实例降级成普通对象
- **数组和对象能一个函数搞定吗？** → 能，new constructor() 对 Array 生成新数组、对 Object 生成新对象，无需分支
