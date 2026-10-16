# 数据类型与类型转换

## 题目

> JavaScript 有哪些数据类型？typeof 为什么判断不了 null？== 的隐式转换规则是什么，[] == false 为什么是 true？怎么正确判断一个变量的类型？

## 为什么需要

JS 是弱类型语言：**变量没有类型，值才有类型**。两种类型的值碰在一起运算，引擎会先"偷偷转换"再计算——不知道规则就只能死记怪题，知道规则所有输出题都能现场推导。

```
你写的代码：    "2" + 1          "2" - 1
引擎实际干的：  "2"+"1" → "21"   2 - 1 → 1
              （+ 有字符串语义）（- 只有数值语义）
```

生活化理解：两种货币相加必须先换汇。隐式转换就是引擎"自动换汇"，只是汇率规则比较怪，得专门学。

## 核心要点

### 一、8 种数据类型结构图

```
                JavaScript 数据类型
                        │
          ┌─────────────┴──────────────┐
        基本类型（7 种）              引用类型（1 种）
    栈上直接存值，赋值=复制值      栈存堆地址，赋值=复制地址
          │                            │
  ┌───────┼────────┐                   Object 大家族
 number  string  boolean          ├─ Array / Function
 undefined  null                 ├─ Date / RegExp
 ★symbol(ES6) ★bigint(ES10)      └─ Map / Set / …
```

- 基本类型按值访问；引用类型变量里放的是**堆地址**（这是深浅拷贝问题的根源，见专篇）
- Symbol：创建唯一标识符（对象键防冲突）；BigInt：任意大整数（写作 `10n`），不能与 Number 混算

### 二、typeof：返回值表 + 两个著名坑

| 输入 | typeof 结果 |
| --- | --- |
| number / string / boolean / symbol / bigint / undefined | 对应类型字符串 |
| null、数组、普通对象、Date、RegExp… | `'object'` ⚠️ |
| 函数 | `'function'` |

**坑 1：`typeof null === 'object'`**。历史遗留：早期 JS 用值的低位标记类型，对象的标记是 `000`，而 null 机器上是全零，被误判成对象。为兼容老代码，规范永远不改。

**坑 2：`typeof 未声明变量` 不报错**，返回 `'undefined'`——唯一能安全访问未声明变量的方式：

```js
typeof x          // 'undefined'（x 从未声明，不抛错）
x                 // ReferenceError
// 老代码里判断全局变量是否存在的惯用法：
if (typeof jQuery !== 'undefined') { ... }
```

### 三、判断类型的正确姿势（对比表）

| 手段 | 能判 | 判不了 | 原理一句话 |
| --- | --- | --- | --- |
| typeof | 基本类型（除 null）、函数 | null、具体对象类型 | 读值的内部类型标记 |
| instanceof | 具体对象类型（数组、Date…） | 基本类型；跨 iframe 失效 | 沿原型链找 X.prototype |
| Array.isArray | 数组（唯一职责） | 其他一切 | 引擎内部判断，跨 realm 也准 |
| Object.prototype.toString.call | 所有类型，终极方案 | —— | 返回 `'[object Type]'` |

instanceof 原理：`a instanceof B` = 沿 `a.__proto__` 原型链向上找 `B.prototype`，找到返回 true。
两个失效场景：① 原始值 `'' instanceof String` 永远 false（原始值不走原型链查找）；② 跨 iframe 后数组原型链上的 Array 不是同一个构造函数。

### 四、隐式转换：== 比较流程图

```
                 a == b
                   │
      ┌── 类型相同？──是──► 类似 === 直接比较（但 NaN==NaN 为 false）
      │            否
      ├── 有 null/undefined？──是──► 只有 null==undefined 为 true，
      │            否                  其余全 false（不转数字）
      ├── 有对象？──是──► ToPrimitive(对象)：先 valueOf 后 toString
      │            否      得到原始值，回到最上层重走流程
      ├── 一边 boolean？──是──► boolean 先转数字（true→1，false→0）
      │            否
      └── string vs number ──► 字符串转数字，两边变数字再比
```

口诀：**对象先变原始值，布尔先变数字，字符串遇数字也变数字**。

### 五、经典怪题逐个拆解

**[] == false → true**

| 步骤 | 式子 | 发生了什么 |
| --- | --- | --- |
| ① | `[] == 0` | false 转数字：false → 0 |
| ② | `'' == 0` | [] ToPrimitive：valueOf 返回自身 → toString 得 '' |
| ③ | `0 == 0` | '' 转数字得 0 |
| 结论 | **true** | |

**[] == ![] → true**（"数组不是自己的对手"）

| 步骤 | 式子 | 说明 |
| --- | --- | --- |
| ① | `[] == false` | ![] 先求值：对象恒为真值，!真值 = false |
| ② | 同上一题三步 | → **true** |

**+ 的拼接与相加**

```js
1 + '2'        // '12'（任一边是字符串 → 拼接）
'string' + 1   // 同上
1 + true       // 2   （两边无字符串 → 都转数字相加）
{} + []        // 0！{} 在语句开头被当块语句，实际是 +[] → Number('') → 0
```

### 六、显式转换：Number / parseInt / 一元 +-

| 写法 | 行为要点 |
| --- | --- |
| `Number(x)` | 整串必须完全可解析，否则 NaN；`Number('')=0`、`Number(null)=0`、`Number(undefined)=NaN` |
| `parseInt(x)` | 逐位解析、遇非数字即停：`parseInt('12px')=12`；第二参数指定进制 `parseInt('11',2)=3` |
| `+x` / `-x` | 一元正负号 = Number() 的语法糖：`+'3'`→3、`-''`→-0 |
| `x + ''` | 万能转字符串 |

最容易混的三组：

```js
Number('')      // 0        parseInt('')      // NaN
Number('12px')  // NaN      parseInt('12px')  // 12
Number('0x11')  // 17       parseInt('11', 2) // 3（别省进制参数）
```

### 七、面试输出题实战

**题 1：**

```js
console.log(1 + '2' - '2')
console.log(true + true)
console.log('10' < '9')
```

| 表达式 | 逐步推演 | 结果 |
| --- | --- | --- |
| `1 + '2' - '2'` | `'12' - '2'` → `12 - 2`（- 无字符串语义，全转数字） | `10` |
| `true + true` | `1 + 1`（无字符串，布尔转数字） | `2` |
| `'10' < '9'` | 两边都是字符串 → **按字典序逐字符比**：'1' < '9' | `true` ⚠️ |

**题 2：**

```js
console.log([] == false)
console.log({} == '[object Object]')
console.log(NaN == NaN)
```

| 表达式 | 逐步推演 | 结果 |
| --- | --- | --- |
| `[] == false` | 见上文三步 | `true` |
| `{} == '[object Object]'` | 对象 ToPrimitive 得 `'[object Object]'`，两边相同 | `true` |
| `NaN == NaN` | 规范规定 NaN 与任何值都不等（包括自己） | `false` |

**题 3：if 的隐式转换 + 假值全家福**

```js
if ([]) console.log('A')   // 打印！空数组是对象 → 真值
if ('0') console.log('B')  // 打印！非空字符串恒为真
```

假值只有 8 个：`false、0、-0、0n、''、null、undefined、NaN`——**没有 []、{}、'0'、'false'**。

## 面试答法

### 30 秒版（可背诵）

> JS 一共 8 种数据类型：number、string、boolean、undefined、null、symbol、bigint 这 7 种基本类型，加上 Object 这 1 种引用类型，基本类型栈上存值、引用类型栈上存堆地址。判断类型上，typeof 只能判基本类型和函数，typeof null 返回 object 是历史遗留 bug；具体对象类型用 instanceof，判数组用 Array.isArray，最准确的是 Object.prototype.toString.call。隐式转换集中在 == 和加减法里，规则是对象先转原始值、布尔转数字、字符串遇数字转数字，[] == false 就是两边都变成 0 才相等。实际开发我全用 === 加显式转换，但底层规则能体现基本功。

### 深入版（被追问时按编号展开）

1. **类型体系**：画"7 基本 + 1 引用"结构图，点出栈存值 vs 栈存地址
2. **typeof**：过一遍返回值，抛出 typeof null 的历史原因（低位标记 000）和未声明变量不报错的怪癖
3. **判断姿势**：按 typeof → instanceof（原型链原理 + 两个失效场景）→ Array.isArray → toString.call 的顺序讲
4. **== 规则**：背四句话流程——类型相同直接比、null/undefined 特判、对象 ToPrimitive、布尔/字符串转数字
5. **落到实践**：项目里强制 === 和 eslint eqeqeq 规则，显式转换用 Number/parseInt

### 常见追问

- **null 和 undefined 的区别？** → null 是"主动置空"（赋值语义），undefined 是"还没赋值"（默认语义）；Number(null)=0、Number(undefined)=NaN
- **Object.is 和 === 的区别？** → Object.is 修了两个特例：Object.is(NaN,NaN) 为 true、Object.is(+0,-0) 为 false
- **怎么判断数组？** → Array.isArray 首选（跨 iframe 也准）；instanceof 跨 realm 失效；终极通用 Object.prototype.toString.call
- **+ 什么时候拼接什么时候相加？** → 任一边是字符串就拼接（含对象转出的原始字符串）；否则全部转数字相加
