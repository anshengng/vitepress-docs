# String、StringBuilder、StringBuffer 与字符串常量池

## 题目

> String 为什么设计成不可变的？String、StringBuilder、StringBuffer 有什么区别？字符串常量池是什么？`new String("abc")` 创建了几个对象？循环里用 `+` 拼接字符串为什么慢？

## 为什么需要

字符串是使用最频繁的对象，"复用"能省大量内存：全项目成千上万个 `"abc"`，如果每个都新建一份，堆里全是重复内容。

```
没有常量池：                        有常量池：
堆: [abc][abc][abc][abc]...         常量池: [abc]  ←—— 所有人共用这一份
     ↑     ↑     ↑    ↑                  ↑ ↑ ↑ ↑
   引用1 引用2 引用3 引用4              4 个引用指同一个
```

而不可变是这一切的前提：**内容永远不变，才能放心共享**——要是谁能改 `"abc"`，所有引用它的人都被"误伤"。

## 核心要点

### String 不可变："修改"其实是新建

String 内部就是 `final char[]`（Java9 后是 `byte[]`），且类本身 final 不可继承、没有提供任何改内容的方法。

```
String s = "ab";
s = s + "c";        // 看着像"改了 s"，实际时间线：

时刻     栈(引用)          堆/常量池
 t0     s ──────►  池: "ab"
 t1     s ──────►  池: "ab"      新建: "abc" (先 StringBuilder.append，再 toString)
                       ↓ t2 赋值后
 t2     s ──────►  新对象: "abc"   池: "ab" 还在（没人引用了才会在GC时回收）
```

**s 的指向变了，"ab" 本身一个字符都没动**。所以 String 传参天然安全、可作 HashMap 的 key（hashCode 缓存后不再变）。

### 字符串常量池与 intern()

- **字面量** `"abc"`：类编译期进 class 常量池，运行时落到字符串常量池（堆中一块专门区域，Java7 起），全局复用。
- **`new String("abc")`**：强制在堆里再开一个新对象。经典题"创建几个对象"：**最多 2 个**——池里已有 `"abc"` 则 1 个（堆里那个新的）；池里没有则 2 个（先入池、再 new）。

```
String a = "abc";            // 0 个新对象，直接指向池
String b = new String("abc");// 堆里新建 1 个，池里的 "abc" 已存在

栈        常量池            堆
a ──────► [abc] ◄──┐
                   │ value 指向
b ──────► [String对象] ────► [abc]
          （新建的，==a 为 false，equals 为 true）
```

- **`intern()`**：主动把字符串塞进池（池里没有就放、有就返回池中引用），返回值才是池里的那份。

```java
String s1 = new String("he") + new String("llo"); // 堆里拼出 "hello"（不在池）
String s2 = s1.intern();   // "hello" 入池，s2 指向池
System.out.println(s1 == s2); // JDK7+ true：池里没有，intern 后 s2 实际就是 s1 那个
```

### 三者对比

| | String | StringBuffer | StringBuilder |
| --- | --- | --- | --- |
| 可变性 | 不可变 | 可变 | 可变 |
| 线程安全 | 安全（不可变即安全） | 安全（方法加 `synchronized`） | **不安全** |
| 性能 | 拼接慢（每次新建） | 有锁开销 | 最快 |
| 场景 | 常量、少量拼接 | 多线程拼接（罕见） | 单线程拼接（默认选它） |

### 循环拼接为什么慢

```java
String s = "";
for (int i = 0; i < 5; i++) {
    s += i;   // 每一轮等价于：s = new StringBuilder(String.valueOf(s)).append(i).toString();
}
```

```
每轮都：新建 StringBuilder → copy 旧串 → append → toString 新 String
轮次     产生的垃圾对象        已拼内容
 1       SB + "0"            "0"
 2       SB + "01"           "01"
 3       SB + "012"          "012"
 ...      ↑ 内容越长，每轮拷贝成本越高，O(n²)
```

**冷知识**：单行 `s = a + b + c` 会被编译器优化成**一个** StringBuilder 链式 append（JDK9 起优化成 invokedynamic/StringConcatFactory），所以单行 + 没问题；**循环里的 + 每轮新建一个 StringBuilder 才是慢的根源**。正确写法：循环外建一个 StringBuilder，循环内只 append。

### `==` vs equals 的坑

- `==` 比地址，`equals` 比内容（String 已重写）。
- 坑：编译期常量拼接会进池（`"a"+"b" == "ab"` 为 true），**带变量的拼接结果是堆里新对象**（`f + "b" == "fb"` 为 false）。
- 结论：比较字符串永远用 `equals`，别赌常量池。

### Java9 compact string 一句话

Java9 起 String 底层从 `char[]` 改为 `byte[]` + `coder` 标记：纯 Latin 字符（英文）用 1 字节/字符存（LATIN1），含中文才用 2 字节（UTF16），省一半内存。

## 面试答法

### 30 秒版（可背诵）

> String 是不可变的，内部是 final 的数组，任何"修改"都是新建对象，好处是能安全共享、能缓存 hashCode、天生线程安全。字符串常量池是为了复用：字面量直接入池，new String 会在堆里强制新建对象，所以最多创建两个对象。大量拼接用 StringBuilder，它和 StringBuffer 唯一区别是后者加了 synchronized 保证线程安全，单线程用 StringBuilder 就够了。循环里用加号拼接慢，是因为每轮都新建 StringBuilder 再 toString，产生大量临时对象。

### 深入版（被追问时按编号展开）

1. **不可变怎么实现**：final 类 + final char[]/byte[] + 不暴露修改方法；"改"是引用指向了新对象（画栈/堆时间线）
2. **常量池**：字面量入池复用、new String 创建 2 个对象的图解、intern 的行为
3. **三者选型**：不可变→安全但拼接慢；线程安全对比；循环拼接 O(n²) 的图解 + 编译器单行优化冷知识
4. **细节加分**：==/equals 的坑、Java9 compact string

### 常见追问

- **String 为什么能作 HashMap 的 key？** → 不可变所以 hashCode 稳定，可缓存，且不会被改导致"找不到"
- **`String s = new String("x"); s.intern(); s == "x"`？** → true，intern 后 s 已指向池里那份
- **StringBuffer 什么时候还用？** → 多线程共享同一个拼接缓冲区的罕见场景，实际开发几乎见不到
- **substring 会产生新对象吗？** → JDK7 起会（复制数组），之前共享原数组可能导致内存泄漏
