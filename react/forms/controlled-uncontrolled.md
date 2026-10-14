# 受控组件与非受控组件

## 核心区别

受控组件的值由 React state 掌管（渲染什么由 state 决定）；非受控组件的值存在 DOM 里，React 只在需要时通过 ref 读取。

```tsx
// 受控：value + onChange，state 是唯一数据源
function Controlled() {
  const [value, setValue] = useState('');
  return <input value={value} onChange={(e) => setValue(e.target.value)} />;
}

// 非受控：defaultValue 定初值，ref 读 DOM
function Uncontrolled() {
  const ref = useRef<HTMLInputElement>(null);
  return <input defaultValue="" ref={ref} />; // 提交时读 ref.current.value
}
```

```text
受控：   用户输入 → onChange → setState → 重渲染 → input.value 由 state 决定
非受控： 用户输入 → DOM 自己维护值 → 提交时读 ref.current.value（不触发重渲染）
```

## 对比表

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

## 受控组件为何性能敏感

受控组件每次按键都会 `setValue` → 触发一次渲染；若表单很大，或每次输入都做昂贵计算（过滤大列表），就会卡。

```tsx
// 每次输入都重渲染整个大列表
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

优化手段：

```tsx
// 用 useDeferredValue：输入框保持受控跟手，列表降级到低优先级渲染
function Search() {
  const [q, setQ] = useState('');
  const deferredQ = useDeferredValue(q);
  const results = useMemo(() => filterHuge(deferredQ), [deferredQ]);
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

关键点：真正的问题不是「受控」，而是**state 放在哪里、每次输入牵连多少组件重渲染**。把输入 state 下移到只包输入框的组件，就能让重渲染局部化。

## React 19 表单 Action 的影响

React 19 的表单 Action（`<form action={fn}>`）以 `FormData` 提交，天然更亲近**非受控**表单：字段值由 DOM 维护，提交时用 `formData.get(name)` 读取。

```tsx
function Profile() {
  async function save(formData) {
    await api.save({ name: formData.get('name') }); // 直接读表单值
  }
  return (
    <form action={save}>
      <input name="name" defaultValue="" /> {/* 非受控即可 */}
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

## 文件 input 只能非受控

出于安全，浏览器不允许用脚本设置 `<input type="file">` 的 `value`（只能清空）。所以文件上传必须用 ref 读取。

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

## 常见坑与注意点

| 现象 | 原因 | 处理 |
|------|------|------|
| 输入框打不了字 | 给了 `value` 却没接 `onChange`，被当成只读 | 补 `onChange`，或显式 `readOnly` |
| 值改不动 | 非受控误用了 `value` 而非 `defaultValue` | 非受控一律用 `defaultValue` |
| 切换对象后残留旧值 | 同位置复用组件，DOM 值没有重置 | 用 `key` 强制重建，或手动重置 |
| 受控警告 | 传了 `value` 但更新入口缺失 | 补齐双向绑定 |

```tsx
// 用 key 让表单在切换对象时重建，清空非受控字段
<ProfileForm key={user.id} user={user} />
```

## 选择建议

```text
需要即时校验 / 格式化 / 条件联动 / 实时预览   → 受控
表单很大且只在提交时取值                     → 非受控
集成第三方 DOM 组件 / 直接操作 DOM            → 非受控
文件上传                                    → 非受控（强制）
React 19 + 服务端 Action 提交                → 非受控更省事
性能敏感且输入频繁                           → 受控 + useDeferredValue / 局移 state
```

经验：默认用受控（便于推理与校验）；一旦发现重渲染是瓶颈，再按上表下移 state 或改非受控，而不是一开始就牺牲可维护性。

## 面试答法

受控组件的值由 React state 掌管，用 value 加 onChange 让 state 成为唯一数据源，每次输入都会 setState 触发重渲染；非受控组件用 defaultValue 给初值，值存在 DOM 里，只在提交时通过 ref 读取。受控的优势是能即时校验、格式化和做条件联动，代价是每次按键都重渲染，在大表单或每次输入都做昂贵计算时容易卡，所以真正的性能关键不是受控本身，而是 state 放在哪里、牵连多少组件重渲染，可以用 useDeferredValue 降级昂贵派生渲染、用 useTransition 标记非紧急更新、把 state 下移到最小的子组件，或在不需要实时联动时干脆改非受控。React 19 的表单 Action 以 FormData 提交，让「非受控 + 提交」变得顺手，提交后还会自动重置非受控字段，配合 useActionState 与 useFormStatus 管理 pending 和错误，但受控表单依然完全可用。另外文件 input 因为安全限制只允许非受控，必须用 ref 读取。选型上一般默认受控，性能敏感时再按需下移 state 或改非受控。
