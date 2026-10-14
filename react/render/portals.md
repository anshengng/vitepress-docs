# Portals 传送门

## 核心思路

普通组件的 DOM 会嵌套在父组件 DOM 内部。但 Modal、Tooltip、Dropdown 这类浮层如果直接嵌套，会被父级容器限制：

| 父级样式 | 对浮层的影响 |
|---------|-------------|
| `overflow: hidden` / `auto` | 浮层超出父容器被裁剪，显示不全 |
| `z-index` | 只在同一层叠上下文内比较，浮层被别的兄弟节点压住 |
| `transform` / `filter` / `perspective` | 父级成为 containing block，`position: fixed` 相对父级而非视口定位 |
| `position: relative` + 层级 | 裁剪与层叠叠加，难以覆盖整个页面 |

`createPortal` 提供一条出路：把 DOM 挂到别处（通常是 `document.body`），但组件在 React 树里的逻辑位置保持不变。DOM 逃出了父级样式约束，逻辑上仍然是那个父组件的子节点。

## 基本用法

```jsx
import { createPortal } from 'react-dom';

function Modal({ open, children, onClose }) {
  if (!open) return null;
  // 第一个参数是要渲染的内容，第二个参数是目标容器 DOM
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal">{children}</div>
    </div>,
    document.body
  );
}
```

`createPortal(children, container, key?)` 的参数：

| 参数 | 含义 |
|------|------|
| `children` | 任意可渲染内容（元素、字符串、数组等） |
| `container` | 真实 DOM 节点，作为子树的宿主 |
| `key` | 可选，作为该 portal 元素在列表中的标识 |

它返回的是一个**特殊的 React 元素**：`type` 指向 portal 标记。React 在 reconcile 时对它走单独逻辑——把子树的 DOM 附加到 `container`，而不是父级 DOM。

| 使用场景 | 为什么要用 portal |
|---------|------------------|
| Modal 弹窗 | 需要覆盖全屏，不受任何父级 overflow / z-index 影响 |
| Tooltip / Popover | 跟随触发元素定位，若被裁剪会显示不全 |
| Dropdown 菜单 | 常在滚动容器内，需脱离裁剪并正确叠在其他内容之上 |
| 全屏 Loading / 通知 | 固定在视口层级，不受局部 containing block 影响 |

## 关键特性：DOM 位置不等于 React 树位置

这是 portal 最容易被忽略、也是面试最爱问的点。

```text
React 组件树（逻辑结构）              DOM 结构（真实结构）
App                                  body
├── Card                             ├── #root
│   └── Modal (createPortal)         │   └── div.card
│       └── 逻辑上仍是 Card 的孩子   │       └── ...（卡片内容）
└── 其它                             └── div.modal-backdrop  ← portal 挂到这里
                                         └── div.modal
                                             └── ...（Modal 内容）
```

- React 树里：Modal 依然是 `Card` 的子 Fiber，`return` 指针指向 Card；
- DOM 树里：Modal 的 DOM 被附加到 `document.body`，与 `#root` 平级，Card 的 DOM 并不包含它。

由此推出两个直接结论：事件冒泡按 React 树传播，context 照常生效。

## 事件冒泡沿 React 树而非 DOM 树

React 用的是合成事件：真实监听器只挂在根容器上，事件触发时 React 从触发节点出发，沿 Fiber 树的 `return` 指针向上收集监听器，依次调用，模拟出一套"冒泡路径"。

```text
点击 Modal 内部的按钮
      ↓ 真实 DOM 事件在浏览器里冒泡
      ↓ React 忽略这段 DOM 路径，改走 Fiber 树
从触发 Fiber 出发，沿 return 指针向上：
  button Fiber
      ↓ return
  Modal Fiber
      ↓ return   ← 虽然 Modal 的 DOM 挂在 body 上
  Card Fiber
      ↓ return
  App Fiber
      ↓ return
  null（到达根，冒泡结束）
```

所以即使 Modal 的 DOM 挂在 `document.body`，挂在 `Card` 或 `App` 上的 `onClick` 依然会被触发：

```jsx
function Card() {
  return (
    <div onClick={() => console.log('Card 被点击')}>
      <Modal open>...</Modal>
    </div>
  );
}
// 点击 Modal 内部，仍会打印「Card 被点击」，
// 因为合成事件沿 React 树冒泡，而不是沿 DOM 树
```

反过来，如果只是想"点击弹窗外部关闭"，需要自己判断 `event.target` 是否为背景元素——因为"外部"是按 DOM 位置说的，React 的冒泡路径并不反映 DOM 位置。

## context 照常生效

因为逻辑位置不变，portal 里的组件照常读取 React 树上祖先提供的 context：

```jsx
const ThemeContext = React.createContext('light');

function App() {
  return (
    <ThemeContext.Provider value="dark">
      <Card />
    </ThemeContext.Provider>
  );
}
// 无论 Modal 的 DOM 被传送到哪里，
// Modal 内部 useContext(ThemeContext) 仍得到 "dark"
```

React 在 reconcile 时把 context 依赖挂在 Fiber 的 `dependencies` 上，取值只沿 Fiber 的 `return` 链向上找 Provider，与 DOM 挂在何处完全无关。

## SSR 中的处理

`react-dom/server` 不支持 portal：服务端渲染遇到 `createPortal` 会直接报错（Portals are not currently supported by the server renderer），因为服务端没有真实 DOM，`document.body` 也不存在。

标准规避方式是"只在客户端挂载后再渲染 portal"：

```jsx
function ClientOnlyModal(props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // 首屏（含 SSR）返回 null，客户端水合完成后再渲染 portal
  return mounted ? <Modal {...props} /> : null;
}
```

这样服务端输出的 HTML 里不含 portal 内容，客户端挂载后再由 `useEffect` 打开，避免水合不一致（hydration mismatch）。

## 与 Vue Teleport 的对照

Vue3 用 `<Teleport to="body">` 实现类似能力，思路一致（DOM 换位置、逻辑位置不变），但行为有关键差异：

| 维度 | React Portal | Vue Teleport |
|------|-------------|--------------|
| API | `createPortal(children, container)` | `<Teleport to="#target">` |
| 目标容器 | 传入真实 DOM 节点 | CSS 选择器或元素，`disabled` 可临时禁用 |
| 事件冒泡 | 沿 React 树传播（合成事件） | 沿 DOM 树传播（原生事件） |
| context / 依赖注入 | 照常生效 | provide / inject 照常生效 |
| SSR | 不支持，需客户端条件渲染 | 支持，用标记占位、水合后搬运 |
| 多目标 | 需手写多个容器 | 同一容器多次传送按渲染顺序拼接 |

最关键的差异是事件冒泡那一行：React 的事件是合成事件，冒泡走的是 Fiber 树；Vue 绑定的是原生监听器，事件冒泡走的是真实 DOM 树。所以在 Vue 里，Teleport 出去的内容触发的事件不会冒泡到原逻辑父级的 DOM 监听器（除非它恰好也在 DOM 祖先链上）。

## 常见追问

- portal 里的组件更新会怎样？照常。更新沿 Fiber 树的 `return` 链向上传播到根，React 在 commit 阶段把变化写到对应的 `container` 里。
- 能传送到多个容器吗？可以，多次调用 `createPortal` 指向不同容器，作为同一父组件的不同子节点。
- portal 会影响 key / 列表 diff 吗？会。portal 是一个独立的 element 类型，在同一父节点下的子节点比对中，它按 key + type 参与匹配。
- portal 元素的 ref 指向什么？指向其子树渲染出的 DOM，而不是 container。

## 面试答法

createPortal 的作用是把子树的 DOM 挂到别的地方，通常是 document.body，用来让 Modal、Tooltip、Dropdown 这类浮层摆脱父级的 overflow 裁剪、z-index 层叠上下文以及 transform 造成的 containing block 限制，但它在 React 树里的逻辑位置完全不变。正因为逻辑位置不变，挂在祖先组件上的 context 依然能被子树读到，事件也会沿 Fiber 树的 return 指针冒泡，所以即使弹窗 DOM 挂在 body 上、父组件 DOM 并不包含它，挂在父组件上的 onClick 仍会触发，这正是 React 合成事件与 DOM 原生冒泡最大的区别。需要注意 react-dom/server 不支持 portal，服务端渲染遇到 createPortal 会报错，常规做法是先用 useEffect 判断已挂载，只在客户端渲染 portal，从而避免水合不一致。最后和 Vue 的 Teleport 对照：两者思路都是 DOM 换位置、逻辑位置不变，但 React 的合成事件沿 React 树冒泡，Vue 的原生事件沿真实 DOM 树冒泡，而且 Vue 的 Teleport 在 SSR 下是可直接使用的。
