# Portals 传送门

## 先说一个真实的困惑

把弹窗直接写在卡片组件里，结果它被卡片的 `overflow: hidden` 切掉了半截，`z-index` 也压不过别的东西。于是你把它挪到 `document.body` 上，弹窗终于完整了——但紧接着又冒出两个诡异现象：

- 点击弹窗里的按钮，**卡片上绑的 `onClick` 竟然也触发了**；
- 弹窗里用 `useContext` 读主题色，**读到的还是卡片那一层 Provider 的值**。

DOM 明明已经搬到 `body` 上了，为什么行为还跟着原来的父组件走？

这就是 portal 的全部秘密：**它搬走的是"工位"，不是"人事关系"。** 组件的人（DOM 节点）去了别处办公，但汇报线（React 树的 `return` 指针）还挂在原来那个部门。

## 为什么非得把 DOM 搬走

普通组件的 DOM 一定是嵌在父组件 DOM 里的。Modal、Tooltip、Dropdown 这类浮层一旦这样嵌着，就会被父级的样式锁住：

| 父级样式 | 对浮层的影响 |
|---------|-------------|
| `overflow: hidden` / `auto` | 浮层超出父容器被裁剪，显示不全 |
| `z-index` | 只在同一层叠上下文内比较，浮层被别的兄弟节点压住 |
| `transform` / `filter` / `perspective` | 父级成为 containing block，`position: fixed` 相对父级而非视口定位 |
| `position: relative` + 层级 | 裁剪与层叠叠加，难以覆盖整个页面 |

这四把锁没有一把是靠调 CSS 能绕过去的，因为问题的根源是**DOM 的父子结构**。`createPortal` 给的出路就是：把 DOM 挂到别处（通常是 `document.body`），而组件在 React 树里的逻辑位置一动不动。

## createPortal 到底做了什么

```jsx
import { createPortal } from 'react-dom';

function Modal({ open, children, onClose }) {
  if (!open) return null;
  // 第一个参数：要渲染的内容（和普通 JSX 一样写）
  // 第二个参数：目标容器，必须是真实 DOM 节点
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal">{children}</div>
    </div>,
    document.body   // ← 这棵子树的 DOM 最终挂到 body 下，而不是父组件 DOM 里
  );
}
```

参数就三个：

| 参数 | 含义 |
|------|------|
| `children` | 任意可渲染内容（元素、字符串、数组等） |
| `container` | 真实 DOM 节点，作为子树的宿主 |
| `key` | 可选，作为该 portal 元素在列表中的标识 |

它返回的不是普通元素，而是一个**特殊的 React 元素**：`type` 指向 portal 标记。React 在 reconcile 时对它走单独一支逻辑——子树照常在 Fiber 树里协调，只是最后把 DOM 附加到 `container`，而不是父级 DOM。

什么时候该用它：

| 使用场景 | 为什么要用 portal |
|---------|------------------|
| Modal 弹窗 | 需要覆盖全屏，不受任何父级 overflow / z-index 影响 |
| Tooltip / Popover | 跟随触发元素定位，若被裁剪会显示不全 |
| Dropdown 菜单 | 常在滚动容器内，需脱离裁剪并正确叠在其他内容之上 |
| 全屏 Loading / 通知 | 固定在视口层级，不受局部 containing block 影响 |

## 工位搬了，汇报线没搬

这是 portal 最容易被忽略、也是面试最爱问的点。看两棵"树"：

```text
React 组件树（人事关系）              DOM 结构（实际工位）
App                                  body
├── Card                             ├── #root
│   └── Modal (createPortal)         │   └── div.card
│       └── 逻辑上仍是 Card 的孩子   │       └── ...（卡片内容）
└── 其它                             └── div.modal-backdrop  ← portal 挂到这里
                                         └── div.modal
                                             └── ...（Modal 内容）
```

- React 树里：Modal 依然是 `Card` 的子 Fiber，`return` 指针指向 Card；
- DOM 树里：Modal 的 DOM 附加在 `document.body` 下，与 `#root` 平级，Card 的 DOM 根本不含它。

所以结论不是"portal 会脱离父组件"，恰恰相反——**它只脱离了 DOM，没脱离 React**。由此直接推出两件事：事件冒泡按 React 树走，context 照常生效。下面分别验证。

## 事件冒泡：不认工位，只认汇报线

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

所以哪怕弹窗的 DOM 挂在 `body` 上、Card 的 DOM 根本不包含它，Card 上的 `onClick` 照样会响：

```jsx
function Card() {
  return (
    <div onClick={() => console.log('Card 被点击')}>
      <Modal open>...</Modal>
    </div>
  );
}
// 点击 Modal 内部，仍会打印「Card 被点击」
// 因为合成事件沿 React 树冒泡，而不是沿 DOM 树
```

反过来，如果想做"点击弹窗外部关闭"，就**不能**指望冒泡路径——"外部"是按 DOM 位置说的。只能自己在监听里判断：

```jsx
// 用 event.target 判断点击点是否落在弹窗 DOM 内
function onDocClick(e) {
  if (!modalRef.current?.contains(e.target)) close();
}
```

因为 React 的冒泡路径并不反映真实 DOM 位置，这条判断必须按 DOM 结构来写。

## context：部门共享的配置照样读得到

人事关系没变，所以 portal 里的组件照常能读到 React 树上祖先提供的 context：

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

机制上，React 在 reconcile 时把 context 依赖记录在 Fiber 的 `dependencies` 上，取值只沿 Fiber 的 `return` 链向上找 Provider，**和 DOM 挂在哪儿完全无关**。

## SSR 时搬不了家

`react-dom/server` 不支持 portal：服务端渲染遇到 `createPortal` 会直接报错（Portals are not currently supported by the server renderer）。原因很直白——服务端没有真实 DOM，`document.body` 这个"目的地"压根不存在。

标准规避方式是"等客户端挂载完成后再渲染 portal"：

```jsx
function ClientOnlyModal(props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);   // 只在客户端执行，挂载后翻成 true
  // 首屏（含 SSR）返回 null，客户端水合完成后再渲染 portal
  return mounted ? <Modal {...props} /> : null;
}
```

这样服务端输出的 HTML 里不含 portal 内容，客户端挂载后再由 `useEffect` 打开，避免水合不一致（hydration mismatch）。

## 和 Vue 的 Teleport 比一比

Vue3 用 `<Teleport to="body">` 实现同类能力，思路完全一致（DOM 换位置、逻辑位置不变），但细节有关键差异：

| 维度 | React Portal | Vue Teleport |
|------|-------------|--------------|
| API | `createPortal(children, container)` | `<Teleport to="#target">` |
| 目标容器 | 传入真实 DOM 节点 | CSS 选择器或元素，`disabled` 可临时禁用 |
| 事件冒泡 | 沿 React 树传播（合成事件） | 沿 DOM 树传播（原生事件） |
| context / 依赖注入 | 照常生效 | provide / inject 照常生效 |
| SSR | 不支持，需客户端条件渲染 | 支持，用标记占位、水合后搬运 |
| 多目标 | 需手写多个容器 | 同一容器多次传送按渲染顺序拼接 |

最要命的差异是事件冒泡那一行：React 绑的是合成事件，冒泡走 Fiber 树；Vue 绑的是原生监听器，冒泡走真实 DOM 树。所以在 Vue 里，Teleport 出去的内容触发的事件，**不会**冒泡到原逻辑父级的 DOM 监听器（除非它恰好也在 DOM 祖先链上）。

## 几个追问

- portal 里的组件更新会怎样？照常。更新沿 Fiber 树的 `return` 链向上传到根，React 在 commit 阶段把变化写到对应的 `container` 里。
- 能传送到多个容器吗？可以，多次调用 `createPortal` 指向不同容器，作为同一父组件的不同子节点。
- 会影响 key / 列表 diff 吗？会。portal 是一个独立的 element 类型，在同一父节点下的子节点比对中，它按 `key + type` 参与匹配。
- portal 元素的 ref 指向什么？指向其子树渲染出的 DOM，**不是** `container`。

## 面试答法

createPortal 的作用是把子树的 DOM 挂到别的地方，通常是 document.body，让 Modal、Tooltip、Dropdown 这类浮层摆脱父级的 overflow 裁剪、z-index 层叠上下文和 transform 造成的 containing block 限制，但它在 React 树里的逻辑位置完全不变，也就是只搬 DOM、不搬逻辑。正因如此，祖先组件提供的 context 依然能被子树读到，事件也会沿 Fiber 树的 return 指针冒泡，所以哪怕弹窗 DOM 挂在 body 上、父组件 DOM 并不包含它，父组件的 onClick 仍会触发，这是 React 合成事件和原生 DOM 冒泡最大的区别，想判断点击是否在弹窗外部只能靠 event.target 按 DOM 结构判断。另外 react-dom/server 不支持 portal，服务端遇到 createPortal 会报错，常规做法是用 useEffect 判断已挂载后再在客户端渲染，避免水合不一致。对照 Vue 的 Teleport：思路同样是 DOM 换位置、逻辑不变，但 React 事件走 React 树，Vue 原生事件走真实 DOM 树，且 Vue 的 Teleport 在 SSR 下可以直接用。
