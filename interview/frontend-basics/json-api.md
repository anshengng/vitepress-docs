# JSON.parse 和 JSON.stringify 的区别

## 为什么需要

前后端交换数据的通用格式是 JSON 字符串：响应要 `parse` 成对象用，请求体要 `stringify` 成字符串发，localStorage、深拷贝、SSR 状态注水全靠这两个 API。考察方向是**互逆方向 + 序列化规则（哪些值会丢、哪些会报错）**，这也是深拷贝四大坑的前置知识。

## 核心要点

### 1. 方向对比总表

| 维度 | JSON.parse | JSON.stringify |
| --- | --- | --- |
| 用途 | JSON **字符串 → JS 值/对象** | JS 值 → JSON **字符串** |
| 语法 | `JSON.parse(text, reviver?)` | `JSON.stringify(value, replacer?, space?)` |
| 返回值 | 解析出的对象/数组/原始值 | 表示该值的 JSON 字符串 |
| 非法输入 | 抛 `SyntaxError` | 循环引用抛 `TypeError`，BigInt 抛 `TypeError` |
| 可选第二参 | `reviver`：逐键转换解析结果 | `replacer`：数组白名单或转换函数 |
| 可选第三参 | — | `space`：缩进空格数/字符串，美化输出 |

```javascript
const text = '{"name":"Li","age":25}'
const obj = JSON.parse(text)              // { name: 'Li', age: 25 }
const back = JSON.stringify(obj)          // '{"name":"Li","age":25}'
const pretty = JSON.stringify(obj, null, 2) // 带 2 空格缩进的多行字符串
```

### 2. stringify 的序列化规则（重点：什么会被丢）

```javascript
JSON.stringify({
  a: undefined,      // 丢弃（对象里 undefined/函数/symbol 直接消失）
  fn: () => {},      // 丢弃
  sym: Symbol('s'),  // 丢弃
  d: new Date('2026-01-01'), // → "2026-01-01T00:00:00.000Z"（Date 调 toJSON 变字符串）
  n: NaN,            // → null（Infinity 同理）
  big: 10n,          // ❌ TypeError: Do not know how to serialize a BigInt
})
// 结果：'{"d":"2026-01-01T00:00:00.000Z","n":null}'
```

| 值 | 对象属性中 | 数组元素中 | 顶层 |
| --- | --- | --- | --- |
| undefined / 函数 / Symbol | 整个键消失 | 变成 `null` | 返回 `undefined` |
| NaN / Infinity | 变 `null` | 变 `null` | 变 `null` |
| Date | 调 `toJSON()` 变 ISO 字符串 | 同左 | 同左 |
| 循环引用 | ❌ TypeError | ❌ | ❌ |

- 只序列化**可枚举自有属性**；原型链上的方法、`getter 不存在时`、不可枚举属性不参与
- 对象若定义了 `toJSON()`，优先用它的返回值（Date 就是这么变的）

### 3. replacer 与 reviver：两个方向的钩子

```javascript
// replacer 数组：白名单，只保留列出的键
JSON.stringify(user, ['name', 'age'])
// replacer 函数：逐键改写，返回 undefined 即删除该键
JSON.stringify(user, (k, v) => (k === 'password' ? undefined : v))

// reviver：解析时逐键转换——典型用法是把 ISO 字符串还原成 Date
const data = JSON.parse(text, (k, v) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v) : v
)
```

### 4. parse 的健壮性

```javascript
JSON.parse('{"a":1}')   // ✅ { a: 1 }
JSON.parse("{'a':1}")   // ❌ SyntaxError：键必须双引号
JSON.parse('{a:1,}')    // ❌ SyntaxError：不允许尾逗号/无引号键
JSON.parse('123')       // ✅ 123 —— 合法 JSON 原始值也能解析
// 实战：解析接口数据务必 try/catch，或用安全包装
function safeParse(text, fallback) {
  try { return JSON.parse(text) } catch { return fallback }
}
```

### 5. 典型用途

- `stringify`：请求体序列化、localStorage 存对象、日志/调试美化输出
- `parse`：响应解析、读取 localStorage、接收 postMessage
- 组合 `parse(stringify(obj))`：纯数据深拷贝（注意四大坑，详见深拷贝专题）
- 对比 `eval`：parse 只认 JSON 语法、**不执行代码**，处理不可信数据比 eval 安全

## 面试答法

### 30 秒版本（可直接背诵）

> 两者互逆：JSON.parse 把 JSON 字符串解析成 JS 值，可选 reviver 对结果逐键转换；JSON.stringify 把 JS 值序列化成 JSON 字符串，可选 replacer 做键白名单或逐键改写，space 控制缩进。重点在 stringify 的丢信息规则：undefined、函数、symbol 在对象里直接消失、在数组里变 null，Date 走 toJSON 变 ISO 字符串，NaN/Infinity 变 null，循环引用和 BigInt 直接抛 TypeError。parse 遇到非法 JSON 抛 SyntaxError，所以解析外部数据要 try/catch。它比 eval 安全，因为只解析数据不执行代码。

### 深入展开

1. **方向先行**：parse 入字符串出对象，stringify 入对象出字符串，各带一个可选转换钩子
2. **丢信息表**：undefined/函数/symbol、Date、NaN/Infinity、BigInt、循环引用逐条讲后果
3. **toJSON 机制**：对象自定义 toJSON 可控制序列化结果，Date 是内置例子
4. **replacer 两形态**：数组白名单 vs 函数改写（返回 undefined 删键）
5. **reviver 实战**：把 ISO 字符串还原 Date，弥补 JSON 往返的类型丢失
6. **收尾**：深拷贝场景引出"JSON 方案只适合纯数据对象"

### 常见追问

- **JSON.stringify 能序列化函数吗？** → 不能，对象属性里的函数整个键消失，数组里的函数变 null
- **Date 序列化后还是 Date 吗？** → 不是，变成 ISO 字符串；可用 reviver 按格式匹配还原
- **为什么 parse 外部数据要 try/catch？** → 任何非法 JSON（单引号、尾逗号、无引号键）都抛 SyntaxError，不捕获会直接崩
- **BigInt 怎么处理？** → stringify 会抛 TypeError，需在 replacer 里 `typeof v === 'bigint' ? v.toString() : v`
- **和 eval 的区别？** → eval 执行任意 JS（可注入代码），JSON.parse 只解析纯数据语法，安全且更快
