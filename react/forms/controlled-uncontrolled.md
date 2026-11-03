# 受控组件与非受控组件

## 先说一个真实的困惑

给输入框绑了 `value`，却没写 `onChange`，然后发现：**一个字都敲不进去**。删也删不掉，像被冻住了。

更奇怪的是，同样的输入框，换个写法（只给 `defaultValue`）就能正常打字了。再换一个场景——切换用户后，表单里还残留着上一个用户填的内容。

这两个现象背后是同一个问题：**这个值到底归谁管？** 受控与非受控的区别，本质上就是"账本记账"还是"钱包自己装钱"。

- **受控**：每一笔钱进出都得先记到账本（state）上，钱包（DOM）显示的余额永远听账本的；
- **非受控**：钱直接进钱包（DOM），账本不管过程，只在月底盘点（提交）时打开钱包看一眼。

账本是唯一数据源的那一套，就是受控。

## 账本和钱包，两种记账方式

```tsx
// 受控：value + onChange，账本（state）是唯一数据源
function Controlled() {
  const [value, setValue] = useState('');
  return <input value={value} onChange={(e) => setValue(e.target.value)} />;
}

// 非受控：defaultValue 只定一次初值，之后钱包自己管
function Uncontrolled() {
  const ref = useRef<HTMLInputElement>(null);
  return <input defaultValue="" ref={ref} />; // 提交时读 ref.current.value
}
```

两条链路对比：

```text
受控：   用户输入 → onChange → setState → 重渲染 → input.value 由 state 决定
非受控： 用户输入 → DOM 自己维护值 → 提交时读 ref.current.value（不触发重渲染）
```

受控那条链路里有个必须记住的点：**`value` 的值是 React 每次渲染时"写"进 DOM 的**。所以你敲了键，DOM 先变，`onChange` 把值送进 state，state 变了再渲染，React 又把 `value` 写回 DOM。少了 `onChange` 这一环，state 永远不变，React 每次都把旧值写回去——这就是"敲不进去"的机制原因，不是浏览器抽风。

非受控里的 `defaultValue` 只在首次挂载时写一次，之后 DOM 自己维护，React 不再插手。

## 一张表看清两种做法

| 维度 | 受控 | 非受控 |
|------|------|----------|
| 数据来源 | React state（唯一数据源） | DOM 自身 |
| 每次输入 | setState → 重渲染 | 不触发重渲染 |
| 值校验时机 | 输入即时可校验 / 格式化 | 提交时读值校验 |
| 动态设置值 | setState 即可改 | 需直接操作 DOM / 重置 |
| 与第三方或 DOM 集成 | 需桥接 | 天然直接 |
| 代码量 | 多（change 处理 + state） | 少 |
| 条件联动 | 实时联动方便 | 不便 |
| 初值 | `value` | `defaultValue` |
| 提交取值 | 直接读 state | 读 ref / 表单 |
| 文件 input | 不可用 | 只能非受控 |

## 账本模式的代价：每敲一个键都要记一笔

受控组件每次按键都会 `setValue` → 触发一次渲染。如果一个页面里表单很大，或者每次输入都要做昂贵计算（比如过滤一个巨大的列表），就会明显卡顿。

```tsx
// 每次输入都重渲染整个大列表，并且同步跑一遍 filterHuge
function Search() {
  const [q, setQ] = useState('');
  const results = filterHuge(q); // 同步昂贵
  return (
    <>
      <input value={q} onChange={(e) => setQ(e.target.value)} />
      <List items={results} />
    </>
  );
}
```

常见的几种解法：

```tsx
// 用 useDeferredValue：输入框保持受控跟手，列表降级到低优先级渲染
function Search() {
  const [q, setQ] = useState('');
  const deferredQ = useDeferredValue(q);                      // 值跟着走，但更新优先级更低
  const results = useMemo(() => filterHuge(deferredQ), [deferredQ]); // 只有降级后的值变了才重算
  return (
    <>
      <input value={q} onChange={(e) => setQ(e.target.value)} />
      <List items={results} />
    </>
  );
}
```

| 优化 | 做法 | 适用 |
|------|------|------|
| `useDeferredValue` | 降级昂贵的派生渲染 | 输入即时、列表可慢 |
| `useTransition` | 把 setState 标记为非紧急 | 同上，且能拿到 `isPending` |
| 下移 state | 把输入 state 放进最小的子组件 | 避免父组件整体重渲染 |
| `React.memo` + 拆分 | 让输入只影响局部 | 输入区与展示区可分离 |
| 受控转非受控 | 大表单只在提交时读值 | 无需实时联动的表单 |

关键点：真正的问题不是「受控」这个模式本身，而是**state 放在哪里、每次输入牵连多少组件重渲染**。把输入 state 下移到只包输入框的组件，重渲染就局部化了，账本不用管整栋楼。

## React 19 的 Action：只在提交时盘一次账

React 19 的表单 Action（`<form action={fn}>`）以 `FormData` 提交，天然更亲近**非受控**表单：字段值由 DOM 维护，提交时用 `formData.get(name)` 读取，不需要一个字段一个 state。

```tsx
function Profile() {
  async function save(formData) {
    await api.save({ name: formData.get('name') }); // 直接读表单值
  }
  return (
    <form action={save}>
      <input name="name" defaultValue="" /> {/* 非受控即可，不用 onChange */}
      <button>保存</button>
    </form>
  );
}
```

要点：

- Action 提交完成后，React 会**自动重置非受控字段**（原生表单行为）。
- 需要 pending / 错误状态时配 `useActionState`、`useFormStatus`（详见 [React 19 新特性](/react/modern/react19)）。
- 受控表单仍然完全可用，只是 Action 让「非受控 + 提交」变得顺手。
- 需要即时校验或条件联动的场景，受控依旧更合适。

## 文件 input：钱包是锁着的

出于安全，浏览器不允许用脚本设置 `<input type="file">` 的 `value`（只能清空）。所以"账本"这条路直接走不通，文件上传必须用 ref 读取 DOM：

```tsx
function Upload() {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input type="file" ref={ref} />
      <button onClick={() => console.log(ref.current?.files?.[0])}>读取</button>
    </>
  );
}
```

## 四个常见的坑

| 现象 | 原因 | 处理 |
|------|------|------|
| 输入框打不了字 | 给了 `value` 却没接 `onChange`，被当成只读 | 补 `onChange`，或显式 `readOnly` |
| 值改不动 | 非受控误用了 `value` 而非 `defaultValue` | 非受控一律用 `defaultValue` |
| 切换对象后残留旧值 | 同位置复用组件，DOM 值没有重置 | 用 `key` 强制重建，或手动重置 |
| 受控警告 | 传了 `value` 但更新入口缺失 | 补齐双向绑定 |

第三条值得展开——"同位置复用"意味着换了数据但组件还是同一个，DOM 里的值自然留着。给个 `key` 相当于换一个钱包：

```tsx
// key 变了 → React 卸载旧组件、挂载新组件 → 非受控字段自然清空
<ProfileForm key={user.id} user={user} />
```

## 怎么选

```text
需要即时校验 / 格式化 / 条件联动 / 实时预览   → 受控
表单很大且只在提交时取值                     → 非受控
集成第三方 DOM 组件 / 直接操作 DOM            → 非受控
文件上传                                    → 非受控（强制）
React 19 + 服务端 Action 提交                → 非受控更省事
性能敏感且输入频繁                           → 受控 + useDeferredValue / 局移 state
```

经验上：默认用受控（便于推理与校验）；一旦发现重渲染是瓶颈，再按上表下移 state 或改非受控，而不是一开始就牺牲可维护性。

## 面试答法

受控组件的值由 React state 掌管，用 value 加 onChange 让 state 成为唯一数据源，每次输入都会 setState 触发重渲染；非受控组件用 defaultValue 给初值，之后值存在 DOM 里自己维护，只在提交时通过 ref 读取。受控的优势是能即时校验、格式化和做条件联动，代价是每次按键都重渲染，在大表单或每次输入都做昂贵计算时容易卡，所以真正的性能关键不是受控本身，而是 state 放在哪里、牵连多少组件重渲染，可以用 useDeferredValue 降级昂贵派生渲染、useTransition 标记非紧急更新、把 state 下移到最小子组件，或在不需要实时联动时干脆改非受控。React 19 的表单 Action 以 FormData 提交，让「非受控 + 提交」变得顺手，提交后还会自动重置非受控字段，配合 useActionState、useFormStatus 管理 pending 和错误。另外文件 input 因安全限制只能非受控，必须用 ref 读取；切换数据时可以用 key 强制重建来清掉残留值。选型上一般默认受控，性能敏感时再按需下移 state 或改非受控。
