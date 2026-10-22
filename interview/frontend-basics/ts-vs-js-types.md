# TS 和 JS 的数据类型

## 为什么需要

基础题但常作为开场：① 考 JS 类型体系是否扎实（8 种原始/引用、typeof 的坑）；② 考 TS 在 JS 之上**扩展了什么**（any/unknown/never/void、enum、元组、字面量类型、接口/类型别名、索引签名）。很多人只背得出"TS 多几个类型"，答不出"为什么需要 unknown/never"就暴露没真正用 TS。

## 核心要点

### 1. JavaScript 的 8 种数据类型

```
JS 类型
├── 原始类型（7，按值比较、不可变）
│   string / number / boolean / null / undefined / symbol(ES6) / bigint(ES10)
└── 引用类型（1）
    object（普通对象、数组、函数、Date、RegExp 都算）
```

| 类型 | 示例 | typeof 结果 |
| --- | --- | --- |
| string | `'hi'` | `'string'` |
| number | `42`、`3.14`、`NaN`、`Infinity` | `'number'` |
| boolean | `true` | `'boolean'` |
| undefined | 未赋值变量 | `'undefined'` |
| null | 空对象指针 | **`'object'`**（历史 bug） |
| symbol | `Symbol('id')` 唯一标识 | `'symbol'` |
| bigint | `9007199254740993n` 大整数 | `'bigint'` |
| object | `{}`、`[]`、`function(){}` | `'object'`（函数为 `'function'`） |

typeof 三大坑：**`typeof null === 'object'`**；函数返回 `'function'` 而非 `'object'`；`typeof` 判断不出数组（`typeof [] === 'object'`，要用 `Array.isArray`）。判断精确类型用 `Object.prototype.toString.call(x)`。

### 2. TypeScript 在 JS 之上的扩展

| TS 类型 | 是什么 | 示例/说明 |
| --- | --- | --- |
| `any` | 关闭类型检查的后门 | `let x: any = 1; x = 's'` ✔；应少用 |
| `unknown` | 类型安全的 any（顶部类型） | 只能赋给 any/unknown，**使用前必须收窄** |
| `never` | 底部类型，不存在值 | 必抛错函数返回类型、穷尽检查 |
| `void` | 函数无返回值 | `function log(): void {}` |
| `enum` | 枚举（JS 无原生，TS 编译成对象） | `enum Dir { Up, Down }` |
| 元组 tuple | 定长+各位定型的数组 | `let t: [string, number] = ['a', 1]` |
| 字面量类型 | 值即类型 | `let dir: 'up' \| 'down'`，替代小枚举 |
| `interface` / `type` | 结构类型定义/别名 | 对象形状、联合、交叉 |
| 索引签名 | 描述动态键 | `[key: string]: number` |
| `object` | 非原始类型（区别于 JS 的 object 大杂烩） | 约束"传进来的得是对象" |

```typescript
// unknown vs any：unknown 强制收窄，错误不扩散
function safe(v: unknown) {
  if (typeof v === 'string') v.toUpperCase()   // 收窄后才能用
}

// never：不可能到达的终点
function fatal(): never { throw new Error() }
type Empty = never   // 空联合

// 字面量 + 联合：JS 里做不到的"值级别"约束
type Status = 'idle' | 'loading' | 'success' | 'error'
```

### 3. JS vs TS 类型体系对比总表

| 维度 | JavaScript | TypeScript |
| --- | --- | --- |
| 类型检查 | 运行时、动态弱类型 | 编译期静态（类型擦除，产物仍是 JS） |
| 原始类型 | 7 种（含 symbol/bigint） | 同左 + 字面量类型、enum |
| 引用类型 | object 一种（函数/数组归入） | 同左 + interface/type/元组/泛型/索引签名 |
| 特殊类型 | — | any / unknown / never / void |
| 类型归属 | 值有类型 | **值 + 表达式 + 函数签名**都有类型，类型本身也是语言构造 |

## 面试答法

### 30 秒版本（可直接背诵）

> JS 有 8 种数据类型：7 种原始类型 string、number、boolean、null、undefined、symbol、bigint，加上引用类型 object，函数和数组本质都是 object。typeof 有坑：null 返回 object，函数返回 function，数组要靠 Array.isArray。TS 在 JS 全部类型之上做静态扩展：any 关闭检查、unknown 是必须先收窄的安全顶部类型、never 是不存在值的底部类型、void 表示无返回；再就是 JS 没有的 enum、元组、字面量类型、interface/type、索引签名和泛型。TS 编译后类型被擦除，运行时还是 JS 那套类型，所以 TS 的类型只在编译期起作用。

### 深入展开

1. **先报 JS 8 种**：原始 7 + 引用 1，按值/按引用分界；主动点出 bigint 是 ES10、symbol 是 ES6，体现代际准确
2. **typeof 三坑**：null→object、function 特殊返回、数组判不出，给 Object.prototype.toString 兜底方案
3. **TS 扩展逐个讲**：any/unknown/never 三角关系（顶部/底部/后门），void、enum、元组、字面量联合
4. **强调类型擦除**：TS 编译产物无类型，运行时类型仍是 JS 的 8 种——静态类型是"开发期保险"
5. **收尾**：TS 里 `object`（非原始）与 `Object`（全局构造器类型）的区别可作加分点

### 常见追问

- **null 和 undefined 区别？** → undefined 是"未定义"（声明未赋值、缺参），null 是"刻意表示空"；`typeof null==='object'` 是 JS1 实现遗留 bug，改不动因为太多代码依赖
- **any 和 unknown 到底差在哪？** → any 可赋给任何类型且任意调用不报错（放弃检查）；unknown 只能赋给 any/unknown，任何操作前必须先收窄——JSON.parse 返回值就该按 unknown 处理
- **never 有什么用？** → 表示"不会有值"：抛异常/死循环函数的返回类型；穷尽检查（switch 漏分支时 default 处断言 never 编译报错）；空联合
- **TS 的 enum 和字面量联合怎么选？** → 数字枚举有自增、运行时会生成对象；字面量联合零运行时成本、可精确控制取值，现代项目更推荐 `const` 对象或联合
- **number 能表示所有数字吗？** → 不能，双精度浮点，超过 `Number.MAX_SAFE_INTEGER`（2^53-1）精度丢失，大整数用 bigint
