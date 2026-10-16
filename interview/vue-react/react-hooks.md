# React 常用 Hooks 理解

## 题目

> React Hooks 解决了什么问题？常用的 Hooks 有哪些？useEffect 的依赖数组怎么写？为什么 Hook 不能写在 if 语句里？

## 为什么需要 Hooks

类组件时代两大痛点。

**痛点一：逻辑分散。** 一个功能的代码被生命周期函数撕碎，中间还隔着别人家的代码：

```
类组件：一个功能被生命周期撕碎
┌─ componentDidMount ────► 开定时器（功能A）+ 开监听（功能B）
├─ componentDidUpdate ───► 数据变了重新订阅（功能A）
└─ componentWillUnmount ► 关定时器（功能A）+ 关监听（功能B）

功能 A 的代码散在 3 处、功能 B 散在 2 处，上下翻屏才拼得出全貌
```

**痛点二：复用靠 HOC，嵌套成 wrapper hell。**

```
export default withTheme(withAuth(withRouter(withTracker(UserList))))
                              ▼ 渲染出来
<ThemeCtx>
  <AuthCtx>
    <RouterCtx>
      <TrackerCtx>
        <UserList/>      ← 想看本尊，先扒 4 层皮
      </TrackerCtx>
    </RouterCtx>
  </AuthCtx>
</ThemeCtx>
```

Hooks 把**按生命周期组织代码改成按功能组织**：相关逻辑聚在一处，复用只需调用一个函数（自定义 Hook）。

## 核心要点

### 一、常用 Hooks 速查表（一句话 + 最小代码 + 最容易踩的坑）

| Hook | 一句话 | 最小代码 | 最容易踩的坑 |
| --- | --- | --- | --- |
| useState | 给函数组件加"记忆" | `const [n, setN] = useState(0)` | 连续 set 拿旧值，要用函数式 `setN(v => v + 1)` |
| useEffect | 处理副作用（请求/订阅/定时器） | `useEffect(fn, [deps])` | 依赖漏写 → 闭包里永远是旧值 |
| useRef | 拿 DOM / 存不触发渲染的可变值 | `const r = useRef(null)` | 改 `.current` 不触发渲染（也是优点） |
| useMemo | 缓存计算结果 | `useMemo(() => heavy(a), [a])` | 依赖漏写 → 缓存了过期结果 |
| useCallback | 缓存函数引用 | `useCallback(fn, [deps])` | 无脑包小函数，得不偿失 |
| useContext | 跨层级读 Provider 的值 | `const t = useCtx()` | 值一变，所有消费组件都重渲染 |

### 二、useEffect 依赖数组的三种写法

```
useEffect(fn)        每次渲染后都执行      ≈（没有直接对应，慎用）
useEffect(fn, [])    只在首次渲染后执行    ≈ componentDidMount
useEffect(fn, [a])   首次 + a 变化后执行  ≈ didMount + didUpdate 组合

fn 返回的 cleanup：   下次执行前 / 组件卸载时调用 ≈ componentWillUnmount
```

```jsx
useEffect(() => {
  const timer = setInterval(tick, 1000)
  return () => clearInterval(timer)  // 卸载时清理，防内存泄漏
}, [])
```

时序一句话：useEffect 在**浏览器渲染完之后**异步执行，不阻塞画面（对比 useLayoutEffect 同步执行，适合"读了布局再改样式"的场景）。

### 三、为什么 Hook 不能写在 if 里

React **不记录 Hook 的变量名，只按调用顺序存进链表**。同一组件每次渲染，靠"第 N 次调用"对应上次的第 N 个位置。

```
第一次渲染（if 条件为 true）：     第二次渲染（if 条件变 false）：
 Hook① useState   ──┐             Hook① useState
 Hook② useState   ──┘匹配链表      （if 里的 Hook② 没执行）
 Hook③ useEffect                     ↑
                                      └─ 本该是③的位置空了
                                        按顺序对号：③被当成②
                                        → 状态张冠李戴 💥

规则：只在函数顶层调用，不能进 if / for / 嵌套函数
（eslint-plugin-react-hooks 会强制检查）
```

### 四、useRef 的两大用途

```
用途1：DOM 引用
  const inputRef = useRef(null)
  <input ref={inputRef} />
  inputRef.current.focus()      // 直接操作真实 DOM

用途2：可变容器（改了不触发渲染）
  const count = useRef(0)
  count.current++               // 日志计数：变了但不需重画界面
```

对比记忆：`useState` 改了要重新渲染（给用户看的）；`useRef` 改了不渲染（自己记账用的）。

### 五、自定义 Hook：抽离复用逻辑

以"请求接口"为例，前后对比：

```jsx
// ❌ 之前：每个组件都要抄一遍
function UserList() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    setLoading(true)
    fetch('/api/users').then(r => r.json()).then(d => {
      setData(d); setLoading(false)
    })
  }, [])
  // ...
}

// ✅ 之后：抽成 useFetch，组件一行搞定
function useFetch(url) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    setLoading(true)
    fetch(url).then(r => r.json()).then(d => {
      setData(d); setLoading(false)
    })
  }, [url])
  return { data, loading }
}

function UserList() {
  const { data, loading } = useFetch('/api/users')
  // ...
}
```

自定义 Hook 的判定：**函数名以 use 开头 + 内部调了其他 Hook**。对比 HOC：没有嵌套 wrapper、没有 this、DevTools 里 Hook 链路清晰可见。

### 六、Vue 组合式 API 对照（一句）

理念同源（逻辑按功能聚合），执行模型不同：React 每次渲染整个函数重跑、靠**手写依赖数组**决定 effect 何时重执行；Vue 的 setup 只执行一次、靠响应式系统**自动追踪依赖**（不用手写依赖）。

## 面试答法

### 30 秒版（可背诵）

> Hooks 是为解决函数组件没有状态、逻辑复用难的问题。类组件时代一个功能的代码被拆散在各个生命周期里，复用又得层层 HOC 嵌套成 wrapper hell；Hooks 让逻辑按功能聚合，配合自定义 Hook，一个 useFetch 就把请求逻辑复用了。常用的有 useState 管状态、useEffect 处理副作用——它靠依赖数组控制执行时机：空数组只跑一次、带依赖是变化时跑、不传是每次渲染都跑，返回的清理函数对应卸载逻辑。还要记住 Hook 只能写在顶层，因为 React 按调用顺序而不是变量名对应状态，写了条件语句顺序一乱状态就错位了。

### 深入版（被追问时按编号展开）

1. **痛点开场**：画"逻辑被生命周期撕碎"和"wrapper hell"两张图
2. **核心三件套**：useState（状态）、useEffect（副作用 + 三种依赖行为）、useRef（DOM + 可变容器）
3. **原理加分**：Hook 靠链表按调用顺序存取 → 解释为什么不能进条件语句
4. **复用落地**：自定义 Hook 示例，对比 HOC 的优势（无嵌套、来源清晰）
5. **横向对比**：和 Vue 组合式 API 一句话比较（执行模型 + 依赖追踪方式）

### 常见追问

- **useEffect 和 useLayoutEffect 区别？** → 前者异步、渲染后执行不阻塞画面；后者同步、DOM 提交前执行，适合读布局后立即改样式
- **接口依赖 id 变化怎么防竞态？** → 依赖数组放 id，effect 里用 AbortController 取消上一次未完成的请求
- **连着三次 setN(n+1) 结果加几？** → 只加 1（批处理下拿到同一个旧值）；写 setN(v => v+1) 才加 3
- **两个组件用同一个自定义 Hook 会共享状态吗？** → 不会，每次调用都是独立的一套 Hook 链表；要共享得用 Context 或状态库
