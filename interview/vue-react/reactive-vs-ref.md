# reactive 与 ref 的区别

## 题目

> Vue3 中 reactive 和 ref 有什么区别？为什么 ref 要加 .value？什么情况下响应式会"丢失"？平时该用哪个？

## 为什么需要

生活化例子：

- **Proxy**（reactive 的核心）是个"门卫"，只能站在**对象**门口，登记每个属性的进出（get/set）。
- 但 number/string 这些**基本类型**没有"门"——值本身就是一切，没法安门卫。
- ref 的办法：把值塞进一个带门卫的盒子，读/写必须走 `.value` 这个门 → 门卫就能登记了。

## 核心要点

### 一、reactive：基于 Proxy 的拦截

```javascript
function reactive(target) {
  return new Proxy(target, {
    get(target, key) {
      track(target, key)              // 读属性：登记"谁在用我"
      return Reflect.get(target, key)
    },
    set(target, key, value) {
      const res = Reflect.set(target, key, value)
      trigger(target, key)             // 写属性：通知"用我的人"更新
      return res
    }
  })
}
```

```
组件读取 state.count ──► Proxy get 拦截 ──► track：把（属性, 副作用）记入依赖表
用户修改 state.count ──► Proxy set 拦截 ──► trigger：查依赖表 → 重新执行副作用 → 视图更新
```

把这条静态链路放到时间线上逐步推演，"读的时候收集、写的时候触发"这一来一回就看得很清楚了（ref 场景只是换成读写 count.value，机制完全相同）：

```
依赖表结构：1 个属性 1 个 Set —— state ──'count'──► Set { effect }

步骤     发生了什么                                   count 的 dep 集合         结果
────────────────────────────────────────────────────────────────
① 读     组件首次渲染：渲染函数读 state.count          （空集合）              命中 Proxy 的 get 拦截
         get 调用 track(target,'count')               ↓ 边读边登记            track 开始干活
         把当前正在跑的渲染 effect 放进                  state.count ──► Set { renderEffect }  依赖登记 ✅
         count 自己的依赖集合（1 属性 1 个 Set）                                  count 和页面"绑定"
────────────────────────────────────────────────────────────────
② 写     用户点击按钮：执行 state.count = 2（ref 则是 count.value=2）  Set { renderEffect }     命中 Proxy 的 set 拦截
         set 先经 Reflect.set 写入新值                  （集合不变）             count: 1 → 2
         再调用 trigger(target,'count')                 （集合不变）             开始派发更新
────────────────────────────────────────────────────────────────
③ 触发   trigger 从集合里取出 renderEffect 重新执行      Set ──► 取出 effect      渲染函数重跑
         渲染函数重新读 state.count 新值、顺手再收集      （重新登记满）           依赖自动修复
         渲染完成，页面从 1 刷新为 2                     Set 保持不变            ✅ 一轮闭环
```

这就是 reactive 能自动更新的全部秘密——读写都被拦下来记账。

### 二、ref：为什么需要 .value

```
ref 的内部结构（示意）：
{
  _value: 10,
  get value() { track(...); return this._value },   // 读 .value → 登记依赖
  set value(v) { this._value = v; trigger(...) }    // 写 .value → 触发更新
}
```

```
reactive(0)  ❌ 实现不了 —— Proxy 只能代理对象，0 是原始值，没有属性访问可拦截
ref(10)     ✅ 变通 —— 把值挂到盒子的 value 属性上，用 getter/setter 拦截读写

count.value + 1  →  get value → track + 返回旧值
count.value = 2  →  set value → trigger 通知更新
```

### 三、ref 传对象：内部自动调 reactive

```javascript
const r1 = ref({ name: 'vue' })
const r2 = reactive({ name: 'vue' })
// r1.value 内部就是 reactive 包装过的对象，等价关系：
// ref(对象).value ≈ reactive(对象) → 改 r1.value.name 同样触发更新
```

```
ref(基本类型) → 只包一层 getter/setter（浅层就够）
ref(对象)     → 盒子 value 里的对象再套 reactive（Proxy，默认深层响应）
```

### 四、两者对比表

| 对比项 | reactive | ref |
| --- | --- | --- |
| 支持类型 | 仅对象/数组/Map/Set | 任意（基本类型也行） |
| 实现方式 | Proxy 深层代理 | RefImpl 的 get/set 包住 value |
| 访问方式 | 直接 state.count | JS 中 .value，模板顶层自动解包 |
| 解构 | ❌ 丢响应（需 toRefs） | 引用本身不丢（基本类型） |
| 整体替换 | ❌ state = 新对象 会断开代理 | ✅ .value = 新对象 依然响应 |
| 深层响应 | 默认深（shallowReactive 可关） | 对象值内部转 reactive，默认深 |

### 五、响应式丢失场景（高频坑）

```javascript
const state = reactive({ name: 'vue', version: 3 })

const { name } = state   // ❌ 解构那一刻就"拍平"：name 只是当时的字符串快照
                         // 之后 state.name 变了，name 不会跟着变

const copy = { ...state } // ❌ 展开同理：拿到的是一份普通值的快照

// props 解构同理：const { title } = props 会丢响应
// （Vue 3.5+ 编译器能自动补上 ref，老版本不行，习惯上仍建议少解构）

const nameRef = toRefs(state) // ✅ 修复：把每个属性转成 ref，仍指向源对象属性
```

```
reactive 对象 ──直接解构──► 拿到"当时的值"（快照）──源变了──► 不更新 ❌
             └──toRefs───► 拿到"属性的引用"（ref）──源变了──► 同步更新 ✅
```

### 六、为什么推荐以 ref 为主

1. **风格统一**：基本类型只能用 ref，全部用 ref 心智一致，不用来回切换
2. **可整体替换**：`.value = 新对象` 仍是响应式；reactive 变量整体赋值会断开代理
3. **不易丢响应**：ref 传来传去仍是 ref（引用不变）；reactive 一解构只剩快照

### 七、.value 与自动解包规则

| 场景 | 要不要 .value |
| --- | --- |
| JS 里读 ref | 要（count.value） |
| setup 返回的顶层 ref，模板中使用 | 不要（自动解包） |
| 嵌进 reactive 对象里的 ref（obj.a） | 不要（访问时解包） |
| 数组 / Map / Set 元素里的 ref | 要（不会自动解包） |
| reactive 的数组/Map/Set | 直接用（state.list.push、state.map.set） |

setup 返回值自动解包一层的原因：返回的对象会被包一层 proxyRefs——读取属性时若发现是 ref，自动帮你取 .value，所以模板里写顶层 ref 不用带 .value。

## 面试答法

### 30 秒版

reactive 是用 Proxy 拦截对象的 get 和 set：get 时 track 收集依赖，set 时 trigger 派发更新，只支持对象类型。ref 是把值包装到 value 属性上、通过 getter/setter 拦截读写，所以 JS 里访问要加 .value，但它任意类型都能用；传对象进去时内部会自动调 reactive。最常见的坑是 reactive 解构或展开后丢响应，要用 toRefs 包一下。官方推荐以 ref 为主：基本类型只能用它、风格统一、还能整体替换 .value 不丢响应；模板里顶层的 ref 会自动解包，不用写 .value。

### 深入版

1. **先讲 reactive 原理**：Proxy 拦截 → track/trigger 配合依赖表 → 画访问链路图
2. **引出 ref 的必要性**：Proxy 代理不了原始值 → 用对象包一层 → .value 就是那扇"门"
3. **讲 ref 内部结构**：getter/setter；对象值内部再转 reactive，两者打通
4. **对比表过一遍**：类型支持 / 深浅 / 解构 / 整体替换
5. **坑**：解构/展开丢响应（props 同理），toRefs/toRef 修复，画"快照 vs 引用"图
6. **收尾**：为什么推荐 ref + setup 顶层自动解包的原理（proxyRefs）

### 常见追问

- **reactive 变量整体赋值为什么丢响应？** → state = 新对象 只是让变量名指向新普通对象，原 Proxy 不再被引用；要么逐属性改，要么用 ref 整体替换 .value
- **toRefs 和 toRef 的区别？** → toRefs 批量把对象全部属性转成 ref；toRef 只转一个，属性不存在也能安全访问
- **模板里为什么不用写 .value？** → setup 顶层 ref 经 proxyRefs 自动解包；嵌套在普通对象/数组里的 ref 不会解包
- **shallowRef 什么时候用？** → 大列表、图表实例等只关心整体替换（.value = xx）、不关心内部属性变更时，省深层代理开销
- **ref 和 reactive 能混用吗？** → 能：reactive 对象里放 ref 会自动解包一层；但数组、Map、Set 元素里的 ref 不解包，访问要 .value
