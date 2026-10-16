# ThreadLocal 原理与内存泄漏

## 题目

> ThreadLocal 的实现原理是什么？为什么 key 要用弱引用？ThreadLocal 内存泄漏是怎么发生的，怎么避免？线程池场景下 ThreadLocal 有什么坑？InheritableThreadLocal 和 TransmittableThreadLocal 了解吗？

## 为什么需要 ThreadLocal

有些数据"一个线程一份"就够，不该共享：数据库连接、SimpleDateFormat、请求上下文（userId/traceId）。
用 `Map<Thread, Value>` 全局共享？——所有线程抢一把锁读写同一个 Map，并发瓶颈。
ThreadLocal 反过来：**把 Map 挂到每个 Thread 自己身上**，各用各的，天然无竞争。

## 核心要点

### 结构图解：数据到底存在哪

```
Thread 对象 t1
  └─ t1.threadLocals (ThreadLocalMap)
        └─ Entry[] table
             [0] Entry: key = WeakReference<ThreadLocal A> ──► 堆上的 ThreadLocal A（外部引用）
                      value = "连接对象1"
             [1] Entry: key = WeakReference<ThreadLocal B> ──► ThreadLocal B
                      value = "SDF实例"
             ...
```

关键关系（面试常画错）：

- `ThreadLocal` 对象本身只是 **key / 访问凭证**，`get()/set()` 时是拿 `this`（ThreadLocal 实例）去当前线程的 Map 里查
- **value 存在 Thread 的 Map 里，不是存在 ThreadLocal 里**
- Entry 继承 `WeakReference<ThreadLocal<?>>`：key 弱引用，value 是普通强引用

### 为什么 key 用弱引用（对比强引用）

```
线程结束时 GC 视角：

key 强引用：  Thread ─► ThreadLocalMap ─► Entry ─► ThreadLocal（回收不掉）
                                         └─► value（回收不掉）   → 整条链全泄漏

key 弱引用：  Thread ─► ThreadLocalMap ─► Entry ─┬─► ThreadLocal ╳（GC 可回收，key 变 null）
                                                 └─► value（还挂着！）→ 半泄漏，但 key=null 给了"清理信号"
```

弱引用不是"解决"泄漏，而是让泄漏**可被发现、可被清理**：每次 get/set/remove 都会顺带清理 key==null 的 Entry（`expungeStaleEntry`）。若 key 是强引用，ThreadLocal 实例本身都被钉死，连信号都没有。

### 内存泄漏时间线：线程池里的长命线程

线程不死，Map 就一直活着——这才是泄漏主战场：

```
时刻  业务线程（线程池工作线程 T，长期存活）         GC
 t1   public void handle() {
        ThreadLocal<User> tl = new ThreadLocal<>();  // 栈上局部变量 tl
        tl.set(currentUser);                         // Entry(key=tl弱引用, value=currentUser)
     }   // 方法结束，tl 出栈，外部强引用消失
 t2                                          Young GC：tl 弱可达 → 回收，Entry.key 置 null
 t3   Thread T ─► threadLocals ─► Entry(key=null) ─► value=currentUser 仍被引用 ❌
 t4   下一个任务又 new ThreadLocal()... 旧 Entry 的 value 永远没人访问
 →  成百上千个 key=null 的 Entry 堆积 → value 对象堆积 → OOM
```

引用链一句话：**Thread（活着）→ ThreadLocalMap → Entry → value**，key 断了，value 这条腿还站着。

### 正确姿势：用完必须 remove

```java
try {
    USER_TL.set(user);
    doBusiness();
} finally {
    USER_TL.remove();   // 删 Entry + 断 value 引用，双断
}
```

- `remove()` 是唯一能同时清 key=null Entry 和 value 的方法；get/set 的"顺带清理"只清探测路径上的部分脏 Entry，不保证清干净
- ThreadLocal 声明为 **static final** 复用，避免每次 new 制造脏 Entry

### 线程池复用导致脏数据串号（比泄漏更致命）

```java
// 拦截器 set，业务 get —— 但没 remove
static ThreadLocal<Long> USER_ID = new ThreadLocal<>();
```

模拟同一工作线程 T 先后服务两个请求：

```
时刻  请求A（userId=1001）在 T 上          请求B（userId=2002）也调度到 T
 t1   拦截器：USER_ID.set(1001)
 t2   业务：USER_ID.get() → 1001 ✅
 t3   请求结束，T 回池子，Entry 没 remove，value 仍是 1001
 t4                                        请求B 没走拦截器（如内部调用）
 t5                                        业务：USER_ID.get() → 1001 ❌ 串号！
 → B 的请求以 A 的身份执行，越权/数据错乱
```

所以规范是"**用前 set、用后 finally remove**"，绝不能依赖"每个请求都会 set"。

### 补充知识点（一句话级）

- **InheritableThreadLocal**：子线程创建时从父线程拷贝一份 Map——只拷贝**创建那一刻**的值，线程池里线程早建好了，池化场景无效
- **TransmittableThreadLocal**（阿里 TTL）：装饰 Runnable/线程池，在**任务提交时**捕获上下文、**执行时**回放，解决线程池传递问题
- **FastThreadLocal**（Netty）：用数组下标代替哈希查找 + 自己维护注册表，get 更快且能主动清理，规避 ThreadLocalMap 的哈希冲突与脏 Entry

## 面试答法

### 30 秒版（可背诵口语）

> ThreadLocal 的思路是把存储挂在每个 Thread 上：Thread 里有 ThreadLocalMap，key 是 ThreadLocal 实例的弱引用，value 才是真正的值，get/set 都是拿当前线程的 Map 来操作，所以线程之间互不干扰。内存泄漏的根源是：方法结束后 ThreadLocal 外部引用消失，key 被 GC 回收变成 null，但 value 还被 Thread→Map→Entry 这条强引用链挂着；普通线程退出没事，线程池线程长期不死，脏 Entry 越积越多就泄漏。所以用完必须在 finally 里 remove。线程池里不 remove 还有更危险的脏数据串号问题——上一个请求的 userId 被下一个请求 get 到。

### 深入版（被追问时按编号展开）

1. **结构**：画 Thread→threadLocals→Entry[] 三层图，强调 value 存在线程身上、ThreadLocal 只是 key
2. **弱引用动机**：对比强/弱引用下线程结束时 GC 能否回收；弱引用让 key 变 null 成为"可清理信号"，get/set 顺带 expungeStaleEntry
3. **泄漏时间线**：方法出栈→key 回收→value 仍被 Entry→Thread 链引用→线程池长期存活堆积
4. **remove 规范**：static final + try/finally remove；解释为什么 get/set 的顺带清理不够
5. **串号模拟**：线程 T 处理请求 A 存 1001，回池未清，请求 B 直接 get 到 1001 的时间线，说危害（越权）
6. **延伸**：Inheritable 只在 new Thread 时拷贝、池化失效；TTL 提交时捕获执行时回放；Netty FastThreadLocal 数组寻址

### 常见追问

- **为什么 value 不设计成弱引用？** → value 可能没有外部引用但业务上还要用（只通过 ThreadLocal 访问），弱引用会被误回收
- **ThreadLocalMap 为什么用开放地址法不用链表？** → key 弱引用随时变 null、Entry 生命周期特殊，线性探测顺路清理脏 Entry 更自然；冲突少场景性能不差
- **调用 remove 后 Entry 就彻底干净了吗？** → key/value 都置 null，槽位等后续清理；哈希表本身不会缩容，但对象已可回收
- **ThreadLocal 和 synchronized 都能解决并发，怎么选？** → synchronized 共享一份数据靠排队互斥；ThreadLocal 每线程一份副本不共享，适合无共享语义的上下文/工具对象
- **Tomcat 的 Webapp 类加载器场景 ThreadLocal 有什么坑？** → 热部署时旧 ClassLoader 被 ThreadLocalMap 的 value/key 引用钉死，导致类加载器泄漏（呼应双亲委派/类加载器章节）
