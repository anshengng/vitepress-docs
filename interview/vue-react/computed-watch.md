# computed 与 watch 的区别与原理

## 题目

> computed 和 watch 有什么区别？分别在什么场景用？computed 的缓存原理是什么？watch 的 deep、immediate 是干什么的？React 里对应的 useMemo/useEffect 你怎么理解？

## 为什么需要区分

生活化例子：你有一间屋子（响应式数据），两件事可以你做——

```
computed ≈ 电费账单：每次查"本月电费"，只要用电度数没变，账单不用重算，直接翻上次结果
watch    ≈ 门口监控：门铃一响（数据变了）就触发一个动作（发消息、调接口），它不产出新值，只做事
```

- 需要一个**由其他数据推导出来的值** → computed（如：购物车总价 = Σ 单价×数量）
- 数据变了要**执行副作用**（请求接口、操作 DOM、打日志）→ watch（如：搜索关键词变了去发请求）

一句话：**computed 是"算出一个值"，watch 是"看到变化做事"**。

## 核心要点

### 1. computed 缓存原理（Vue3 视角）

computed 内部就是一个带缓存的 effect，核心是**脏标记（dirty flag）**：

```
                 ┌─────────────────────────────┐
                 │  ComputedRefImpl (computed)  │
                 │  _value    缓存的上次结果      │
                 │  dirty     是否需要重算        │
                 │  effect    包裹 getter 的 effect│
                 └─────────────────────────────┘

依赖收集：getter 执行时读了哪些响应式属性，就订阅哪些属性
        price.ref.dep ──track──► computed.effect
        count.ref.dep ──track──► computed.effect

读取 computed.value 时：
        dirty === false ──────► 直接返回 _value（不执行 getter）✅ 缓存命中
        任一依赖变化 ──► effect 调度 ──► dirty = true
        此时再读 computed.value ──► 重新执行 getter ──► 更新 _value，dirty = false

时间线对比（3 次读取，中间只改了一次依赖）：

t1 读 fullName → getter 执行 1 次 → 缓存 "Zhang San"
t2 读 fullName → 依赖没变 → 直接返回缓存，getter 执行 0 次
t3 改 firstName → dirty=true
t4 读 fullName → getter 再执行 1 次 → 缓存新值

methods 版本同样 4 步 → getter 执行 4 次，每次都算
```

- Vue3 里 computed 默认**懒执行**：不读就永远不算（lazy）
- 依赖可以是普通 ref/reactive，也可以是**另一个 computed**，形成链式缓存
- React 对应物：`useMemo(() => a + ' ' + b, [a, b])` —— 手动声明依赖做缓存，语义近似但没有"依赖自动收集"这层魔法

### 2. lazy vs eager

| 特性 | computed（lazy） | watchEffect（eager） | watch |
| --- | --- | --- | --- |
| 首次是否执行 | 不读不执行 | 创建立即执行 | 默认不立即执行（除非 immediate） |
| 产出 | 一个缓存的值 | 无返回值，只有副作用 | 无返回值，只有副作用 |
| 缓存 | 有（dirty 标记） | 无 | 无 |
| 典型用途 | 派生数据 | 自动追踪依赖的副作用 | 显式监听指定源做反应 |

### 3. watch 的 deep / immediate 图解

```
watch(source, cb, { deep, immediate })

immediate: false（默认）          immediate: true
  t0 创建 watch → 不动作            t0 创建 watch → 立刻执行一次 cb(新值, 旧值=undefined)
  t1 数据变化  → cb 执行            t1 数据变化  → cb 执行
  用途：纯"变了才做事"               用途：初始化时也要跑一遍（如首屏拉数据）

deep: false（默认，浅监听）
  监听 obj = reactive({user:{name:'A'}})
  obj.user.name 变了 → ❌ cb 不触发（只比对 obj 这个引用本身）
deep: true
  obj.user.name 变了 → ✅ cb 触发（递归遍历所有嵌套属性建立依赖）

  代价示意：deep 要把整棵对象树 walk 一遍收集依赖
  obj ──► { user ──► { name, addr ──► { city... } }, list ──► [...] }
         每个叶子都 track，大对象开销明显 → 能监听精确属性就别开 deep
```

- Vue3 中监听 `reactive` 对象**自动深度**（隐式 deep）；监听 `ref` 包裹的对象才需要手动 `deep: true`
- 更优写法：`watch(() => obj.user.name, cb)` 用 getter 精确监听，免 deep 开销

### 4. watch 的 lazy/eager 对比 + 场景选择表

| 场景 | 选什么 | 原因 |
| --- | --- | --- |
| 总价、格式化姓名、过滤列表等派生值 | computed | 要返回值 + 要缓存 |
| 关键词变化 → 发搜索请求 | watch | 副作用，且能拿到新旧值 |
| 路由/props 变化 → 重置表单 | watch（immediate 视情况） | 需要"变化时做事" |
| 依赖关系不固定、自动跑副作用 | watchEffect | 自动收集依赖 |
| 异步操作（await 请求） | watch / watchEffect | computed 的 getter 不该是 async |

### 5. 常见坑

```
坑一：computed 里写副作用 ❌
  const total = computed(() => {
    sum += price.value   // 修改外部状态 / 发请求 / 打日志
    return sum
  })
  → 缓存命中时 getter 根本不执行，副作用"时灵时不灵"；
    副作用应放 watch/watchEffect

坑二：watch 监听对象引用，误以为能感知内部变化 ❌
  const obj = ref({ a: 1 })
  watch(obj, cb)                    // 浅监听：只有 obj.value 整体被替换才触发
  obj.value.a = 2                   // ❌ cb 不触发
  obj.value = { a: 2 }              // ✅ 触发
  → 内部变化要么 deep:true，要么 watch(() => obj.value.a, cb)

坑三：computed 依赖了非响应式数据 → 永远缓存旧值，改了也不重算

坑四：把 computed 当 watch 用（在 computed 里 if 判断后调接口）→ 语义错误 + 缓存导致漏调用
```

## 面试答法

### 30 秒版

> 一句话：computed 是带缓存的派生值，watch 是观察变化执行副作用。computed 内部是一个 effect，getter 执行时自动收集依赖，依赖没变时读它直接返回缓存的 _value，靠一个 dirty 脏标记控制要不要重算，所以多次读取只算一次；watch 不缓存也不返回值，它订阅指定的源，源变了就执行回调，还能拿到新旧值，deep 选项是递归遍历对象树收集所有嵌套依赖，immediate 是创建时先跑一次。选择原则：要"算出一个值"用 computed，要"变了去做事"比如发请求用 watch。React 里 useMemo 相当于手动声明依赖的 computed，useEffect 相当于 watch。

### 深入版（被追问时按这条线展开）

1. **先分职责**：computed 产出值、watch 执行副作用，用"电费账单 vs 门口监控"类比
2. **讲缓存原理**：computed = ComputedRefImpl + 内部 effect；依赖收集（track）→ 依赖变化触发 effect 调度 → 置 dirty → 下次读取才重算 getter；配合时间线说明"3 读 1 变只执行 2 次 getter"
3. **lazy vs eager**：computed 不读不算；watchEffect 创建即执行；watch 默认等变化，immediate 可首跑
4. **deep 的代价**：递归 walk 整棵对象树逐个 track，大对象开销大；推荐 getter 精确监听
5. **坑**：computed 里副作用（缓存命中不执行）、watch 浅监听对象引用不触发内部变化
6. **React 对照**：useMemo 手动依赖数组、无自动收集；useEffect 对应 watch 但每次渲染都可能重新执行，心智不同

### 常见追问

- **computed 和 methods 都能算总价，选哪个？** → 有缓存需求选 computed：依赖不变多次读取只算一次；methods 每次调用都执行
- **watch 和 watchEffect 区别？** → watch 显式指定源、能拿新旧值、懒执行；watchEffect 自动收集回调里用到的依赖、立即执行、拿不到旧值
- **computed 的缓存什么时候失效？** → 任一被 track 的依赖变化，effect 调度把 dirty 置 true，下次读取重算
- **监听 reactive 对象为什么不用写 deep？** → Vue3 对 reactive 源隐式开启深度；ref 包对象才要手动 deep
- **React 的 useMemo 能完全替代 computed 吗？** → 不能：useMemo 要手写依赖数组且官方明确它只是性能优化、可能失效重算，语义上 computed 是"保证缓存的派生值"
