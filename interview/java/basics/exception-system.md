# Java 异常体系

## 题目

> 说说 Java 的异常体系？checked 和 unchecked 区别？try-with-resources 原理？finally 和 return 的执行顺序？

## 为什么需要

方法调用像一条链，最底层出错（比如文件被删了），上层该怎么知道？逐层 `if` 判断太恶心。异常机制就是**把"出错了"这个信号沿着调用链往回抛**，中间层不处理就透传，直到有人接住。

```
main() → service() → dao() → 读文件 💥 FileNotFoundException

调用链（正常）:  main ──► service ──► dao ──► 文件
抛异常（反向）:  main ◄── service ◄── dao ◄── new 异常对象
                （没人接就一路透传，main 也没接 → 线程终止打印堆栈）
```

## 核心要点

### 异常类层次图

```
                        Throwable
                       /         \
                  Error         Exception
                 （严重，接不住）  /          \
            ┌──────┼──────┐   /               \
        OOM  StackOverflow  RuntimeException   IOException, SQLException...
        （内存耗尽）（栈溢出）   （unchecked）      （checked）
                            /    │    \    \
                        NPE  ClassCast  ArrayIndexOutOfBounds
                              IllegalArgument  Arithmetic(除0)
```

| 分支 | 归属 | 编译器 | 典型代表 | 处理态度 |
| --- | --- | --- | --- | --- |
| Error | unchecked | 不管 | OOM、StackOverflowError | 程序级的锅，基本接不住、也不该接 |
| RuntimeException | unchecked | 不强制 | NPE、越界、除零 | **程序 bug**，靠修代码消除，不是靠 try |
| 其他 Exception | **checked** | **强制 try/throws，否则编译不过** | IOException、SQLException | 可预期的外部故障，必须显式处理 |

checked vs unchecked 一句话：**编译器管不管你**。unchecked = 程序写对了就不该发生；checked = 再对也可能发生（磁盘满、网络断），编译器逼你想好预案。

- **throw**：方法体内真抛出异常对象；**throws**：方法签名上声明"我可能抛"，交给调用方处理。

### try-with-resources 原理

```java
try (FileInputStream in = new FileInputStream("a");
     FileOutputStream out = new FileOutputStream("b")) {
    in.transferTo(out);       // 自动 close，且顺序与声明相反（先 close out）
}
```

编译器生成的等价代码（反编译视角）：

```
try {
    ...body...
} finally {
    if (out != null) out.close();   // 判空 + 逐个 close
    if (in  != null) in.close();    // 异常时也不漏
}
```

它比手写 finally close 好在两点：

1. **异常抑制**：body 抛异常 A，close 又抛异常 B——手写 finally 里 B 会**把 A 顶掉**（A 丢失）；try-with-resources 会把 B 通过 `A.addSuppressed(B)` 挂在 A 上，主异常不丢
2. 好写不忘：少写一堆判空模板代码

```
传统 finally：                      try-with-resources：
body 抛 A → close 抛 B              body 抛 A → close 抛 B
→ finally 里 B 上抛，A 消失 💀       → A 为主，B 记录在 A.suppressed ✅
```

### finally 与 return 经典题

**问题 1：try 里 return 了，finally 还执行吗？** → **执行**，而且是 return "之前"执行。

```
执行时间线（try 里 return x，finally 里写日志）：

 try:  算出返回值 x，暂存到栈上的"返回值槽"
 finally:  照常执行（return 还没真正离开方法）
 方法:  携带暂存的 x 返回
```

**问题 2：finally 里改返回值，有用吗？**

```java
int f() {
    int x = 1;
    try { return x; }        // x=1 已暂存
    finally { x = 99; }      // 改的是局部变量，返回值槽里还是 1
}
// 返回 1 💡 基本类型：值已拷贝，改不掉

static int[] g() {
    int[] a = {1};
    try { return a; }        // 暂存的是"地址"
    finally { a[0] = 99; }   // 改的是对象内容，地址没变 → 内容变化生效
}
// 返回 [99] 💡 引用类型：改内容会"生效"
```

**问题 3：finally 里再 return？** → 会**覆盖** try 的返回值——这是灾难写法（吞掉 try 抛出的异常也同理：finally 里 return，try 的异常直接消失）。规则：**finally 里永远不要写 return/throw**（编译器也会给 warning）。

### 最佳实践表

| 反面 | 正面 |
| --- | --- |
| `catch (Exception e) {}` 吞异常 | 至少记日志，或转成有意义异常往上抛 |
| 用异常控制正常流程（性能差、难读） | 异常只用于"意外"，可预期的状态用返回值 |
| `e.printStackTrace()` | log 框架记录 + 保留异常链 `new BizException("下单失败", e)` |
| 项目里到处 `new Exception` | 自定义异常分层：BaseException ← BizException ← OrderNotFoundException |

## 面试答法

### 30 秒版（可背诵）

> Java 异常的根是 Throwable，分两大支：Error 是严重的系统级错误比如 OOM，不该去接；Exception 又分运行时异常和其他——运行时异常像 NPE 是 unchecked，编译器不强制处理，本质是代码 bug；IOException 这类是 checked，编译器强制 try 或者 throws。关闭资源推荐 try-with-resources，它编译后会转成 finally 里判空 close，而且 body 和 close 同时抛异常时会把 close 的异常 addSuppressed 挂在主异常上，不像手写 finally 会把主异常顶丢。finally 无论如何都会在 return 之前执行，但在 finally 里改基本类型返回值没用，因为值已经暂存了；也绝对不要在 finally 里写 return，会覆盖原返回值还可能吞异常。

### 深入版（被追问时按编号展开）

1. **层次图**：Throwable → Error / Exception → RuntimeException 的树，报几个常见子类
2. **checked vs unchecked**：编译器是否强制 + 一句"bug vs 外部故障"的本质区分
3. **try-with-resources**：反编译原理图 + 异常抑制的好处
4. **finally/return 三连**：会执行（暂存返回值）→ 改基本类型无效/改内容有效 → finally 里 return 是灾难
5. **最佳实践**：不吞异常、不打异常做流程、自定义异常分层

### 常见追问

- **finally 一定执行吗？** → `System.exit()` 或 JVM 崩了就不执行；正常 return/异常都会执行
- **OOM 能被 catch 吗？** → 语法上能（是 Error 子类、unchecked），但通常接不住也接不动，最多兜底打日志
- **异常的性能开销在哪？** → 构建 exception 时抓栈快照 fillInStackTrace 最贵，所以别拿异常当流程控制
- **throw 和 throws 区别？** → 动词 throw 在方法体真抛；throws 是方法签名声明，甩锅给调用方
