# React 性能优化：memo / useMemo / useCallback

## 题目

> React 的 memo、useMemo、useCallback 分别什么时候用？为什么 memo 常要配合 useCallback？什么时候不该用 memo？

## 为什么需要

React 默认渲染策略简单粗暴：**父组件渲染 → 所有子组件跟着渲染**，不管 props 变没变。

```
        <List/>   （父组件某处 setState）
           │ 触发整棵子树重渲染
   ┌───────┼────────┬──────────┐
   ▼       ▼        ▼          ▼
<Item/>  <Item/>   <Item/>   <Toolbar/>
  ↑       ↑        ↑          ↑
  └─── Toolbar 的 props 其实一个没变，照样白渲染

1000 行列表 + 一个输入框 → 每敲一个字，1000 个 Item 全部重跑 render → 卡死
```

三个 API 干的是同一件事：**跳过不必要的计算/渲染**，只是作用的层级不同。

## 核心要点

### 一、memo：拦截子组件的重渲染

原理：用 memo 包住组件后，父渲染时先**浅比较新旧 props**（逐个 `===`），全相同 → 直接复用上次的渲染结果，render 函数根本不执行。

```
没有 memo：
  父渲染 ──► 子 render 执行 ──► 新 VDOM ──► diff ──► DOM 无变化（白干）

memo(Component)：
  父渲染 ──► 浅比较 props
              ├─ 全没变 ──► 返回上次结果，跳过 render + diff ✅
              └─ 有变化 ──► 正常执行 render
```

```jsx
const Item = memo(function Item({ text }) {
  return <li>{text}</li>
})
```

### 二、为什么 memo 常配 useCallback（经典失效场景）

给 memo 子组件传**函数**时，普通函数每次渲染都产生**新的引用**，浅比较必然不等 → memo 白包了。

```
时间线（父组件两次渲染）：

第 1 次渲染
  父: const onClick = () => {...}      → 引用 0xAAA
  子(memo): props.onClick === 0xAAA ✅ 浅比较通过，跳过渲染

第 2 次渲染（父 state 变了，但与子无关）
  父: const onClick = () => {...}      → 引用 0xBBB
      （函数体一模一样也没用，地址是新的！）
  子(memo): 0xAAA === 0xBBB ❌ 浅比较失败
            → memo 失效，子组件照常重渲染 💸

  解法：const onClick = useCallback(() => {...}, [])
        deps 没变 → 两次都返回 0xAAA
        → 浅比较通过 → 成功跳过子组件渲染 ✅
```

```jsx
function Parent() {
  const [count, setCount] = useState(0)
  // useCallback 锁住引用：count 再怎么变，handleClick 地址不变
  const handleClick = useCallback(() => console.log('hi'), [])
  return (
    <>
      <button onClick={() => setCount(count + 1)}>{count}</button>
      <Child onClick={handleClick} />   {/* Child 是 memo 组件 */}
    </>
  )
}
```

同理：传**对象/数组字面量**（style 传内联对象、`list={[1,2]}`）也是每次新引用，要用 useMemo 包住。

### 三、三者对比表

| | 包什么 | 返回什么 | 用在哪 |
| --- | --- | --- | --- |
| memo | 组件 | 带拦截能力的同一组件 | 子组件"渲染昂贵且 props 不常变" |
| useMemo | 计算表达式 | 缓存的**值** | 昂贵计算；稳定引用（传给 memo 子组件的对象/数组） |
| useCallback | 函数 | 缓存的**函数引用** | 传给 memo 子组件；子组件 effect 的依赖函数 |

记法：**useCallback(fn, deps) ≈ useMemo(() => fn, deps)**，前者专管函数。memo 挡"子组件白渲染"，两个 Hooks 挡"引用老变导致 memo 失效"。

三者协作全链路：

```
父渲染
  ├─ useMemo：deps 变才重算 ────► 稳定的 data
  ├─ useCallback：deps 变才新建 ─► 稳定的 onClick
  └─ 一起传给 memo(Child)
        └─ 浅比较：data ✅  onClick ✅ → 跳过 Child 渲染 ✅✅✅
```

### 四、什么时候不该 memo

memo 自身的浅比较也有成本；给一堆简单组件硬包，可能**省下的渲染还不如比较的开销**。

| 适合 memo | 不适合 memo |
| --- | --- |
| 子组件渲染昂贵（大列表、重计算） | 渲染极快的简单组件（一个 div） |
| props 大部分时候不变 | props 几乎每次都变 |
| 父高频渲染但只影响局部 | 父组件本身很少渲染 |

```
不优化：  render 1ms + 0 比较成本
硬上 memo：render 1ms（照跑，因为 props 引用每次都变）
           + 浅比较 0.01ms = 白花钱 💸

先用 React DevTools Profiler 的 "why did this render"
确认到底谁在反复渲染、为什么渲染，再针对性上 memo
```

### 五、Vue 侧对照（一句）

Vue 的 `computed` 天然缓存（依赖不变不重算），组件更新靠精确的依赖追踪（只有用到该数据的组件才重渲染），所以没有 React 这套"手动 memo"的惯用法——**Vue 编译期依赖收集 vs React 运行时全量渲染 + 手动拦截**的模型差异。

## 面试答法

### 30 秒版（可背诵）

> React 默认父组件一渲染所有子组件全跟着渲染，优化核心就是跳过没必要的部分。memo 包住子组件后，props 浅比较没变就直接复用上次渲染结果；但给子组件传函数时每次都是新引用，浅比较必失败，所以要配 useCallback 锁住函数引用，对象数组就配 useMemo。三者分工：memo 拦子组件渲染、useMemo 缓存值、useCallback 缓存函数，后两个很大程度是给 memo 供应稳定引用。另外不能无脑全包，简单组件的比较成本可能比渲染还贵，我会先用 React DevTools Profiler 定位谁在反复渲染，确认是瓶颈再上 memo。

### 深入版（被追问时按编号展开）

1. **先讲默认行为**：画"父渲染 → 子全渲染"的瀑布图，用 1000 行列表举例引出问题
2. **memo 原理**：浅比较 props，相同则复用上次结果，跳过 render + diff
3. **失效场景（必考）**：画两次渲染的引用时间线，函数 0xAAA → 0xBBB，引出 useCallback 配合
4. **对比表收拢**：三者包什么 / 返回什么 / 用在哪，一句"useCallback ≈ useMemo 包函数"
5. **反直觉加分**：什么时候不该 memo + 先用 Profiler 测量再优化
6. **横向对照**：Vue 靠响应式自动追踪不需要这套，点出模型差异

### 常见追问

- **memo 是深比较吗？** → 浅比较（逐个 props 用 ===），深比较太贵；需要自定义时传 memo 的第二个参数 areEqual
- **useMemo 能当语义化缓存用吗？** → 能用但语义上它只是性能提示，React 未来（如虚拟屏）可能丢弃缓存，别写依赖它的业务逻辑
- **子组件自己有 useState 还会被 memo 拦住吗？** → 不会，memo 只拦"父触发的渲染"，子组件内部 state 变化照样触发渲染
- **React Compiler 之后还要手写吗？** → 新编译器自动记忆化，方向是"能不写就不写"，但理解三者原理仍是面试硬考点
