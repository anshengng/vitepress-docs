# Context 原理与性能陷阱

## 核心思路

Context 解决的是「跨层级传值」：祖先把值放进 Provider，后代无需逐层透传 props 就能读到。
但它的底子是**广播**——Provider 的 value 一变，所有消费该 context 的后代都会被标记为需要更新，
既没有选择器，也没有局部订阅。理解这套传播机制，是避免「改一个值、整棵子树重渲染」的关键。

| 概念 | 作用 |
|------|------|
| createContext(defaultValue) | 创建 context 对象，默认值只在没有任何 Provider 时生效 |
| Context.Provider | 提供一个 value，作用范围是它的整棵子树 |
| useContext(Context) | 在后代任意深度读取最近的 Provider 提供的 value |
| Context.Consumer | 渲染函数式读取（旧写法），等价于 useContext |

## createContext 返回了什么

context 对象本身带着「当前值」这个可变字段，Provider 渲染时会临时改写它，供后代读取。

```typescript
function createContext(defaultValue) {
  const context = {
    $$typeof: REACT_CONTEXT_TYPE,
    _currentValue: defaultValue,   // 当前值，Provider 渲染时被临时改写
    _currentValue2: defaultValue,  // 第二个渲染器场景（如多渲染器共存）
    _threadCount: 0,
    Provider: null,
    Consumer: null,
  };
  context.Provider = { $$typeof: REACT_PROVIDER_TYPE, _context: context };
  context.Consumer = context;      // <Context.Consumer> 用到的就是 context 自身
  return context;
}
```

`defaultValue` 只在「消费者上方没有任何该 context 的 Provider」时被读到；
一旦有 Provider，`_currentValue` 就是 Provider 给的 value。

## Provider 的渲染：临时改写、事后恢复

Provider 不是一个普通组件，React 在 beginWork 里对它特殊处理：

```text
beginWork 遇到 ContextProvider
    ↓
nextValue = props.value
    ↓
把旧值压栈，再把 context._currentValue 改写为 nextValue
    ↓
渲染 children（子树内所有 useContext 读到的都是新值）
    ↓
popProvider：把 _currentValue 恢复为栈里的旧值
    ↓
若 nextValue 与旧值 Object.is 不同 → 触发 propagateContextChange
```

值放在 context 上、靠「压栈 / 出栈」而不是靠 props 传递，这正是跨层级读取的实现方式。

## 消费关系：fiber.dependencies

每个读过 context 的 fiber，都会把「我消费了哪个 context」记成一条依赖，
挂在 `fiber.dependencies.firstContext` 上，多条依赖串成链表。

```typescript
function readContext(context) {
  const value = context._currentValue;

  const contextItem = {
    context,              // 消费的是哪个 context
    memoizedValue: value, // 记下读到的值
    next: null,           // 下一条依赖
  };

  if (lastContextDependency === null) {
    // 该 fiber 的第一条依赖：在 fiber 上建立 dependencies 结构
    workInProgress.dependencies = {
      lanes: 0,
      firstContext: contextItem,
      lastContextDependency: contextItem,
    };
  } else {
    // 追加到依赖链表尾部
    lastContextDependency = lastContextDependency.next = contextItem;
  }

  return value;
}
```

这份 `dependencies` 就是「谁消费了这个 context」的索引，
Provider 值变时，React 靠遍历它精准找到消费者。

## 传播机制：沿 Fiber 树向下标记

`propagateContextChange` 从 Provider 的子节点出发，沿 `child` / `sibling` 扫描整棵子树，
命中依赖该 context 的 fiber 就把它标记为需要更新：

```typescript
function propagateContextChange(workInProgress, context, renderLanes) {
  let fiber = workInProgress.child;          // 从 Provider 的子节点往下
  while (fiber !== null) {
    let nextFiber;
    const list = fiber.dependencies;

    if (list !== null) {
      let dependency = list.firstContext;
      while (dependency !== null) {
        if (dependency.context === context) {   // 命中：该 fiber 消费了此 context
          fiber.lanes = mergeLanes(fiber.lanes, renderLanes);
          const alternate = fiber.alternate;
          if (alternate !== null) {
            alternate.lanes = mergeLanes(alternate.lanes, renderLanes);
          }
          // 同步往祖先路径上调度，使这次更新能被调度器拾取
          scheduleContextWorkOnParentPath(fiber.return, renderLanes, workInProgress);
          break;                                // 命中后不再深挖子节点
        }
        dependency = dependency.next;           // 继续走依赖链表
      }
    } else if (fiber.tag === ContextProvider) {
      // 遇到嵌套 Provider：若是同一个 context，停止下探（它自己会传播）
      nextFiber = fiber.type === workInProgress.type ? null : fiber.child;
    }

    // 没子节点就找兄弟，找不到则回溯，直到 Provider 边界为止
    if (nextFiber === null) {
      nextFiber = fiber.sibling;
      while (nextFiber === null) {
        if (fiber.return === null || fiber.return === workInProgress) return;
        fiber = fiber.return;
        nextFiber = fiber.sibling;
      }
    }
    fiber = nextFiber;
  }
}
```

```text
<Ctx.Provider value={value}>
  <A />              ← useContext(Ctx)，dependencies 记录该 Ctx
  <B>                ← 不消费任何 context
    <C />            ← useContext(Ctx)
  </B>
  <D />              ← useContext(Ctx)
</Ctx.Provider>

value 变化
    ↓ 沿 child / sibling 向下扫描
命中 A、C、D，合并 lanes 并向祖先路径调度
    ↓
A、C、D 重渲染；B 不被标记，原地不动
```

## 为什么 value 每次是新对象会让全部消费者重渲染

传播只判断 `dependency.context === context`，**不关心消费者实际用到了 value 的哪个字段**。
于是两个放大效应叠加：

| 现象 | 原因 |
|------|------|
| 改 value 里任一字段，所有消费者重渲染 | 传播按「是否消费该 context」判定，不做字段级 diff |
| 字段都没变，消费者也重渲染 | Provider 内联一个对象字面量当 value，每次渲染都是新对象，`Object.is` 判定不等 |
| 中间层 Provider 重渲染，波及整片子树 | 值一变即整棵子树的消费者被标记，粒度是「context」而非「字段」 |

```jsx
function App() {
  const [theme, setTheme] = useState('light');
  const [user, setUser] = useState({ name: 'tom' });

  // 反例：每次渲染都是新对象，且 theme、user 挤在同一个 context
  return (
    <AppContext.Provider value={{ theme, user }}>
      <Toolbar />      {/* 只读 theme，也会因 user 变化重渲染 */}
    </AppContext.Provider>
  );
}
```

## 优化手段

### 一、用 useMemo 稳定 value

```jsx
function App() {
  const [theme, setTheme] = useState('light');
  const [user, setUser] = useState({ name: 'tom' });

  // 只有 theme 或 user 真正变时才生成新对象
  const value = useMemo(() => ({ theme, user }), [theme, user]);

  return <AppContext.Provider value={value}><Toolbar /></AppContext.Provider>;
}
```

### 二、按「变化频率」拆分 context

```jsx
// 拆开：主题很少变，用户信息频繁变，各自独立传播
<ThemeContext.Provider value={theme}>
  <UserContext.Provider value={user}>
    <Toolbar />
  </UserContext.Provider>
</ThemeContext.Provider>
```

### 三、状态下沉 + 内容提升（children 作为 prop）

把 state 放进真正使用它的组件，把不依赖该 state 的子树以 `children` 传入：

```jsx
function App() {
  return (
    <CounterProvider>
      <ExpensiveTree />   {/* App 不重渲染 → children 元素引用稳定 → 被复用 */}
    </CounterProvider>
  );
}

function CounterProvider({ children }) {
  const [count, setCount] = useState(0);
  // 只有 CounterProvider 重渲染；children 是同一元素对象，React 直接跳过协调
  return (
    <CounterContext.Provider value={count}>
      <button onClick={() => setCount(count + 1)}>{count}</button>
      {children}
    </CounterContext.Provider>
  );
}
```

注意：`React.memo` **拦不住** context 触发的更新——消费者是被 `propagateContextChange` 直接标记的，
不走 props 浅比较那条路径。

## Context 与 props 透传的取舍

| 维度 | props 透传 | Context |
|------|-----------|---------|
| 数据流可见性 | 逐层显式，来源直观 | 隐式，读值处看不到来源 |
| 中间层耦合 | 被迫接收并转发无关 props | 中间层完全无关，可跳过 |
| 组件复用性 | 与数据来源松耦合 | 绑定具体 context，脱离后复用变差 |
| 更新粒度 | 只更新真正传值的那层，可控 | 广播式，value 变则全部消费者重渲染 |
| 适用场景 | 层级浅、数据少、变化可控 | 跨多层共享的主题 / 语言 / 登录态 |

## React 19 的相关变化

React 19 起，context 对象本身可以直接当 Provider 使用，不必再写 `.Provider`；
读取也可以改用 `use(Context)`（它允许条件调用）：

```jsx
// React 18 写法
<ThemeContext.Provider value={theme}><Child /></ThemeContext.Provider>

// React 19：<Context> 直接作为 Provider
<ThemeContext value={theme}><Child /></ThemeContext>

// 读取：useContext 之外还可用 use(Context)
const theme = use(ThemeContext);
```

`.Consumer` 与 `.Provider` 仍可用，但属于旧写法；新代码推荐直接用 `<Context value>`。

## 常见陷阱小结

| 陷阱 | 后果 | 对策 |
|------|------|------|
| 内联对象字面量作 value | 每次渲染新引用，全员重渲染 | useMemo 稳定 value |
| 单个 context 塞太多字段 | 改一处牵动全部消费者 | 按变化频率拆分 |
| 用 context 当全局状态管理器 | 无选择器、无局部订阅，性能失控 | 只放「低频共享」数据；高频用专门状态库 |
| Provider 包住巨型子树 | 值一变整片子树被标记 | 状态下沉 + children 提升 |
| 在渲染期读 context 做判断 | 渲染可能被中断重放，逻辑不稳 | 读取本身安全，但派生逻辑放 render 内保持纯 |

## 面试答法

Context 的本质是一套跨层级传值加广播更新的机制：`createContext` 返回的 context 对象上带一个 `_currentValue`，Provider 在 beginWork 时把新值压栈并改写 `_currentValue`，渲染完 children 后再 popProvider 恢复，后代无论多深都能通过 `useContext` 读到当前值。每个读过 context 的 fiber 会把消费关系记进 `fiber.dependencies.firstContext` 这条链表，Provider 的值用 `Object.is` 比较后发现变化，就会调用 `propagateContextChange` 从子节点沿 child 和 sibling 向下扫描，命中的 fiber 就合并 lanes 并在祖先路径上调度更新，遇到嵌套的同类型 Provider 则停止下探让它自己传播。这套机制最大的性能陷阱是它按 context 而不是按字段广播，所以只要 value 引用变了，所有消费者都会被标记重渲染，内联一个对象字面量当 value 这种写法每次都生成新对象，必然拖垮整片子树。优化上通常用 useMemo 稳定 value 引用、按变化频率拆分多个 context、把状态下沉并用 children 提升稳定子树，并且要知道 React.memo 挡不住 context 触发的更新；React 19 还允许直接用 `<Context value>` 作 Provider，读取也可以换成 use(Context)。
