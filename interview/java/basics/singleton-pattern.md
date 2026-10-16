# 单例模式：6 种写法与破坏手段

## 题目

> 手写一个线程安全的单例。为什么要 double-check？DCL 为什么要 volatile？静态内部类和枚举为什么更好？反射和序列化怎么破坏单例？

## 为什么需要

有些对象全局只需要一份：配置中心、连接池、注册表。多 new 一份轻则浪费内存，重则状态错乱（两个"配置对象"内容不一致）。

```
不控制：                              单例：
main ─► new Config() ─► [配置A]        main ──► getInstance() ─┐
main ─► new Config() ─► [配置B]        main ──► getInstance() ─┼──► 全局唯一 [Config]
main ─► new Config() ─► [配置C]        main ──► getInstance() ─┘    （谁要都给同一份）
```

## 核心要点：6 种写法演进

### ① 饿汉式：类加载即创建

```java
public class Singleton {
    private static final Singleton INSTANCE = new Singleton();
    private Singleton() {}
    public static Singleton getInstance() { return INSTANCE; }
}
```

优：简单、类加载天然线程安全。缺：**不管用不用，启动就占内存**；还没到"第一次使用"。

### ② 懒汉式（无锁）→ 多线程翻车现场（必考）

```java
public static Singleton getInstance() {
    if (instance == null) {        // 两个线程同时判空…
        instance = new Singleton();
    }
    return instance;
}
```

```
竞争时间线（必画）：

线程A                              线程B
 t1  if (instance == null) ✓
 t2                                   if (instance == null) ✓   ← A 还没 new 完
 t3  new Singleton() → 实例1
 t4                                   new Singleton() → 实例2  💥 两个对象！
 t5  return 实例1
                                        return 实例2            → 全局唯一被打破
```

### ③ synchronized 方法：太重

```java
public static synchronized Singleton getInstance() { ... }
```

安全但**每次获取实例都排队**——其实只有第一次创建才需要锁，后面全在读，纯浪费。

### ④ DCL 双检锁（必考）

```java
public class Singleton {
    private static volatile Singleton instance;   // ⚠️ volatile 不可省
    public static Singleton getInstance() {
        if (instance == null) {                   // 第一次判空：没锁，热路径零成本
            synchronized (Singleton.class) {
                if (instance == null) {           // 第二次判空：拿锁后再确认
                    instance = new Singleton();
                }
            }
        }
        return instance;
    }
}
```

- 第一层 check：挡住 99% 的读请求，不用抢锁
- 第二层 check：两个线程都过了第一层时，后进锁的那个发现已创建，不再重复 new

**为什么必须 volatile？** `new Singleton()` 不是原子的：①开内存 → ②初始化字段 → ③引用指向地址，指令重排可能变成 ①③②——**外部线程看到"非 null 但半成品"的对象**，直接拿去用就炸。（重排的完整原理见 volatile-JMM 篇）

### ⑤ 静态内部类（推荐）

```java
public class Singleton {
    private Singleton() {}
    private static class Holder {                       // Holder 加载时才创建
        private static final Singleton INSTANCE = new Singleton();
    }
    public static Singleton getInstance() { return Holder.INSTANCE; }
}
```

```
加载时机图解：
外部类 Singleton 加载 ──(lazy)── Holder 不会跟着加载
main: getInstance()      ←—— 第一次触发
        └──► 触碰 Holder.INSTANCE ──► 类加载器加载 Holder ──► 静态初始化 new
                                      （JVM 保证类初始化线程安全，天然锁）

效果 = 饿汉的线程安全 + 懒汉的按需加载，且不用自己写锁
```

### ⑥ 枚举（Effective Java 推荐）

```java
public enum Singleton {
    INSTANCE;
    public void doSomething() { ... }
}
```

**天然防反射 + 防序列化**（JVM 层面保证，见下），写法还最短。

### 反射 / 序列化如何破坏单例

```
【反射二次 new 图解】
正常: getInstance() ──► [instance]
攻击: constructor.setAccessible(true);
      constructor.newInstance();  ──► 绕过私有构造器 ──► [新对象]  💥

防线：构造器里加判断
private Singleton() {
    if (instance != null) throw new RuntimeException("别搞我，我是单例");
}
```

序列化破坏：反序列化 `readObject` 会**新建对象**，不走构造器。防线：加 `readResolve()`：

```java
protected Object readResolve() { return getInstance(); }  // 返回已有实例，新对象被丢
```

**两道防线一张表**：

| 写法 | 防反射 | 防序列化 |
| --- | --- | --- |
| DCL / 静态内部类 | 手写构造器判断 | 手写 readResolve |
| 枚举 | 天然防（JVM 拒绝对枚举 newInstance） | 天然防（按名字返回同一实例） |

### 与 Spring 单例的区别一句

Spring 的"单例"是 **IoC 容器作用域**（一个容器一个 Bean，`getBean` 返回同一份），但 `new` 仍能创建多个——它是**容器管理**的单例，不是 JVM 级语言机制强制。

## 面试答法

### 30 秒版（可背诵）

> 简单场景我会先写静态内部类：利用 JVM 类加载机制天然线程安全，又保留了懒加载，不用自己写锁。如果面试官要 DCL，核心是两次判空加 volatile：第一层判空挡住热路径避免每次抢锁，第二层在锁内防止重复创建，volatile 是为了防止 new 的指令重排让别的线程拿到半成品对象。最稳的是枚举，Effective Java 推荐，因为 JVM 层面天然防反射和防序列化破坏。反射能绕过私有构造器，防线是构造器里判实例；序列化破坏的防线是 readResolve 返回已有实例。另外注意 Spring 单例是容器作用域的，跟语言级单例不是一回事。

### 深入版（被追问时按编号展开）

1. **演进线索**：饿汉（简单但急）→ 懒汉（翻车）→ synchronized（太重）→ DCL（对但容易错）→ 静态内部类（优雅）→ 枚举（最优）
2. **必画**：懒汉无锁的两线程竞争时间线，说明为什么必须锁
3. **DCL 细节**：两层 check 各自的作用 + volatile 防半成品（深入原理甩给 volatile-JMM 篇）
4. **破坏与防线**：反射二次 new 图 + 构造器判断；序列化 + readResolve；枚举为什么天然免疫
5. **加分收尾**：Spring 单例 vs JVM 单例的区别

### 常见追问

- **不加 volatile 的 DCL 一定出问题吗？** → 概率性问题，低并发测不出，高并发偶现半成品对象，属于"能跑但有坑"
- **为什么两次 check 缺一不可？** → 去掉外层：每次都抢锁性能差；去掉内层：两个线程排队后各 new 一次
- **静态内部类为什么天然线程安全？** → JVM 保证类初始化有锁（`<clinit>`），且是首次主动使用时才加载
- **饿汉有什么不好？** → 类加载即创建，可能延迟启动/占内存；但简单场景也够用，不必教条
