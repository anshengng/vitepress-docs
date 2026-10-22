# TS 的作用、泛型与函数重载

## 为什么需要

三个考察点连成一条线：① **TS 为什么存在**——JS 弱类型把错误推迟到运行时，大型项目需要编译期契约；② **泛型**——类型层面的"参数化"，让同一套逻辑安全服务多种类型；③ **函数重载**——同一个函数在不同入参类型下有不同签名，表达"参数类型与返回类型的关联"。面试常要求现场写泛型函数、说约束语法、并对比"重载 vs 联合类型"怎么选。

## 核心要点

### 1. TS 的作用（为什么需要 TypeScript）

| 作用 | 说明 |
| --- | --- |
| 类型安全 | 编译期捕获拼写错字段、传错参数等错误（`nmae` 红线），而非上线才炸 |
| IDE 增强 | 自动补全、跳转定义、安全重构都靠类型信息驱动 |
| 可维护性/自文档 | 类型注解即契约，接口意图一目了然，新人接手成本低 |
| 现代 JS + 向下编译 | 支持 ES6+ 语法，可降级编译到目标 JS 版本 |
| 生态 | DefinitelyTyped 海量 @types 包，主流库均 TS 优先 |

```typescript
// 类型即契约：拼错字段在编译期暴露
function format(user: { name: string; age?: number }) { /* ... */ }
format({ nmae: 'x' })   // ✘ 编译报错：属性 nmae 不存在
```

### 2. 泛型（Generics）

泛型 = **类型的函数参数**：定义时用占位符 T，调用时传入/推断具体类型。

```typescript
// 不用泛型：要么 any 丢类型，要么每种类型写一遍
function identity<T>(x: T): T { return x }   // T 是类型参数
identity<string>('a')   // 显式指定，返回 string
identity(42)            // 自动推断 T = number

// 约束：T extends U —— T 必须"至少具备 U 的形状/能力"
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key]       // 返回类型精确到 T[K]，不是 any
}
const p = { a: 1, b: 'x' }
getProperty(p, 'a')     // ✔ number
getProperty(p, 'c')     // ✘ "c" 不在 keyof T

// 默认值 + 多约束
function createPair<T extends string, U = number>(a: T, b: U): [T, U] {
  return [a, b]
}

// 泛型接口 / 泛型类
interface Response<T> { code: number; data: T }
const res: Response<{ list: string[] }> = { code: 0, data: { list: [] } }
```

**内置泛型示例**（日常高频）：

```typescript
Array<number>              // 数组
Promise<User>              // Promise 的 resolve 值类型
Partial<Form>              // 全部属性可选（工具类型本质也是泛型）
Record<string, number>     // 键值对映射，等价于 { [key: string]: number }
ReturnType<typeof fn>      // 条件类型 + infer 捕获返回值
```

### 3. 函数重载（Overloading）

```typescript
// 两个"签名"声明对外契约，最后一个"实现签名"不对外暴露
function pick(x: number, y: number): number;      // 签名1
function pick(x: string, y: string): string;      // 签名2
function pick(x: any, y: any): any {              // 实现（调用时不可见）
  return x + y
}
pick(1, 2)          // ✔ 3（number）
pick('a', 'b')      // ✔ 'ab'（string）
pick(1, 'b')        // ✘ 两个签名都不匹配，报错

// 匹配规则：从上往下找【第一个】兼容的签名 → 特化签名要写在前面
function parse(v: string): Date;
function parse(v: string, fmt: string): string;
function parse(v: string, fmt?: string) { /* ... */ }
```

### 4. 重载 vs 联合类型（选型关键）

| 维度 | 函数重载 | 联合类型参数 |
| --- | --- | --- |
| 写法 | 多个签名 + 一个实现 | `function f(x: A \| B)` |
| 参数间关联 | **能表达**："第 1 参是 string 时第 2 参必须是 fmt" | 不能：A\|B 各自独立组合 |
| 返回类型随入参变 | 能（每个签名独立返回类型） | 需配合条件类型/类型守卫 |
| 调用方提示 | IDE 逐个列出签名 | 一个宽签名 |
| 实现内部 | 仍需类型守卫分支 | 同样需要守卫收窄 |
| 适用 | 少量固定"类型组合"契约 | 参数彼此独立、逻辑相同 |

```typescript
// 联合类型表达不了的"关联"，重载可以：
function add(a: number, b: number): number;
function add(a: string, b: string, sep: string): string;  // 第3参只在 string 组合下存在
```

## 面试答法

### 30 秒版本（可直接背诵）

> TS 的价值是把 JS 运行时才暴露的意图错误提前到编译期，同时带来 IDE 补全、重构和自文档化。泛型是"类型的参数"：定义函数、接口时用 T 占位，调用时传入或自动推断，配合 extends 做约束，比如 K extends keyof T 保证 key 合法，Partial、Record、`Promise<T>` 都是内置泛型。函数重载是同一函数声明多个签名，按参数类型或数量匹配不同契约，写实现签名兜底、匹配从上往下所以特化在前。和联合类型的区别：联合类型适合参数彼此独立的情况，重载能表达"参数类型之间的关联"以及"返回类型随入参变化"，这是联合类型做不到的。

### 深入展开

1. **TS 作用**：编译期契约 + IDE + 可维护性，举一个 `nmae` 拼写红线例子即可
2. **泛型三件套**：基本语法 `<T>` → 约束 `T extends U`（keyof 经典题）→ 默认值；点出"泛型=类型层的函数复用"
3. **内置泛型**：Array/Promise/Partial/Record/ReturnType 各举一例，说明工具类型都是泛型实现
4. **重载语法**：签名列表 + 实现签名，强调实现不对外暴露、匹配顺序从上到下
5. **重载 vs 联合**：用"第三个参数只在 string 组合下存在"说明联合类型无法表达参数关联
6. **加分**：TS 的重载只是类型层契约，运行时 JS 没有重载；实现内部仍需类型守卫分支

### 常见追问

- **泛型 T 是怎么推断出来的？** → 调用时按实参位置反推（如 identity(42) → T=number）；推不出来或推宽时可显式传 `f<string>(x)`
- **`T extends U` 在类型里是什么意思？** → 约束：T 必须是 U 的子类型（至少具备 U 的形状），从而能安全访问 U 上的成员
- **重载实现签名为什么可以"不匹配"任何对外签名？** → 实现签名只对内部可见，TS 只要求它能兼容所有重载签名；调用方永远只看到前面的签名列表
- **一个函数用 `type F = ((a: A) => R1) | ((a: B) => R2)` 能替代重载吗？** → 不能：联合的函数类型调用时 TS 要求参数同时满足所有成员（取交叉参数），体验比重载差，重载是专门机制
- **泛型和 any 的本质区别？** → any 是放弃检查；泛型保留具体类型信息，调用处仍全程受检、返回值精确
