# TS 工具类型 Omit / Partial / Pick（含手写实现）

## 为什么需要

工具类型是 TS 面试的"手写题"重灾区：面试官要求**现场写出 Partial/Pick/Omit 的简化版源码**，考察你是否理解映射类型（`[K in keyof T]`）、修饰符（`?`、`readonly`）和 `Exclude` 的组合运用。实际意义：DTO/表单场景频繁需要"从完整类型派生子类型"（更新接口用 Partial、列表接口用 Pick、去掉 id 用 Omit），不手写会沦为只会查文档。

## 核心要点

### 1. 六个工具类型速查表

| 工具类型 | 作用 | 用法示例 |
| --- | --- | --- |
| `Partial<T>` | 全部属性变**可选** | `Partial<User>` → `{ id?; name?; email? }` |
| `Required<T>` | 全部属性变**必填**（去可选） | `Required<User>` → `{ tel: string }`（原 tel? 变必选） |
| `Readonly<T>` | 全部属性变**只读** | `Readonly<User>` → `{ readonly id; ... }` |
| `Pick<T, K>` | 只**保留** K 这些键 | `Pick<User, 'id' \| 'name'>` |
| `Omit<T, K>` | 只**排除** K 这些键 | `Omit<User, 'email' \| 'age'>` |
| `Record<K, T>` | 构造键值对映射类型 | `Record<string, number>` → `{ [key: string]: number }` |

```typescript
interface User { id: number; name: string; email: string; age: number }

// Partial：PATCH 接口——客户端可能只传部分字段
function updateUser(id: number, patch: Partial<User>) { /* ... */ }
updateUser(1, { name: 'liu' })        // ✔ 只传 name 合法

// Pick：列表接口只要精简字段
type UserBrief = Pick<User, 'id' | 'name'>       // { id: number; name: string }

// Omit：新增表单——id 后端生成、age 不展示
type NewUser = Omit<User, 'id' | 'age'>          // { name: string; email: string }

// Record：以用户 id 为键组织映射
const scoreMap: Record<string, number> = { a: 1, b: 2 }
```

### 2. 手写简化版源码（面试白板题）

```typescript
// ① Partial：遍历 T 的所有键，逐个加 ? 修饰符
type MyPartial<T> = { [K in keyof T]?: T[K] }
// 展开：MyPartial<{a: string}> → { a?: string }

// ② Required：-? 表示【移除】可选修饰符
type MyRequired<T> = { [K in keyof T]-?: T[K] }

// ③ Readonly：readonly 修饰符逐个贴上
type MyReadonly<T> = { readonly [K in keyof T]: T[K] }

// ④ Pick：K 约束为 T 的键的子集，只映射 K 里的键
type MyPick<T, K extends keyof T> = { [P in K]: T[P] }

// ⑤ 先备 Exclude：从联合类型 U 中剔除属于 K 的成员
type MyExclude<U, K> = U extends K ? never : U

// ⑥ Omit = keyof 取全部键 → Exclude 减掉不要的 → 交给 Pick
type MyOmit<T, K extends keyof any> = MyPick<T, MyExclude<keyof T, K>>
// 注意：K 约束是 keyof any（即 string|number|symbol），
// 允许传"不存在的键"也不报错，这是官方 Omit 与 Pick 的约束差异

// ⑦ Record：Keys 的每个键映射到类型 T
type MyRecord<Keys extends keyof any, T> = { [P in Keys]: T }
```

```
映射类型展开流程（MyPartial<{a: string; b: number}>）：

  keyof T ──► 'a' | 'b'
     │
     ▼  [K in 'a'|'b'] 逐个生成属性
  { a?: string; b?: number }     ← ? 修饰符让每个属性可选
```

### 3. 修饰符与组合技巧

| 语法 | 含义 |
| --- | --- |
| `[K in keyof T]` | 映射类型：遍历联合键生成新对象类型 |
| `?:` / `-?` / `+?` | 加可选 / 去可选 / 显式加（默认） |
| `readonly` / `-readonly` | 加只读 / 去只读 |
| `as K2` 键重映射 | `{ [K in keyof T as \`get_${string & K}\`]: T[K] }` 可改键名 |

```typescript
// 组合运用：只读 + 可选 + 派生
type SafeConfig = Readonly<Partial<Record<'host' | 'port', string | number>>>
```

## 面试答法

### 30 秒版本（可直接背诵）

> 工具类型都是"从已有类型派生新类型"的泛型，本质是映射类型加修饰符。Partial 把全部属性变可选，写法是 `[K in keyof T]?: T[K]`；Required 用 `-?` 去掉可选；Readonly 给每个属性贴 readonly；Pick 用 `K extends keyof T` 只保留指定键；Omit 是 Pick 加 Exclude——先 keyof T 拿全部键，Exclude 减掉要排除的键，再交给 Pick，注意 Omit 的 K 约束是 keyof any 而不是 keyof T；Record 把一组键统一映射到某类型，`Record<string, number>` 等价于索引签名。典型场景：PATCH 接口参数用 Partial，列表精简字段用 Pick，新增表单去掉后端生成的 id 用 Omit。

### 深入展开

1. **先给场景**：User 完整类型 → 更新接口 Partial、列表 Pick、新增 Omit、映射 Record，说明"派生"价值
2. **现场手写**：按 Partial → Required → Readonly → Pick → Exclude → Omit → Record 顺序写，边写边讲 `[K in keyof T]` 展开流程
3. **修饰符规则**：`?` 加、`-?` 减、`+?` 默认；readonly 同理；键重映射 `as`
4. **细节加分**：Omit 的 `K extends keyof any` 允许传不存在的键；官方 Omit 基于 `keyof any` 所以能排除任意字符串字面量
5. **收尾**：条件类型 infer、`as` 重映射可延伸出 DeepPartial 等递归工具类型

### 常见追问

- **Pick 和 Omit 怎么选？** → 保留的键少用 Pick（白名单），排除的键少用 Omit（黑名单）；Omit 对联合类型分配性差（Union 上会丢属性），优先 Pick
- **`[K in keyof T]?: T[K]` 里的 `?` 和写 `T[K] | undefined` 有何区别？** → `?` 是属性修饰符，影响赋值检查与 exactOptionalPropertyTypes；`| undefined` 只是值类型联合，属性仍必填
- **Required 能去掉 readonly 吗？** → 不能，`-?` 只去可选；去 readonly 需 `-readonly` 修饰符
- **Omit 对继承来的属性有效吗？** → 有效，keyof T 包含继承链上的全部可枚举键
- **手写 DeepPartial 思路？** → 递归：`T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T`，注意数组/Date 等特殊对象分支避免被拆坏
