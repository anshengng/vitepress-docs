# React Hooks 闭包陷阱

## 题目

> 什么是 Hooks 的闭包陷阱（stale closure）？为什么 setInterval 里打印 count 一直是 0？怎么解决？为什么 Vue 没有这个问题？

## 为什么会掉进陷阱

先建立一个心智模型：**函数组件不是"一个对象的一生"，而是"每次渲染 = 一次独立的函数调用"**。

```
类组件思维（❌ 错误类比）        函数组件真相（✅）
  this 一直活着，状态挂在身上      每次渲染重新调用 Counter()

  Counter() 第1次渲染 → 局部变量 count = 0，产生快照 render#1
  Counter() 第2次渲染 → 局部变量 count = 1，产生快照 render#2
  Counter() 第3次渲染 → 局部变量 count = 2，产生快照 render#3
  ...每次调用里的 count 都是【不同的变量】，互不相干
```

每次渲染都会创建**新的闭包**，闭包捕获的是**那一次渲染时的 props/state 值**——这就是"渲染快照"。

```
        render#1 闭包 ──捕获── count=0
        render#2 闭包 ──捕获── count=1
        render#3 闭包 ──捕获── count=2
  问题出在：定时器/effect 只创建了一次，
  它永远握着 render#1 那个旧闭包不放 📸
```

## 核心要点

### 1. 经典 bug 逐帧模拟：setInterval 每秒打印 count 永远是 0

```jsx
function Counter() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const id = setInterval(() => console.log(count), 1000); // 没清理、依赖数组缺失
    return () => clearInterval(id);
  }, []);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

```
时刻          发生了什么                          count 值     定时器回调捕获的是谁
 t0   首次渲染 render#1，执行函数体          count=0(局部)   —
 t1   useEffect([]) 执行 → 创建定时器        闭包A 捕获 render#1 的 count=0
 t2   用户点按钮 → render#2                 新 count=1     闭包A 仍指向 0（与 render#2 无关）
 t3   用户再点 → render#3                   新 count=2     闭包A 仍指向 0
 每秒  定时器触发，执行的是【闭包A】         console.log(0) ❌ 永远打印 0

 依赖数组 [] 的潜台词："只在第一次渲染后跑一次"
 → 回调函数是 render#1 那次调用产生的闭包，之后每次渲染产生的新闭包它都看不见
```

同理：`useEffect` 里 `setTimeout(() => console.log(count), 3000)`，3 秒内 count 变了也照样打印旧值——回调仍是创建那次渲染的闭包。

### 2. 三种解法对比

```jsx
// 解法一：函数式更新 —— 不"读"旧值，把"算"交给 React
setCount(c => c + 1);            // 点击 N 次后定时器里也正确递增
// 原理：c 由 React 在更新时刻传入最新 state，不依赖闭包捕获的 count

// 解法二：useRef 保存最新值 —— 给闭包装一根"永远指向现在"的天线
const countRef = useRef(count);
countRef.current = count;        // 每次渲染同步刷新
setInterval(() => console.log(countRef.current), 1000); // ✅ 读到最新
// 原理：ref 对象跨渲染是【同一个引用】，.current 可变，绕过快照

// 解法三：依赖数组重建定时器 —— 承认"每次渲染一套闭包"，变了就重建
useEffect(() => {
  const id = setInterval(() => console.log(count), 1000);
  return () => clearInterval(id);
}, [count]);  // count 变 → 清旧定时器 → 用新闭包建新定时器
// 原理：让 effect 的生命周期跟着快照走，每次用当次渲染的闭包
```

| 解法 | 适用 | 代价 |
| --- | --- | --- |
| 函数式更新 | 更新依赖旧值计算（计数、累加） | 只适合 setState 场景，log/读值不行 |
| useRef | 回调里需要"当前最新值"（定时器、事件监听） | 要手动维护 .current；不参与渲染 |
| 依赖数组重建 | effect 整体依赖某个值（如轮询间隔变化） | 频繁重建开销；副作用会重跑 |

### 3. 事件处理器版本（同一陷阱的另一副面孔）

```jsx
// 父传 onClick，子组件用 useCallback([]) 缓存 → 处理器捕获旧的 count
const handleClick = useCallback(() => console.log(count), []);
// 同理：addEventListener('click', handler) 注册一次后，handler 永远是首渲染闭包
```

### 4. 为什么 Vue 没有这个问题（一句话对比）

```
React：state 是"每次渲染拷贝出来的值"（快照语义）→ 闭包捕获旧值
Vue  ：ref/reactive 是"跨渲染同一个响应式对象"（引用语义），
       模板/函数里访问 .value 是【每次读取时现取】，永远拿到最新 → 无此陷阱
```

- Vue3 `<script setup>` 里函数只定义一次（组件实例持续存在），不存在"每次渲染重新调用函数体"
- React 19 的 `useEffectEvent` 正是官方给这类"读取最新值但不作为依赖"场景的补丁

## 面试答法

### 30 秒版

> 闭包陷阱的根源是：函数组件每次渲染都是一次全新的函数调用，每次调用创建的新闭包捕获的是当次渲染的 state 快照。像 useEffect 依赖数组为空时定时器只建一次，它的回调永远是首次渲染那个闭包，里面捕获的 count 是 0，之后组件重渲染产生新闭包但定时器不认识，所以每秒打印的一直是 0。解法三条：函数式更新 setCount(c=>c+1) 让 React 传最新值进来；useRef 跨渲染保持同一引用、回调读 ref.current；或者把值放进依赖数组，变了就清理重建 effect。Vue 没这问题是因为它的响应式是同一个对象引用、取值时现读，而 React 的 state 是渲染时刻的拷贝。

### 深入版（被追问时按这条线展开）

1. **先立心智模型**：函数组件 = 每次渲染一次独立调用，局部变量是当次调用的私有快照
2. **画闭包捕获图**：render#1/#2/#3 各产生闭包，effect 只持有 render#1 的闭包
3. **逐帧模拟 bug**：t0 首渲染 → t1 建定时器捕获 0 → t2/t3 重渲染与定时器无关 → 每秒 log(0)
4. **三解法**：函数式更新（不读旧值）、useRef（同一引用读 .current）、依赖数组重建（生命周期跟着快照走），各自适用场景
5. **推广**：useCallback 缓存事件处理器、原生 addEventListener 同样中招
6. **对比 Vue**：引用语义 vs 快照语义；React 19 useEffectEvent 收尾

### 常见追问

- **为什么函数式更新能解决？** → `c => c + 1` 里的 c 是 React 在真正更新那一刻传入的最新 state，回调不需要从闭包里读旧值
- **useRef 为什么不会"过期"？** → useRef 返回的对象跨渲染是同一个引用，.current 的读写都发生在同一对象上，不受快照影响
- **依赖数组加满所有用到的值不就行了？** → 是官方推荐（eslint exhaustive-deps），但像定时器这种"重建代价高"的场景，useRef/useEffectEvent 更合适
- **Vue 的 computed/watch 为什么没这问题？** → 组件实例只创建一次，watch 回调访问的是响应式代理对象，每次 .value 现取最新值
- **props 会有闭包陷阱吗？** → 会，机制完全相同：旧闭包捕获的是旧 props（如父组件传入的回调/列表）
