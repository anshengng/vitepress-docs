# TypeScript 面试要点

## 题目

> interface 和 type 有什么区别，怎么选？泛型约束怎么写，extends 在类型里是什么意思？联合类型和交叉类型分别解决什么问题？类型收窄有哪些手段，自定义类型守卫怎么写？能手写 Partial/Pick/Omit/ReturnType 吗？any、unknown、never 的区别？什么是协变和逆变？

## 为什么需要

TypeScript 的核心价值一句话：**把"运行时才暴露的意图错误"提前到编译期**。

```
JS 的困境：            函数签名不携带信息
  format(user)         ──► 传错字段？上线才知道

TS 的解法：            类型即契约
  function format(user: { name: string; age?: number })
  format({ nmae: 'x' }) ──► 编译期红线：属性 nmae 不存在

类型系统三支柱：
  ① 基础标注/推断   ② 组合（联合/交叉/泛型）   ③ 推导与收窄（控制流分析）
```

面试考察的是：你会不会用**类型语言表达约束**，而不是只会 `: string`。

## 核心要点

### 1. interface vs type

```typescript
// interface：声明"对象长什么样"，天然面向契约
interface User {
  name: string
  age?: number          // 可选
  readonly id: number   // 只读
}

// type：类型别名，能表示一切类型（联合/元组/函数/映射…）
type ID = string | number
type Pair = [number, string]
type Handler = (e: Event) => void
type User2 = { name: string }   // 也能写对象形状
```

| 维度 | interface | type |
| --- | --- | --- |
| 扩展 | `extends` 继承，多声明**自动合并** | 交叉 `&` 组合，同名声明**冲突报错** |
| 表达范围 | 仅对象/函数/构造器形状 | 任意类型（联合、元组、条件类型…） |
| 计算属性/映射 | 不能 | 可以（`[K in keyof T]`） |
| 错误提示 | 显示接口名，更友好 | 复杂别名有时展开为匿名结构 |
| 性能 | 编译器对 interface 有缓存优化 | 大型交叉类型展开成本高 |

选型口诀：**公共 API/库的契约用 interface（可合并、语义是"能力"）；需要联合/元组/条件/映射等类型运算用 type**。团队内统一即可，不必教条。

### 2. 泛型与约束

泛型 = **类型的函数参数**：调用时才把具体类型"代入"。

```typescript
// T extends U：约束——T 必须"至少是 U 的形状"
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key]   // 返回类型精确到 T[K]，而不是 any
}
const p = { a: 1, b: 'x' }
getProperty(p, 'a')      // ✔ number
getProperty(p, 'c')      // ✘ "c" 不在 keyof T
```

约束的常用姿势：

```typescript
type HasLength = { length: number }
function first<T extends HasLength>(x: T) { return x[0] } // 只依赖 length 能力
function cast<T>(x: unknown): T { return x as T }          // 无约束=任意类型
type Awaited2<T> = T extends Promise<infer R> ? R : T      // 条件类型 + infer 提取
```

### 3. 联合类型与交叉类型

```typescript
// 联合 A | B：值"是其中之一"——用于多态入参/状态
type Status = 'idle' | 'loading' | 'success' | 'error'  // 字面量联合=枚举替代品
type Resp = { data: any } | { error: string }

// 交叉 A & B：值"同时满足两边"——用于 mixin/组合
type Named = { name: string }
type Aged  = { age: number }
type Person = Named & Aged   // { name; age }
```

```
集合直觉：
联合 = 并集：  值 ∈ A ∪ B        （收窄后才能安全访问成员）
交叉 = 交集：  值 ∈ A ∩ B        （两边属性都要有；冲突属性变 never）
```

### 4. 类型收窄（Narrowing）

TS 的控制流分析会**沿代码执行路径自动缩小类型**：

```typescript
function process(input: string | number | User) {
  if (typeof input === 'string') {
    input.toUpperCase()          // 此处 input: string（typeof 收窄）
  } else if (typeof input === 'number') {
    input.toFixed(2)             // number
  } else if ('name' in input) {  // in 收窄：有 name 属性 → User
    input.name
  }
  // 真值判断、=== 比较、Array.isArray 同样可收窄
}

// 自定义类型守卫：函数返回 "x is T" 谓词，把判断逻辑复用出去
interface Cat { meow(): void }
interface Dog { bark(): void }
function isCat(a: Cat | Dog): a is Cat {   // ← 关键：a is Cat
  return 'meow' in a
}
declare const pet: Cat | Dog
if (isCat(pet)) pet.meow()                  // ✔ 守卫后收窄为 Cat
else pet.bark()                             // ✔ 自动取反收窄为 Dog
```

其他手段：可辨识联合（discriminated union，靠 `type: 'a'|'b'` 字面量字段 switch 收窄）、断言函数 `asserts x is T`、`satisfies` 运算符（校验兼容但不拓宽类型）。

### 5. 工具类型手写（高频必考）

```typescript
// Partial：全部属性变可选 —— 映射 + in keyof + ?修饰
type MyPartial<T> = { [K in keyof T]?: T[K] }

// Pick：从 T 中挑出 K 这些键
type MyPick<T, K extends keyof T> = { [P in K]: T[P] }

// Omit：先 keyof 取全部键，再用 Exclude 减掉 K
type MyOmit<T, K extends keyof any> =
  MyPick<T, Exclude<keyof T, K>>

// ReturnType：条件类型 + infer 捕获函数返回类型
type MyReturnType<T extends (...args: any) => any> =
  T extends (...args: any) => infer R ? R : never

// 配套常考：
type MyReadonly<T> = { readonly [K in keyof T]: T[K] }
type Exclude<T, U> = T extends U ? never : T   // 联合中剔除
type Extract<T, U> = T extends U ? T : never   // 联合中保留
type NonNullable<T> = T extends null | undefined ? never : T
```

```
MyPartial<{a: string, b: number}> 展开流程：

 keyof T ──► 'a' | 'b'
   │
   ▼ [K in 'a'|'b'] 逐个生成
 { a?: string, b?: number }     ← ? 让每个属性可选
```

### 6. any / unknown / never

| | any | unknown | never |
| --- | --- | --- | --- |
| 定位 | 关闭类型检查（后门） | 类型安全的 any（顶部类型） | 底部类型（不可能有值） |
| 能赋给别的类型吗 | 能，任意操作 | 不能，必须先收窄 | 能赋给任何类型 |
| 典型场景 | 迁移逃生舱、明确放弃检查 | JSON.parse、catch 参数 | 抛异常函数返回类型、穷尽检查 |

```typescript
function fatal(): never { throw new Error() }   // 永不正常返回
type NotBool = boolean extends never ? 1 : 0    // never 是"空联合"

// never 的杀手锏：穷尽检查
type Action = { k: 'add' } | { k: 'del' }
function run(a: Action) {
  switch (a.k) {
    case 'add': return 1
    case 'del': return 2
    default: ((x: never) => x)(a)  // 新增分支忘处理时 a 非 never → 编译报错
  }
}
```

### 7. 协变与逆变（简述）

函数/容器类型在"子类型替换"时的方向规则：

```
协变(同向)：     子类型可出现在"产出"位置   Dog→Animal 则 Dog[]→Animal[]
逆变(反向)：     子类型只能出现在"消费"位置 (a: Animal)=>void 可当 (a: Dog)=>void 用
                                     （能吃 Animal 的函数必然能吃 Dog）

TS 对函数参数默认"双变"（历史兼容妥协），strictFunctionTypes 下启用逆变；
对象属性/返回值协变。面试答到"产出协变、消费逆变"即可。
```

## 面试答法

### 30 秒版（可背诵）

> TS 用类型在编译期表达约束。interface 和 type 的区别：interface 只能描述对象形状但可声明合并、适合公共契约；type 能表示联合、元组、条件等一切类型运算。泛型是类型的参数，extends 做约束，配合 keyof、infer 能写出精确的推导，比如 getProperty 用 K extends keyof T 保证 key 合法。联合类型表示"多选一"，要靠 typeof、in、可辨识字段或自定义 `x is T` 类型守卫收窄后才能安全访问；交叉类型是属性合并。工具类型本质都是映射类型：Partial 是 [K in keyof T]?，Pick 按键挑选，Omit 是 Pick + Exclude，ReturnType 用条件类型 infer 捕获返回。any 关闭检查、unknown 是安全顶部类型必须先收窄、never 是底部类型用于穷尽检查。函数类型遵循"产出协变、消费逆变"，TS 参数默认双变是兼容妥协。

### 深入版（被追问时按编号展开）

1. **interface/type 对比表**：声明合并 vs 冲突报错、表达范围、性能差异，给选型口诀
2. **泛型约束**：`K extends keyof T` 经典题 + 条件类型 infer 提取
3. **联合/交叉集合图**：并集需收窄、交集要全满足；冲突属性变 never
4. **收窄四板斧**：typeof → in → 可辨识联合 switch → 自定义守卫 `a is Cat`
5. **手写工具类型**：现场写 Partial/Pick/Omit/ReturnType，展示展开流程
6. **any/unknown/never 表**：强调 unknown 必须收窄、never 做穷尽检查的用法
7. **协变逆变**：用"能吃 Animal 的函数一定能吃 Dog"讲清消费位置逆变

### 常见追问

- **`<T,>(x: T)` 里的 T 怎么推断出来的？** → 调用时按实参位置反推（协变推断）；推不出/推宽时可显式传 `f<string>(x)` 或加约束
- **interface 能继承 type 吗？** → 可以：type 声明的对象形状可被 interface extends；反之 type 也能交叉 interface；只有 type 的联合/函数别名 interface 继承不了
- **as 断言和 satisfies 的区别？** → as 是"我说了算"会绕过检查；satisfies 校验兼容性同时保留字面量推断精度
- **为什么 unknown 比 any 安全？** → any 可赋值给一切且任意调用不报错；unknown 只能赋给一切，但使用前必须收窄，错误不会扩散
- **`{ [K in keyof T]: T[K] }` 和 `{ [K in keyof T]?: T[K] }` 差在哪？** → 后者加 `?` 修饰符生成可选属性，即 Partial；还可加 `-?` 移除可选
- **泛型默认值和边界怎么写？** → `T = string` 给默认；`T extends any[]` 约束数组；递归泛型如 DeepPartial 注意 TS 的惰性求值避免无限展开
