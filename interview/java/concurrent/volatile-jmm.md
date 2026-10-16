# volatile 与 JMM

## 题目

> 什么是 JMM？volatile 有哪两个语义？为什么 DCL 单例必须加 volatile？volatile 能保证原子性吗？它和 synchronized、Atomic 有什么区别？

## 为什么需要 volatile

多线程读写同一个变量时，你以为"写了别人就能看见"，实际上 CPU 有寄存器/多级缓存、JIT 有指令重排，**可见性和有序性都不受你控制**。volatile 就是 Java 层面花最小代价解决这两个问题的关键字——代价是它管不了"复合操作的原子性"。

## 核心要点

### JMM 抽象模型：工作内存 / 主内存

JMM 不是真实内存结构，是一套**规范**：规定"线程什么时候能看见别的线程的写"。

```
                 ┌─────────────┐
                 │   主内存     │   共享变量 flag 的真身
                 │  flag = false│
                 └──┬───────┬──┘
        read/load ↕ │       │ ↕ store/write
        ┌───────────┴──┐ ┌──┴───────────┐
        │ 线程1 工作内存 │ │ 线程2 工作内存 │   寄存器/CPU缓存的抽象
        │  flag=false  │ │  flag=false  │   ← 各自一份副本
        └──────────────┘ └──────────────┘
```

普通变量的规则：线程读写走自己的副本，**何时同步回主内存、何时重新拉取，JMM 不做保证**。volatile 改变了这两条边：写必须立刻刷主内存，读必须作废本地副本重新拉。

### 可见性：模拟两个线程竞争 flag

```java
// 线程1                    // 线程2
while (!flag) { }           flag = true;
System.out.println("退出");
```

#### 没有 volatile：线程 1 永远退不出循环

```
时刻  线程1（读）                     主内存 flag        线程2（写）
 t1   读 flag → 副本=false
 t2   循环判断：用副本 false ✅
 t3                                     false            写 flag=true（刷到主内存）
 t4   循环判断：仍用本地副本 false ⚠️   true
 t5   循环判断：false ⚠️（JIT 甚至把    true              -
      循环优化成 while(true)，内存都不读）
 → 线程1 死循环，"看不见"线程2 的写
```

#### 加 volatile：写立即刷主内存 + 读失效重取

```java
volatile boolean flag = false;
```

```
时刻  线程1（读 volatile）              主内存 flag        线程2（写 volatile）
 t1   读 → 强制从主内存拉，副本=false
 t2   循环判断：拉主内存 → false
 t3                                     true  ◄── 写立即刷主内存（store）
 t4   循环判断：volatile 读强制重拉 ──► true ✅
 t5   退出循环，打印"退出"
```

底层实现：写 volatile 时插入 **StoreLoad/StoreStore 屏障**，在 x86 上对应 `lock` 前缀指令——把写缓存行刷回主内存，并通过缓存一致性协议（MESI）让其他核心的副本失效。

### 有序性：DCL 单例不加 volatile 的"半成品对象"

```java
// 错误示范：instance 没加 volatile
private static Instance instance;
public static Instance getInstance() {
    if (instance == null) {                       // ① 双重检查
        synchronized (Instance.class) {
            if (instance == null)
                instance = new Instance();        // ② 非原子！
        }
    }
    return instance;
}
```

`new Instance()` 在字节码层是三步，**允许被重排成 1→3→2**：

```
正常顺序：1 分配内存 M  →  2 初始化 M（赋字段）  →  3 instance = M
重排后：  1 分配内存 M  →  3 instance = M        →  2 初始化 M
```

模拟两个线程撞上重排窗口：

```
时刻  线程1（创建单例）                      内存 M        线程2（getInstance）
 t1   ① 分配 M（未初始化）
 t2   ③' 重排：instance = M ──────────────► M=脏/半成品   ① 检查 instance==null？false！
 t3                                          (字段全0/null) 跳过 synchronized，直接 return instance
 t4                                          M 半成品       使用 instance.field → NPE ❌
 t5   ②' 才执行初始化
```

线程 2 在 ① 处看到"非 null"就放行，拿到的是**引用已赋值但内容没初始化**的对象。

`volatile` 的写屏障禁止 ②③ 重排（StoreStore：初始化完成之前，引用赋值不许刷出），时间线变成：

```
 t2   ② 初始化 M 完成
 t3   ③ instance = M（volatile 写，此前写入全部可见）
 t4                                        M=完整对象     ① 读到非 null → 必然拿到完整对象 ✅
```

### volatile 不保证原子性：两个线程 i++ 丢更新

`i++` = 读 i → 加 1 → 写 i，三步复合。volatile 只保证每步"看得见"，不保证三步"不可分"：

```java
volatile int i = 0;   // 线程1、线程2 各执行 1000 次 i++
```

```
时刻  线程1                    主内存 i        线程2
 t1   读 i → 副本=0（volatile 读）  0
 t2                              0            读 i → 副本=0（volatile 读）✅ 都读到最新
 t3   副本+1 = 1                 0
 t4                              0            副本+1 = 1
 t5   写 i=1（volatile 写）──►    1
 t6                              1            写 i=1（volatile 写）──► 1 ❌
 → 两次 ++ 结果还是 1，线程2 基于过期副本覆盖，丢了一次更新
```

要原子：`synchronized(i)`、或 `AtomicInteger.incrementAndGet()`（CAS）、或 `LongAdder`。

### volatile vs synchronized vs Atomic

| 维度 | volatile | synchronized | Atomic(如 AtomicInteger) |
| --- | --- | --- | --- |
| 可见性 | ✅ | ✅ | ✅（CAS 自带 volatile 语义） |
| 有序性 | ✅（禁重排） | ✅ | ✅ |
| 原子性 | ❌ 单变量读写原子，复合操作不行 | ✅ 临界区整体原子 | ✅ 单个变量 CAS 原子 |
| 阻塞 | 不阻塞 | 可能阻塞（锁竞争） | 不阻塞（自旋 CAS） |
| 适用 | 状态标志、DCL 引用、一写多读 | 复合逻辑、多变量不变式 | 单变量计数/累加 |
| 开销 | 最低 | 偏向/轻量/重量锁逐级 | 高竞争下自旋耗 CPU |

## 面试答法

### 30 秒版（可背诵口语）

> JMM 是一套规范，把内存抽象成主内存和工作内存：线程读写共享变量走自己的副本，普通变量不保证何时同步，所以会出现"写了别人看不见"和指令重排。volatile 解决可见性和有序性：写立刻刷主内存并让别的核缓存失效，读强制重拉，并用内存屏障禁止重排，典型场景是状态标志和 DCL 单例——不加 volatile 的 DCL 可能因为 new 被重排成"先赋引用再初始化"，让别的线程拿到半成品对象。但 volatile 不保证原子性，两个线程对 volatile 变量做 i++ 照样丢更新，计数要用 Atomic 或加锁。

### 深入版（被追问时按编号展开）

1. **JMM 抽象**：先声明它不是物理结构，是规范；画主内存/工作内存图，讲普通变量读写走副本
2. **可见性模拟**：flag 死循环时间线——无 volatile 时线程 1 用本地副本 false 退不出；加 volatile 后写刷主内存 + 读失效重取；落到 x86 的 lock 前缀 + MESI
3. **有序性/DCL**：拆 new 为 分配→初始化→赋引用 三步，画重排后线程 2 在双重检查处拿到半成品对象的时间线；volatile 写屏障保证初始化先于引用可见
4. **原子性反例**：i++ 三步交错时间线，两次 ++ 结果 1，说明 volatile 只保证"读到的值最新"，不保证"读改写不可分"
5. **对比收尾**：volatile 管标志位，synchronized 管复合临界区，Atomic 管单变量无锁更新

### 常见追问

- **volatile 读一定读到最新写吗？**  happens-before：volatile 写 happens-before 后续 volatile 读；但"后续"指时间上的先后，无同步时仍可能交错（i++ 反例）
- **为什么 i 的单次读/单次写是原子的？** long/double 不保证（旧规范允许拆 32 位），volatile 强制原子；其余基本类型单读写原子
- **happens-before 和重排什么关系？** 它是 JMM 判定"操作 A 的结果对 B 可见"的规则集，重排不能违反 happens-before
- **MESI 不是已经保证缓存一致了吗，还要 volatile 干嘛？** MESI 保证的是缓存行最终一致，但写何时刷出、读何时失效由编译器/CPU 决定，volatile 给出强制点；且 JIT 优化（如 hoist 出循环）只有 volatile 语义能禁止
- **四种内存屏障分别禁什么？** volatile 读后加 LoadLoad/LoadStore（禁"读与后续"重排），volatile 写前加 StoreStore（禁"前面写与本次写"重排）、写后加 StoreLoad（禁"本次写与后续读"重排，开销最大）
