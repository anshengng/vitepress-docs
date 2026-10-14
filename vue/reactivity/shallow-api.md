# 浅层响应式与性能优化 API

## 为什么需要浅层 API

Vue3 的懒代理消掉了"初始化全量递归"的账单，但渲染时只要访问到的子对象依然会建 Proxy、逐属性收集依赖。对万条列表、超大 JSON、第三方类实例这类数据，深层代理纯属浪费：要么整体替换就够用，要么根本不该进响应式系统。浅层 API 与 toRaw/markRaw 就是为这些场景准备的。

## shallowRef：只追踪 .value 替换

### 与 ref 的代码对比

```typescript
// ref：.value 是对象时深度代理
const deep = ref({ a: { b: 1 } })
deep.value.a.b = 2            // 触发更新：a、b 全在代理里
deep.value = { a: { b: 2 } }  // 触发更新：整体替换

// shallowRef：只有 .value 的替换被追踪
const shallow = shallowRef({ a: { b: 1 } })
shallow.value.a.b = 2            // 不触发：内部是普通对象
shallow.value = { a: { b: 2 } }  // 触发：.value 本身被替换
```

### 实现差别（源码简化）

```typescript
// ref 的 setter（简化）：新值会经过 toReactive 深度包装
class RefImpl {
  set value(newVal) {
    if (hasChanged(newVal, this._rawValue)) {
      this._rawValue = newVal
      this._value = toReactive(newVal)   // 对象 → reactive()，深层代理
      triggerRefValue(this)
    }
  }
}

// shallowRef：构造与赋值时原样保存，不做 toReactive
// _value = value（原始对象直接躺在里面）
```

### 大列表场景

```typescript
// 万条数据的表格
const rows = shallowRef<Row[]>([])

const { data } = await fetchRows()
rows.value = data          // 整体替换：一次 trigger，组件重渲染一次

// 修改内部不会触发：
rows.value[0].done = true   // 不触发（内部无代理）
triggerRef(rows)           // 需要更新时手动强制触发
```

若用 ref：首次渲染逐条访问 rows 的每条 item，等于为 1 万条数据建 1 万个 Proxy，每个属性 get 都要走一遍 track。列表只做整体展示、整体刷新时，这些开销全部白费。

## shallowReactive：只有根级属性响应式

```typescript
const state = shallowReactive({ user: { name: 'a' }, count: 0 })

state.count++          // 触发：根级属性在拦截器里
state.user = { name: 'b' }   // 触发：根级属性（替换 user）
state.user.name = 'c'  // 不触发：user 是普通对象，get 返回值不再递归 reactive()
```

与 shallowRef 的差别：shallowReactive 的根级属性读写仍有 track/trigger（对第一层"精确定点"），shallowRef 只认 .value 这一次替换。

## triggerRef：手动强制触发

```typescript
const list = shallowRef([1, 2, 3])

list.value.push(4)   // 改内部数组：.value 引用没变 → 不触发
triggerRef(list)     // 手动触发：强制通知依赖 list 的 effect 更新
```

适用：数据来自 shallowRef，但某些修改是对内部结构的局部操作（push、splice、字段修改），改完后调用一次 triggerRef 补通知。

## toRaw：拿到代理背后的原始对象

```typescript
import { reactive, ref, toRaw } from 'vue'

const state = reactive({ name: 'a' })
toRaw(state)                 // 得到 { name: 'a' } 本尊（非代理）

const rows = ref<Row[]>([])
toRaw(rows.value)            // 剥掉代理层
```

原理：代理对象上带 `__v_raw` 标记，toRaw 不断解套直到拿到非代理对象。

三类典型场景：

```typescript
// 1. 第三方库持有数据：库内部会遍历/修改对象，
//    传入代理既拖慢，也可能因库内部改属性引发意外副作用
chart.setOption(toRaw(option))
mapInstance.setData(toRaw(overlays))

// 2. console.log 想看原始数据，而不是 Proxy 一层壳
console.log(toRaw(rows.value))

// 3. 作为 Map key 或做严格相等比较：proxy !== 原对象，跨边界比对会失败
```

## markRaw：标记对象永不代理

```typescript
import { markRaw, reactive } from 'vue'

const state = reactive({
  routes: markRaw([...]),          // 路由表：静态数据，永不需要响应式
  chart: markRaw(new ECharts()),   // 第三方类实例
})
// reactive() 创建代理前检查 __v_skip 标记，命中直接返回原对象
```

与 toRaw 的分工：markRaw 在对象"进入响应式系统之前"拦截，toRaw 把"已经在系统里"的代理取出来。第三方实例（echarts、地图、编辑器）一旦被代理，库内部每次读属性都会触发 get 拦截与依赖查询，既浪费也容易出错。

## ref 深层代理 vs shallowRef 性能对比示意

```
ref 深层（10,000 条数据的首次渲染）：
  rows.value ─→ track('value')（1 次）
  渲染函数逐条访问 item：
    └→ 每条 item 首次被 get ─→ new Proxy()（× 10,000）
    └→ 每个属性 get ─→ track：查 targetMap、入 Set（× 属性数 × 10,000）
  收益：修改任一条 item 的任一属性可精确触发依赖（细粒度）

shallowRef：
  rows.value = newRows ─→ 引用比较（1 次）+ triggerRefValue（1 次）+ 重渲染（1 次）
  代价：内部修改不感知，需 triggerRef 或整体替换
```

## 场景总结

| API | 行为 | 典型场景 |
|---|---|---|
| shallowRef | 只追踪 .value 替换 | 大列表整体替换、大 JSON、图表数据集 |
| shallowReactive | 根级属性响应式，子层不代理 | 第一层简单、子结构静态的表单 |
| triggerRef | 强制触发 shallowRef 依赖 | 直接改内部数据后手动补通知 |
| toRaw | 解出代理背后的原始对象 | 第三方库入参、打印原始数据、相等比较 |
| markRaw | 对象永不代理 | 路由表、类实例、大常量配置 |

选型口径：数据是"换"出来的用 shallowRef，数据是"改"出来且需要响应的用 ref 或 reactive；确定不参与响应式的对象，进系统前 markRaw，已经在系统里要交出去就 toRaw。

## 面试答法

浅层 API 的定位是性能优化：shallowRef 只追踪 .value 本身的替换，内部对象不做代理，适合万条级大列表整体替换的场景，避免首次渲染为每条记录建 Proxy、逐属性收集依赖；shallowReactive 保留根级属性的 track/trigger，子对象保持原始。直接修改 shallowRef 内部数据不会触发更新，需要手动调用 triggerRef 强制通知，这是 shallowRef 的使用代价。toRaw 和 markRaw 处理"边界对象"：markRaw 在对象进入响应式系统前打 `__v_skip` 标记使其永不代理，适合路由表、echarts 这类第三方实例；toRaw 把已代理的对象解包出原始对象，常用于给第三方库传参、打印真实数据或做严格相等比较。整体思路是：响应式既是能力也是成本，只给真正需要更新的数据买单。
