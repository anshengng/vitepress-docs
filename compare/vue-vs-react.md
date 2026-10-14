# Vue vs React 全面对比

## 一、设计哲学

| | Vue | React |
|---|---|---|
| 定位 | 渐进式框架（核心只管视图，路由/状态按需加） | 一个 UI 库，生态自选 |
| 视图写法 | 模板为主（语法受限） | JSX（万物皆 JS） |
| 优化重心 | 编译时（模板可静态分析） | 运行时（并发调度） |

Vue 用模板约束换编译时优化：正因为模板语法是受限的，编译器才能看清结构，
做静态提升、PatchFlags 这类优化。React 选择 JSX 自由度优先，
优化只能放在运行时（Fiber 并发调度），后来又靠 React Compiler 把优化挪回编译时。

## 二、响应式模型

| | Vue | React |
|---|---|---|
| 数据风格 | 可变（直接改） | 不可变（换新引用） |
| 触发方式 | 赋值即触发（Proxy 拦截） | 显式调用 setState |
| 变更检测 | 精确知道哪个属性变了 | 不知道哪里变，重渲染子树再对比 |

```typescript
// Vue：改值即触发，Proxy 追踪依赖
const count = ref(0)
count.value++ // 响应式系统知道只有 count 变了

// React：不可变 + 显式触发
const [count, setCount] = useState(0)
setCount(count + 1) // 生成新 state，安排一次重新渲染
```

### 为什么 React 必须不可变

React 全靠引用浅比较（Object.is）判断变没变：

```typescript
// React.memo / useMemo 的核心逻辑
const prev = { list: [1, 2, 3] }
const next = prev
next.list.push(4)            // 直接改
Object.is(prev, next)        // true → React 认为没变，跳过更新（bug！）

// 正确做法：创建新引用
const next2 = { list: [...prev.list, 4] }
Object.is(prev, next2)       // false → 更新
```

Vue 不需要这样：Proxy 的 set 拦截能精确知道 push 改了数组内容，
所以直接可变更新也能触发。

## 三、更新粒度

| | Vue | React |
|---|---|---|
| 更新范围 | 组件级精确更新 | 从触发组件自顶向下递归整棵子树 |
| 范围控制 | 依赖收集自动缩小 | 手动 memo / useMemo / useCallback |
| 自动化 | 编译优化内置 | React Compiler（19+ 配套）才自动化 |

```
Vue：  data 变化 → 只通知依赖它的组件 → 精确更新
React：setState → 从当前组件递归渲染整棵子树（除非被 memo 拦截）
```

Vue：组件 render 执行时做依赖收集，模板里用到的数据才建立依赖，
数据变了只重新渲染依赖它的组件；父组件更新时还会通过 shouldUpdateComponent
检查子组件 props / slot 是否变化，没变就跳过子组件重渲染。

React：setState 后默认把该组件整棵子树递归渲染一遍，优化靠手动包
memo、useMemo、useCallback 把 props 钉住，漏写就是性能问题；
React Compiler（19+）通过编译时自动 memoization 补上了这块。

## 四、Hooks vs Composition API

| | Vue Composition API | React Hooks |
|---|---|---|
| 执行时机 | setup 整个生命周期只执行一次 | 函数组件每次渲染都重新执行 |
| 状态载体 | 闭包变量 + ref / reactive 对象 | 链表（按调用顺序索引） |
| 条件调用 | 无限制 | 不能在条件 / 循环 / 嵌套函数中调用 |
| 闭包陷阱 | 基本没有（.value 实时读） | 常见（state 是渲染快照） |

```
Vue：setup() 只执行一次 → count 是同一个 ref 对象，跨渲染稳定
React：整个函数就是 render → 每次渲染从链表取"本次"的快照值
```

### 闭包陷阱对比

```typescript
// React：state 是当次渲染的快照，回调里读到的是旧值
function Counter() {
  const [count, setCount] = useState(0)
  const log = () => setTimeout(() => alert(count), 1000)
  // 先改到 3 再点 log：弹出 0（点击那一刻的快照）
  return <button onClick={() => { setCount(3); log() }}>{count}</button>
}
// 连续 setCount(count + 1) 三次也只 +1，要用函数式更新 setCount(c => c + 1)
```

```typescript
// Vue：ref 是稳定对象，.value 实时读取
const count = ref(0)
const log = () => setTimeout(() => alert(count.value), 1000)
// 同样操作：弹出 3
```

React hooks 状态存在链表里、靠调用顺序对应，所以不能条件调用；
Vue 的 setup 只跑一次，状态就是真正的变量，没有顺序限制。

## 五、Diff 算法对比

| | Vue | React |
|---|---|---|
| 算法基础 | 同层比较 + key 映射 | 同层比较 + key 映射 |
| 编译优化 | PatchFlags + Block 靶向更新 | 无（Compiler 后部分缓解） |
| 子序列移动 | 最长递增子序列（LIS），移动次数最少 | lastPlacedIndex 线性扫描，不保证最少 |

Vue 借模板的静态分析做编译时优化：

| 优化 | 作用 |
|---|---|
| PatchFlags | 给 vnode 标记动态部分类型，运行时只 diff 标记过的内容 |
| Block Tree | 收集动态后代（dynamicChildren），更新时跳过所有静态节点 |
| 静态提升 | 静态节点提升到 render 外，只创建一次 |
| cacheHandlers | 内联事件缓存，避免每次渲染生成新函数触发子组件更新 |
| LIS | 子节点重排时求最长递增子序列，最小化 DOM 移动 |

React 不做编译时分析，靠运行时 Fiber 架构解决大树的更新阻塞问题。

## 六、Fiber 为什么出现

React 16 之前（Stack Reconciler）：diff 是同步递归，一旦开始无法中断，
大组件树更新长时间占用主线程，动画掉帧、输入卡顿。

```
Stack 时代（不可中断）：
render → 递归 diff 整棵树（可能上百 ms）→ commit → 主线程才释放
                 ↑ 期间无法响应任何输入

Fiber 时代（可中断）：
render 阶段（可中断）：
  workLoop → performUnitOfWork → shouldYield？
    否 → 处理下一个 Fiber（child → sibling → return）
    是 → 保存进度，把控制权还给浏览器（时间切片，约 5ms）
  浏览器空闲后从断点恢复，高优先级更新（用户输入）可插队
commit 阶段（不可中断）：一次性应用所有 DOM 变更
```

核心改动：把递归树改成 return / child / sibling 指针的链表，
每个节点是独立的工作单元，配合 Scheduler 时间切片和 lanes 优先级模型。
这套架构是 React 18 并发特性（useTransition / useDeferredValue、
自动批处理、流式 SSR）的基础。

## 七、状态管理

| | Pinia | Redux | Zustand |
|---|---|---|---|
| 核心机制 | 基于 Vue 响应式 | 单一 store + 不可变 reducer | 轻量 store + set 合并 |
| 触发更新 | 直接改 state（Proxy 拦截） | dispatch action → 产生新 state | set(部分 state) 产生新对象 |
| 组件订阅 | 天然响应式，按需依赖 | useSelector + 浅比较 | selector 订阅 |
| 样板代码 | 少 | 多（action / reducer / dispatch） | 少 |

```typescript
// Pinia：改就是更新（响应式直达组件）
const store = useCounterStore()
store.count++ // 只有依赖 count 的组件更新

// Zustand：不可变 + 订阅
const useStore = create((set) => ({
  count: 0,
  inc: () => set((s) => ({ count: s.count + 1 })) // 产生新对象
}))
```

本质差别还是响应式 vs 不可变：Pinia 复用 Vue 的依赖追踪；
Redux / Zustand 生成新 state 后靠订阅和比较通知组件。

## 八、性能优化手段对照表

| 场景 | Vue | React |
|---|---|---|
| 组件记忆化 | 组件级自动跳过（props 检查） | React.memo 手动包 |
| 值缓存 | computed | useMemo + 依赖数组 |
| 函数缓存 | 一般不需要 | useCallback |
| 静态内容 | 编译时自动提升（v-once 可再强化） | 无内置 |
| 模板局部缓存 | v-memo | 手动 useMemo |
| 组件懒加载 | defineAsyncComponent | React.lazy + Suspense |
| 组件实例缓存 | keep-alive | 无内置，社区方案 |
| 长列表 | 虚拟滚动（社区库） | 虚拟滚动（社区库） |
| 紧急/非紧急更新 | 默认同步 | useTransition / useDeferredValue |

## 面试答法：为什么选 Vue/React

两边的核心差异是响应式模型：Vue 靠 Proxy 依赖追踪做到改值即触发、
组件级精确更新，并用模板约束换来编译时优化；
React 坚持不可变数据加显式 setState，靠 Fiber 并发调度和 memo 体系控制更新成本。
选型我会看团队和场景：快速上手、少写防御性优化代码、模板为主的业务页面，
Vue 性价比更高；团队函数式功底好、需要 React 独有生态（RN、某些重型库），
或要用并发特性精细控制更新优先级，就选 React。
更重要的是两边机制都吃透：闭包陷阱、不可变更新的原因、水合这些坑是相通的，
框架只是手段。
