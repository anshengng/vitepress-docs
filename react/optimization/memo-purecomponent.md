# 渲染性能优化：memo / PureComponent / shouldComponentUpdate

## 先说一个真实的困惑

给子组件套了 `React.memo`，心想这下它不会再跟着父组件瞎渲染了。结果一开 DevTools 的高亮更新，子组件还是每次都闪。

再看一眼代码，也没写错啊：

```jsx
function Parent() {
  return <Child onClick={() => console.log('hi')} />;  // 每次渲染都是新函数
}
const Child = React.memo(function Child({ onClick }) {
  return <button onClick={onClick}>点我</button>;
});
```

`memo` 确实在挡，但它挡的依据是**"这张工牌还是不是原来那一张"**。父组件每次渲染都重新做一张新工牌（新函数引用），门卫自然认不出来是同一个人，于是照旧放行。

所以这一篇讲的是三件事：门卫怎么配（React.memo）、门卫的工牌怎么保持不变（useMemo / useCallback）、还有哪些情况门卫根本管不着。

## 默认的规矩：父组件一动，子组件就得陪着跑

```text
父组件 setState
    ↓
父 fiber 打上更新标记
    ↓
beginWork 递归协调 children
    ↓
子 fiber 的 props 变了吗？React 默认不比较
    ↓
一律继续 reconcile → 子组件函数体 / render 被执行
```

也就是说：即使子组件 props 完全没变，只要父组件渲染，子组件就白跑一遍。三件武器（`React.memo`、`PureComponent`、`shouldComponentUpdate`）本质都是同一个动作——**在父更新时，于子组件门口拦一道，比对通过才放行**。

| 手段 | 适用 | 比较对象 | 返回语义 |
|------|------|----------|----------|
| React.memo | 函数组件 | props（浅比较） | 相等 → 跳过渲染 |
| PureComponent | 类组件 | props + state（浅比较） | 相等 → 跳过渲染 |
| shouldComponentUpdate | 类组件 | 自定义逻辑 | 返回 false → 跳过渲染 |

## React.memo：给子组件配一个门卫

`React.memo` 是一个高阶组件，包裹后会记住上一次的 props，下次渲染前先做**浅比较**，相等就直接 bail out，复用上一次的结果：

```jsx
const Child = React.memo(function Child({ name }) {
  // 只有门卫判定"工牌没变"时，这个函数才不会被执行
  return <div>{name}</div>;
});
```

门卫的比对规则（`shallowEqual`）值得逐行看：

```typescript
function shallowEqual(objA, objB) {
  if (Object.is(objA, objB)) return true;          // 同一引用，直接算相等

  // 都是对象才继续往下比
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false; // 字段数量都不同，肯定不等

  for (const key of keysA) {
    // 用 Object.is 逐个比「值」，只比一层，绝不递归进去
    if (!Object.prototype.hasOwnProperty.call(objB, key) ||
        !Object.is(objA[key], objB[key])) {
      return false;   // 少一个字段，或者值不是同一个引用 → 不等
    }
  }
  return true;        // 一层比完都相等 → 拦住，不渲染
}
```

注意它比的是"值"，而对象、数组、函数的"值"就是**内存地址**。门卫只核对外层信息，不打开行李检查里面的东西——这一点后面会反复用到。

也可以自己写比较规则（语义跟 `shouldComponentUpdate` **相反**，很容易记混）：

```jsx
const Child = React.memo(Component, (prevProps, nextProps) => {
  // 返回 true 表示「props 相等，不需要重渲染」
  return prevProps.id === nextProps.id;
});
```

## PureComponent：门卫顺手再查一下本人的 state

`PureComponent` 是类组件版的同款门卫。它内置了一个 `shouldComponentUpdate`，对 props 与 state **同时**做浅比较：

```jsx
class Child extends React.PureComponent {
  render() {
    return <div>{this.props.name}</div>;
  }
}
```

它等价于手写这么一版：

```jsx
class Child extends React.Component {
  shouldComponentUpdate(nextProps, nextState) {
    // props 和 state 各浅比较一次，任一变了才返回 true
    return !shallowEqual(this.props, nextProps) ||
           !shallowEqual(this.state, nextState);
  }
  render() {
    return <div>{this.props.name}</div>;
  }
}
```

`shouldComponentUpdate` 是最原始的手动版本——判断逻辑你自己定，返回 `false` 就直接跳过 render 以及后续的更新生命周期：

```jsx
shouldComponentUpdate(nextProps, nextState) {
  return nextProps.id !== this.props.id;   // 只按 id 决定更不更新
}
```

## 门卫拦得住什么，拦不住什么

这是 memo 最容易踩的认知盲区：

| 情况 | 是否被拦住 |
|------|-----------|
| 父组件重渲染、props 浅比较相等 | 拦住，跳过渲染 |
| 组件自身 state / Hook 变化 | 拦不住，照样渲染 |
| 父组件传下新的 children 元素 | 拦不住（children 也是 prop，是新引用） |
| 组件订阅了 context 且值变了 | 拦不住（走 context 传播，不走 props 比较） |
| props 是每次渲染新建的对象 / 数组 / 函数 | 拦不住（浅比较必然不等，memo 白做） |

用人话说：门卫只管"从这道门进来的人"，管不了本人自己生病（自身 state 变了）、管不了总部直接下发的通知（context 更新）、也管不住跟着别人混进来的孩子（新的 children 引用）。

## 为什么对象、数组、函数总被门卫拦下

```jsx
function Parent() {
  const [n, setN] = useState(0);

  // 每次渲染，箭头函数、对象字面量、数组字面量都是重新创建的新引用
  return (
    <Child
      onClick={() => setN(n + 1)}   // 新函数引用
      style={{ color: 'red' }}       // 新对象引用
      list={[1, 2, 3]}               // 新数组引用
    />
  );
}

const Child = React.memo(function Child({ onClick, style, list }) {
  return <button onClick={onClick} style={style}>{list.length}</button>;
});
```

浅比较是 `Object.is` 逐值比较，而这几个 props 每次都是**新的引用**，`Object.is` 必然返回 false → 门卫判定「换人了」→ 子组件照常重渲染。内容明明一模一样，工牌号却每次都变，这就是"memo 没用"的真正原因。

### 三件套：memo 是门卫，useMemo / useCallback 负责把工牌焊死

```jsx
function Parent({ color }) {
  const [n, setN] = useState(0);

  const handleClick = useCallback(() => setN((v) => v + 1), []);   // 依赖为空，引用恒定
  const style = useMemo(() => ({ color }), [color]);              // 只有 color 变才新建
  const list = useMemo(() => [1, 2, 3], []);                       // 常量，引用恒定

  return <Child onClick={handleClick} style={style} list={list} />;
}
```

三者的分工：

| 角色 | 解决什么 | 为什么是它 |
|------|----------|-----------|
| `React.memo` | 决定这次要不要渲染 | 它是门口那道闸，负责比较 |
| `useCallback` | 让函数 prop 的引用稳定 | 函数每次执行都会新建，必须缓存 |
| `useMemo` | 让对象 / 数组 prop 的引用稳定 | 字面量每次执行都会新建，必须缓存 |

只有把引用稳定下来，浅比较才能通过、bail out 才会生效。但 `useMemo` / `useCallback` 本身也有成本（登记 hook、比较依赖），只在「传给 memo 子组件」或「作为其他 Hook 依赖」时才值得用。

## 更省事的办法：让重型子树根本不走这道门

除了门卫，还有一招从结构上绕开：把**不依赖该 state 的重型子树**以 `children` 传入，让它在父组件之外创建，元素引用天然保持不变，React 直接复用。

```jsx
// 反例：ExpensiveTree 与 count 无关，却跟着 App 一起重渲染
function App() {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button onClick={() => setCount(count + 1)}>{count}</button>
      <ExpensiveTree />          {/* App 每次渲染都重新创建这个元素 */}
    </div>
  );
}

// 正例：状态下移到 Counter，ExpensiveTree 作为 children 从 App 传入
function App() {
  return (
    <Counter>
      <ExpensiveTree />          {/* App 不重渲染 → 该元素引用恒定 → 直接复用 */}
    </Counter>
  );
}

function Counter({ children }) {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button onClick={() => setCount(count + 1)}>{count}</button>
      {children}
    </div>
  );
}
```

`count` 变化只会让 `Counter` 重渲染，`children` 是 App 上次渲染留下的同一个元素对象，React 发现引用相同便跳过协调，`ExpensiveTree` 完全不动。

## React Compiler：门卫可以自动生成

React 19 时代的方向是让编译器在**构建期**自动做等价优化，不必人手一个 `memo`：

```text
源码（遵守 Rules of React 的纯组件）
    ↓ babel-plugin-react-compiler 静态分析
识别组件、Hook 依赖、可变引用
    ↓
自动插入等价的 memo / useMemo / useCallback
    ↓
运行时按需 memo 化，减少手写
```

它的前提是组件遵循「渲染纯、不改 props、不乱用可变值」。写对了，很多 `React.memo`、`useMemo` 可以省掉。

## 常见反模式与排查思路

| 反模式 | 问题 |
|--------|------|
| 给每个组件都套 memo | 比较成本 + 内存占用，收益常常为负 |
| 只 memo 子组件、不处理内联 props | 浅比较必然失败，memo 形同虚设 |
| 用 memo 挡 context 更新 | 走的是 context 传播路径，拦不住 |
| 依赖 memo 保证正确性 | memo 只是优化，不该影响逻辑正确性 |

真怀疑自己白写了 memo，可以先让工具说话：

| 工具 | 用途 |
|------|------|
| React DevTools Profiler | 录一段交互，看哪些组件、为什么重渲染 |
| DevTools 的 Highlight updates | 打开后重渲染组件高亮闪烁，肉眼看传播范围 |
| why-did-you-render | 控制台打印「因浅比较失败而重渲染」的具体 props |

## 面试答法

React 默认只要父组件渲染，子组件就无条件跟着渲染，不管 props 有没有变，所以三种优化手段本质都是在父更新时拦住子组件的渲染。React.memo 是函数组件的高阶组件，用 shallowEqual 对 props 做一层浅比较，key 数量相同且逐项 Object.is 都相等就 bail out 跳过渲染，也可以传自定义比较函数，但语义和 shouldComponentUpdate 相反，返回 true 表示相等、不重渲染；PureComponent 是类组件版，内置的 shouldComponentUpdate 同时对 props 和 state 做浅比较；shouldComponentUpdate 则允许自己写判断，返回 false 直接跳过 render 和后续生命周期。浅比较最大的坑是对象、数组、函数这类 props，每次渲染都是新引用，Object.is 必然不等，memo 就白做了，所以要用 useMemo、useCallback 把引用稳定下来，或者用内容提升，把不依赖该 state 的重型子树以 children 从外层传入，让元素引用保持恒定被复用。同时要清楚 memo 的边界：拦不住组件自身 state 变化、拦不住 context 更新、拦不住新 children；React 19 的方向是靠 React Compiler 在构建期自动 memo 化，减少手写优化。
