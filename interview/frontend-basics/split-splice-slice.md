# split、splice、slice 的区别

## 为什么需要

三个"以 s 开头、和切割有关"的方法极易口误混淆。面试官用读代码题考三个关键判断：**属于字符串还是数组、改不改原对象、返回值是什么**。答错任何一条都会被判定基本功不牢。

## 核心要点

### 1. 一表分清

| 维度 | split | slice | splice |
| --- | --- | --- | --- |
| 所属对象 | **String** 方法 | Array 方法（String 也有同名） | **Array** 方法 |
| 是否修改原对象 | 否（字符串不可变） | **否**，返回新数组 | **是**，原地增删改 |
| 返回值 | 切割后的**字符串数组** | [start, end) 区间的**拷贝** | **被删除元素**组成的数组 |
| 参数 | (separator, limit?) | (start?, end?) | (start, deleteCount, ...新增项) |
| 用途 | 字符串 → 数组 | 截取 / 浅拷贝 | 删除 / 插入 / 替换 |

### 2. splice：唯一改原数组的"手术刀"

```javascript
const arr = [1, 2, 3, 4, 5]
const removed = arr.splice(2, 2, 6, 7) // 从索引 2 起删 2 个，并在该位置插入 6、7
console.log(arr)      // [1, 2, 6, 7, 5] ← 原数组被改
console.log(removed)  // [3, 4]          ← 返回的是"被删掉的元素"，不是改完的数组

// 三种参数组合
arr.splice(1, 0, 'x')  // deleteCount=0：纯插入，不删任何东西
arr.splice(1, 2)       // 不传新增项：纯删除
arr.splice(-2, 1)      // 负索引：从倒数第 2 个开始删 1 个
```

⚠️ 高频陷阱：`splice` 返回被删元素数组，想拿"改后的数组"要用 `arr` 本身；纯插入时返回 `[]`。

### 3. slice：截取与浅拷贝（不动原数组）

```javascript
const animals = ['ant', 'bison', 'camel', 'duck', 'elephant']
animals.slice(2)        // ['camel', 'duck', 'elephant'] —— 省 end 取到末尾
animals.slice(1, 3)     // ['bison', 'camel'] —— 左闭右开 [start, end)
animals.slice(-2)       // ['duck', 'elephant'] —— 负数 = 从尾部数
animals.slice()         // 整个数组的浅拷贝（元素仍是引用）
```

- 区间是 **[start, end)**：含 start 不含 end
- 元素为对象时只拷引用，嵌套层仍共享（浅拷贝语义）

### 4. split：字符串 → 数组（join 是反向操作）

```javascript
const str = 'The quick brown fox jumps over the lazy dog.'
const words = str.split(' ')
words[3]            // 'fox'

'a,b,,c'.split(',')     // ['a', 'b', '', 'c'] —— 连续分隔符产生空串
'abc'.split('')         // ['a', 'b', 'c'] —— 空分隔符逐字符拆
'abc'.split('', 2)      // ['a', 'b'] —— 第二参 limit 截断数组长度
'a1b2c'.split(/\d/)     // ['a', 'b', 'c'] —— 支持正则分隔符
'hello'.split()         // ['hello'] —— 不传参返回整串单元素数组（不是逐字符！）
```

### 5. 字符串的 slice vs substring（顺带考点）

```javascript
'Hello World'.slice(-5)      // 'World' —— 支持负数（从尾部计）
'Hello World'.substring(-5)  // 'Hello' —— 负数一律当 0，且 start>end 时自动交换
```

## 面试答法

### 30 秒版本（可直接背诵）

> 一句话：split 是字符串方法，按分隔符把字符串切成数组，不改原串；slice 是数组方法，按 [start, end) 截取一段返回**新数组**，原数组不动，常用来做浅拷贝；splice 是数组方法，从指定位置**删除/插入/替换**元素，会**原地修改**原数组，返回的是**被删除元素**的数组。记忆锚点：splice 带 e，是唯一会改原数组的那个。

### 深入展开

1. **先报归属**：split 属于 String，slice/splice 属于 Array（String 也有 slice）
2. **改不改原**：只有 splice 原地修改——这是读代码题最大陷阱
3. **返回值差异**：slice 返回"截下来的"，splice 返回"切掉的"，split 返回"全部碎片"
4. **参数细节**：slice 左闭右开 + 负索引；splice 的 deleteCount=0 纯插入、不传新增项纯删除
5. **split 边角**：空串逐字符、limit 截长度、正则分隔符、不传参返回整串
6. **收尾**：数组浅拷贝用 slice()，字符串转数组 join/split 互逆

### 常见追问

- **splice 返回的是修改后的数组吗？** → 不是，返回被删除元素组成的数组；纯插入时返回空数组
- **slice 是深拷贝吗？** → 不是，只新建外层数组，元素引用原样拷贝，嵌套对象仍共享
- **split 和 join 的关系？** → 互逆：split 把字符串按分隔符拆成数组，join 把数组按分隔符拼成字符串
- **负索引三个方法都支持吗？** → slice/splice 支持（从尾部计），split 的 limit 不支持负数
- **想删原数组某一项又不想改原数组怎么办？** → `arr.slice(0, i).concat(arr.slice(i + 1))` 或 `arr.filter((_, j) => j !== i)`
