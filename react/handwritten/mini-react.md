# 手写迷你 React（原理串联）

## 目标

把前面各篇拆开讲的机制压成一个最小实现，串起整条链路：

```text
createElement → element（$$typeof / type / props / key）
      ↓
render(element, container) → 建 Fiber + 双缓冲（alternate）
      ↓
workLoop（performUnitOfWork → beginWork / completeUnitOfWork）
      ↓ 简单 diff（同 type 复用、key 匹配）
commit（按 flags 把 Fiber 变化映射成 DOM 操作）→ 真实 DOM + hooks 状态
```

真实 React 远复杂于此（Lane 抢占、时间切片、Context、事件系统、SSR 等），这里只保留主干，结尾列出被省略的部分。

## 第一步：createElement 产出 element

JSX 编译后会调用 `createElement`（新版编译为 `jsx` / `jsxs`），产出不可变的普通对象：

```typescript
const REACT_ELEMENT = Symbol('react.element');

function createElement(type, props, ...children) {
  const { key = null, ...rest } = props ?? {};
  return {
    $$typeof: REACT_ELEMENT,               // Symbol 标记元素身份，防伪造
    type,                                  // 'div' 或组件函数
    key,                                   // 单独提出，供 diff 匹配
    props: { ...rest, children: children.length === 1 ? children[0] : children },
  };
}
```

`$$typeof` 用 Symbol 标记身份，React 靠它校验元素合法性；element 只描述、不持有状态，每次 render 都重新创建。

## 第二步：Fiber 结构与双缓冲

Fiber 用三指针表达树结构，用 `alternate` 表达双缓冲：

```typescript
interface Fiber {
  tag: 'host' | 'function';
  type: string | Function;
  key: string | null;
  props: Record<string, unknown>;
  stateNode: Node | null;                  // 真实 DOM（host 节点）
  return: Fiber | null;                    // 父节点
  child: Fiber | null;                     // 第一个子节点
  sibling: Fiber | null;                   // 下一个兄弟
  alternate: Fiber | null;                 // 双缓冲：指向另一棵树的对应节点
  flags: number;                           // 副作用标记
  hooks: Hook[] | null;                    // 函数组件：Hooks 数组
}
const PLACEMENT = 1, UPDATE = 2, DELETION = 4;

let wipRoot = null, currentRoot = null;                    // 正在构建的根 / 已提交的根
let nextUnitOfWork = null, wipFiber = null, hookIndex = 0; // 工作单元 / 函数组件 / 游标
let pendingEffects: Array<() => void | (() => void)> = [];
```

```text
Fiber 树（child / sibling / return）        双缓冲
  App(return=null)                          current 树 ←→ workInProgress 树
   │ child                                     ↑ alternate 互指
   ↓                                         构建完切换 currentRoot 即提交
 div(return=App)
   │ child            sibling
   ↓                  ↓
 h1(return=div)  →  p(return=div) → null
                       │ child
                       ↓
                    text(return=p)
```

`alternate` 是双缓冲的锚点：更新时为 current 上的 Fiber 新建 workInProgress 节点，两者 `alternate` 互指，构建完成后整体切换 `currentRoot`。

## 第三步：render 与工作循环

```typescript
function render(element: ReactElement, container: Node) {
  wipRoot = createFiber(element);
  wipRoot.tag = 'host';
  wipRoot.stateNode = container;           // 根的宿主即传入容器
  nextUnitOfWork = wipRoot;
  workLoop();
}

function workLoop() {
  while (nextUnitOfWork) nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
  if (wipRoot) {
    commitRoot(wipRoot);                   // 构建完 → 提交
    currentRoot = wipRoot;                 // 切换 current
    wipRoot = null;
  }
}

function performUnitOfWork(fiber: Fiber): Fiber | null {
  beginWork(fiber);                        // 向下：创建 / 复用子节点
  if (fiber.child) return fiber.child;     // 深度优先，先深入第一个孩子
  let next: Fiber | null = fiber;
  while (next) {                           // 无子节点 → 归并并找兄弟
    completeUnitOfWork(next);
    if (next.sibling) return next.sibling;
    next = next.return;
  }
  return null;
}
```

对应真实 React：`beginWork` 负责"本节点要做什么"（造子 Fiber、更新 props、跑 Hooks），`completeUnitOfWork` 负责"本节点收尾"（汇总子树变化）。

## 第四步：简单 diff——同 type 复用、key 匹配

```typescript
function createFiber(element: ReactElement): Fiber {
  return {
    tag: typeof element.type === 'function' ? 'function' : 'host',
    type: element.type, key: element.key, props: element.props,
    stateNode: null, return: null, child: null, sibling: null,
    alternate: null, flags: PLACEMENT, hooks: null,
  };
}
const cloneFiber = (old: Fiber, element: ReactElement): Fiber =>
  ({ ...old, props: element.props, flags: UPDATE, alternate: old });

function reconcileChildren(wipFiber: Fiber, children: ReactElement[]) {
  let oldFiber = wipFiber.alternate?.child ?? null;    // 旧子节点链表
  let prevSibling: Fiber | null = null;

  children.forEach((element, index) => {
    let newFiber: Fiber;
    const hit = oldFiber !== null &&
      oldFiber.type === element.type && oldFiber.key === element.key;
    if (hit) {
      newFiber = cloneFiber(oldFiber!, element);       // 命中：复用旧 Fiber
    } else {
      newFiber = createFiber(element);                 // 未命中：新建
      if (oldFiber) oldFiber.flags = DELETION;         // 旧节点标记删除
    }
    newFiber.return = wipFiber;
    if (index === 0) wipFiber.child = newFiber;               // 第一个当 child
    else if (prevSibling) prevSibling.sibling = newFiber;     // 其余用 sibling 串
    prevSibling = newFiber;
    if (oldFiber) oldFiber = oldFiber.sibling;
  });

  while (oldFiber) {                                   // 旧链表有剩 → 删除
    oldFiber.flags = DELETION;
    oldFiber = oldFiber.sibling;
  }
}
```

| 判定 | 结果 |
|------|------|
| type 相同 && key 相同 | 复用旧 Fiber（`cloneFiber`），`flags = UPDATE` |
| type 变（如 div → span） | 新建 Fiber，旧节点 `DELETION` |
| key 不同 | 视为不同节点，不复用 |
| 旧链表更长 | 剩余旧节点全部 `DELETION` |

`beginWork` 对宿主节点创建真实 DOM（`document.createElement`、初始化属性）再 `reconcileChildren`；对函数组件则重置 `wipFiber` / `hookIndex`、重建 Hooks 数组、执行组件函数取回 element 再 reconcile。真实 React 还有 `lastPlacedIndex` 判断"是否需要移动"（见 Diff 篇），迷你版只做同位置前后比对。

## 第五步：commit——把 Fiber 变化映射成 DOM 操作

```typescript
function commitRoot(root: Fiber) {
  commitWork(root.child);
  const effects = pendingEffects;           // 提交后统一执行本次登记的 effect
  pendingEffects = [];
  effects.forEach((cb) => cb());
  currentRoot = root;
}

function commitWork(fiber: Fiber | null) {
  if (!fiber) return;
  const parentDom = findParentDom(fiber);   // 沿 return 找最近的宿主 DOM
  if (fiber.flags & PLACEMENT && fiber.stateNode) {
    parentDom.appendChild(fiber.stateNode);              // 插入新节点
  }
  if (fiber.flags & UPDATE && fiber.stateNode) {
    updateDom(fiber.stateNode, fiber.alternate!.props, fiber.props);  // 更新属性
  }
  if (fiber.flags & DELETION && fiber.stateNode) {
    parentDom.removeChild(fiber.stateNode);              // 删除节点
  }
  fiber.flags = 0;
  commitWork(fiber.child);                  // 深度优先遍历整棵 workInProgress 树
  commitWork(fiber.sibling);
}
```

`updateDom` 负责具体属性写入：文本节点替换 `textContent`，普通节点先清掉旧 props 里新 props 没有的键，再写入变化的键（`onXxx` 转成 `addEventListener`），未变化的键直接跳过。要点：

- render 阶段只构建、不改 DOM；所有 DOM 操作集中在 commit，从而保证渲染可中断、可丢弃而不产生可见副作用；
- `flags` 与真实 React 的 `Placement / Update / Deletion` 一一对应，commit 就按这三类标记执行；
- 真实 React 的 commit 分 beforeMutation / mutation / layout 三阶段，迷你版简化为一次遍历。

## 第六步：简易 Hooks（数组 + 游标）

函数组件渲染时把 Hooks 状态存进 `fiber.hooks` 数组，用游标按调用顺序定位——对应真实的 `memoizedState` 链表加 `workInProgressHook` 游标。

```typescript
interface Hook { state: unknown; queue: Array<(p: unknown) => unknown>; deps?: unknown[]; cleanup?: () => void }

function useState<T>(initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const oldHook = wipFiber!.alternate?.hooks?.[hookIndex];   // 复用旧 hook
  const hook: Hook = {
    state: oldHook ? oldHook.state : initial,
    queue: oldHook ? [...oldHook.queue] : [],
  };
  hook.queue.forEach((a) => { hook.state = a(hook.state); });  // 重放队列

  const setState = (action: T | ((p: T) => T)) => {
    hook.queue.push(typeof action === 'function' ? (action as any) : () => action);
    wipRoot = { ...(currentRoot as Fiber), alternate: currentRoot, flags: UPDATE };
    nextUnitOfWork = wipRoot;                 // 触发整树重新渲染
    workLoop();
  };
  wipFiber!.hooks!.push(hook);
  hookIndex++;
  return [hook.state as T, setState];
}

function useEffect(callback: () => void | (() => void), deps?: unknown[]) {
  const oldHook = wipFiber!.alternate?.hooks?.[hookIndex];
  const changed = !oldHook || !deps || deps.some((d, i) => d !== oldHook.deps?.[i]);
  if (changed) {
    if (oldHook?.cleanup) oldHook.cleanup();   // 依赖变化 → 先跑上次的清理
    pendingEffects.push(callback);             // 渲染后统一执行
  }
  wipFiber!.hooks!.push({ state: null, queue: [], deps });
  hookIndex++;
}
```

- 游标 + 顺序定位：数组下标就是"第几个 Hook"，与真实链表按顺序消费等价，所以同样不能写在条件 / 循环里；
- 更新队列：`setState` 不直接改 state，而是 push 一个 updater，下次渲染时重放，这与 `useState` 的更新队列、批处理一致；
- 依赖比较：`deps.some((d, i) => d !== oldDeps[i])` 做浅比较，对应真实的 `areHookInputsEqual`；
- mount 时 `hooks` 置空、游标归零，Hooks 依次追加为 `hooks[0]`、`hooks[1]`；update 时同样清空并从 `alternate.hooks` 按序取旧 hook 复用，顺序一致则位置一一对应。

## 真实 React 的简化点

| 迷你版 | 真实 React |
|--------|-----------|
| 同步 while 循环跑完 | workLoop 用 `shouldYield` 做时间切片，让出主线程后从断点续跑 |
| 无优先级 | Lane 模型：SyncLane / TransitionLane 等，高优先级可插队、可丢弃低优先级 |
| 同位置比对 | 双指针线性扫描 + `lastPlacedIndex` 判定移动，另有 bailout 跳过整棵子树 |
| `flags` 三类标记 | `flags` / `subtreeFlags` 完整副作用标记体系 |
| hooks 用数组 + 游标 | `memoizedState` 链表 + `baseQueue` 处理被跳过的更新 |
| commit 一次遍历 | beforeMutation / mutation / layout 三阶段，配合 `useLayoutEffect` |
| 直接 appendChild | 处理插入 / 移动顺序、ref、DOM 复用与删除 |
| 无事件系统 / Context / SSR | 合成事件、Context 依赖、Suspense、Streaming SSR 等 |

## 面试答法

一个迷你 React 的主干就四步：createElement 把 JSX 变成带 $$typeof、type、props 和 key 的不可变 element；render 再把 element 转成 Fiber，Fiber 用 child、sibling、return 三个指针表示树结构、用 alternate 做双缓冲。接着是 workLoop 加 performUnitOfWork，beginWork 负责向下创建或复用子 Fiber、completeUnitOfWork 负责归并收尾，逐步搭出一棵 workInProgress 树。beginWork 里做的是最简单的 diff：新 element 和旧 Fiber 的 type 与 key 都相同就复用旧节点、只更新 props 并标记 Update，否则新建节点标 Placement、旧节点标 Deletion，等整棵树构建完，commit 阶段再按 flags 一次性把变化落成 DOM 的插入、更新、删除，这样 render 阶段不碰 DOM，才保证可中断可丢弃。Hooks 则用一个数组加游标模拟真实链表的顺序定位，useState 把更新 push 进队列、下次渲染时重放，useEffect 用依赖浅比较决定是否执行，所以不能写在条件或循环里。真实 React 在同一骨架上还多了 Lane 优先级抢占、时间切片、bailout 和完整的 commit 三阶段，这就是迷你版与工业实现之间的差距。
