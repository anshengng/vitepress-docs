# synchronized 与 ReentrantLock

## 题目

> synchronized 和 ReentrantLock 有什么区别？各自的底层原理是什么？锁升级是怎么回事？怎么选型？

## 核心要点

### synchronized 三种用法与锁对象

| 用法 | 锁的对象 |
| --- | --- |
| 实例方法：`synchronized void m()` | this（当前实例） |
| 静态方法：`static synchronized void m()` | 类的 Class 对象（全局唯一，所有实例共享） |
| 代码块：`synchronized (obj)` | 括号里指定的 obj |

一个常见 bug——锁了"不同对象"，等于没锁：

```
class Counter {
    private int count;
    synchronized void add() { count++; }   // 锁的是 this
}

Counter c1 = new Counter();
Counter c2 = new Counter();

T1: c1.add() ── 锁 c1 ──┐
T2: c2.add() ── 锁 c2 ──┤ 两把不同的锁，互不阻塞
→ 看着加了锁，count 照样被并发改丢数据 ❌
（想要全局互斥：锁 static 方法/Class 对象，或用静态共享的锁对象）
```

### monitor 机制一句话

synchronized 代码块编译成 monitorenter / monitorexit 两条字节码指令（方法级则靠 ACC_SYNCHRONIZED 标志隐式加锁）；每个对象都关联一个 Monitor（ObjectMonitor）：抢到锁的线程记为 owner，抢不到的进 EntryList 阻塞排队，wait 的进 WaitList。

### 锁升级路径（JDK 6 优化）

```
      只有一个线程反复拿锁       出现第二个线程          自旋也抢不过/竞争激烈
无锁 ───────────────► 偏向锁 ───────────────► 轻量级锁 ───────────────► 重量级锁
                        │                       │                        │
                  MarkWord 直接              CAS 把 MarkWord            膨胀为 Monitor，
                  记下线程 ID，              指向栈中 LockRecord，       阻塞涉及用户态/
                  之后连 CAS 都省            失败短暂自旋重试            内核态切换，最重

只能升级不能降级（直到对象被 GC 回收重建）。
JDK 15 起偏向锁被整体废弃：现代高并发下收益太小，维护成本却很高。
```

### 可重入原理

锁记录"持有线程 + 计数器"：同线程再次拿锁不阻塞，计数 +1，退出 -1，减到 0 才真正释放。

```
T1 进入 m1()：owner = T1，计数 = 1
T1 在 m1 里调用 m2()（也是 synchronized）：
    发现 owner 就是自己 → 不阻塞，计数 = 2，直接进
T1 从 m2 返回：计数 = 1
T1 从 m1 返回：计数 = 0 → 真正释放锁
（如果没有可重入：同步方法调用另一个同步方法，会把自己锁死——死锁）
```

### ReentrantLock 能力清单

| 能力 | API | 解决什么 |
| --- | --- | --- |
| 尝试获取 | tryLock() | 拿不到立刻返回 false 走别处，不死等 |
| 超时获取 | tryLock(3, TimeUnit.SECONDS) | 限时等待，杜绝无限阻塞 |
| 公平锁 | new ReentrantLock(true) | 先到先得（吞吐低，特殊需求才用） |
| 可中断 | lockInterruptibly() | 等锁期间能响应 interrupt |
| 多条件队列 | Condition await/signal | 一把锁挂多个等待队列，精准唤醒某一类线程 |

### AQS 原理简图

ReentrantLock 建立在 AQS（AbstractQueuedSynchronizer）上，核心两件套：

```
① volatile int state      0 = 没人拿锁，> 0 = 重入次数
② CLH 双向队列            抢锁失败的线程包装成 Node 挂队、park 挂起

        head                                        tail
         ▼                                           ▼
       ┌──────────┐   ┌──────────┐   ┌──────────┐
       │ 空头节点  │◄► │ Node(T2) │◄► │ Node(T3) │      exclusiveOwnerThread = T1
       └──────────┘   └──────────┘   └──────────┘
                       排队等锁的线程（前驱释放后唤醒后继）
```

模拟两个线程抢非公平锁：

```
时刻  T1                              T2                          state   队列
 t0  lock() → CAS(0→1) 成功                                        1      空
     exclusiveOwnerThread = T1
 t1                                  lock() → CAS(0→1) 失败
                                     包装成 Node 入队
                                     LockSupport.park() 挂起 ⏸     1      [T2]
 t2  执行临界区...                                                 1      [T2]
 t3  unlock() → state 置 0
     unpark 唤醒队首 T2                                            0      [T2]
 t4                                  被 unpark 唤醒
                                     重试 CAS(0→1) 成功，出队      1      空
                                     T2 开始执行临界区
```

非公平的含义：任何线程在 CAS 前都可以"插队"——锁刚释放时恰好新来的线程直接 CAS 成功，队列里的 T2 就得再等；换来的是少切换、吞吐更高。

### synchronized vs ReentrantLock 全面对比

| 对比项 | synchronized | ReentrantLock |
| --- | --- | --- |
| 实现层面 | JVM 内置关键字 | JDK 类库，基于 AQS |
| 加/解锁 | 自动：出了代码块就释放，抛异常也不漏 | 手动 lock()，必须在 finally 里 unlock() |
| 尝试/超时 | 不支持 | tryLock / tryLock(timeout) |
| 可中断 | 不支持 | lockInterruptibly |
| 公平性 | 只有非公平 | 构造参数可选公平/非公平 |
| 条件队列 | 一个（wait/notify 随机唤醒） | 多个 Condition，精准唤醒 |
| 性能 | JDK 6 锁升级后与 Lock 基本持平 | 同左 |
| 便利性 | 语法最简单，永远不会忘释放 | 功能强但样板代码多 |

### 选型建议

```
需要 tryLock / 超时 / 公平 / 可中断 / 多 Condition 吗？
   ├─ 都不需要 ──► synchronized（写法简单、自动释放、JVM 持续优化）✅ 默认选它
   └─ 任意一个需要 ──► ReentrantLock（记得 finally + unlock）
```

### Condition 实现生产者消费者（一把锁，两个条件队列）

```java
class Buffer {
    private final int[] items = new int[10];
    private int count, putIdx, takeIdx;
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition notFull  = lock.newCondition();   // 生产者睡这里
    private final Condition notEmpty = lock.newCondition();   // 消费者睡这里

    public void put(int v) throws InterruptedException {
        lock.lock();
        try {
            while (count == items.length) notFull.await();    // 满了：生产者挂起
            items[putIdx] = v;
            if (++putIdx == items.length) putIdx = 0;
            count++;
            notEmpty.signal();                                // 有货了：叫醒一个消费者
        } finally {
            lock.unlock();
        }
    }

    public int take() throws InterruptedException {
        lock.lock();
        try {
            while (count == 0) notEmpty.await();              // 空了：消费者挂起
            int v = items[takeIdx];
            if (++takeIdx == items.length) takeIdx = 0;
            count--;
            notFull.signal();                                 // 腾位了：叫醒一个生产者
            return v;
        } finally {
            lock.unlock();
        }
    }
}
```

对比 wait/notify：后者只有一个等待队列，notify 叫醒的不一定是"对的人"；两个 Condition 让生产者/消费者分开睡，谁来叫醒谁，唤醒更精准。

## 面试答法

### 30 秒版（先给框架）

> synchronized 是 JVM 内置关键字，三种用法分别锁 this、Class 对象和指定对象；底层靠对象头 MarkWord 加 Monitor，JDK 6 之后有锁升级：单线程反复拿是偏向锁，出现竞争就 CAS 自旋变轻量级锁，竞争再激烈就膨胀成依赖操作系统 mutex 的重量级锁，只能升不能降，JDK 15 后偏向锁废弃了。ReentrantLock 是 AQS 实现的 JDK 类，volatile state 加 CLH 双向队列，抢不到就入队 park；它比 synchronized 多了 tryLock、超时、公平、可中断和多个 Condition。性能上两者现在基本持平，选型就是：简单互斥用 synchronized，需要那五个高级能力才上 ReentrantLock，并且别忘了 finally 里 unlock。

### 深入版（被追问时按这条线展开）

1. **用法与坑**：三种用法锁对象对照，举"锁了不同实例等于没锁"的 bug
2. **sync 原理**：monitor 一句 + 锁升级四阶段图 + 可重入计数器
3. **Lock 原理**：AQS = volatile state + CLH 双向队列，推演两线程抢锁时间线（CAS→入队 park→释放唤醒）
4. **对比**：从实现/功能/释放方式列差异，强调性能已不是决定因素
5. **选型**：简单场景 sync；需要超时/公平/多条件才 Lock
6. **加分**：Condition 双条件队列的生产者消费者，说明精准唤醒的价值

### 常见追问

- **偏向锁为什么被废弃？** → 高并发下很快升级，偏向收益变小，撤销逻辑维护成本却很高
- **锁升级后还能降级吗？** → 不能，直到对象被 GC；避免反复切换的开销
- **AQS 队列为什么是双向的？** → 唤醒看前驱状态、取消节点要摘链重接，双向指针 O(1) 完成
- **state 怎么表示重入？** → 每次重入 CAS +1，unlock 减 1，减到 0 才唤醒后继节点
- **公平锁一定更好吗？** → 不是：吞吐更低（严格排队换来频繁上下文切换），只在要求严格先来后到时用
- **synchronized 抛异常会释放锁吗？** → 会，monitorexit 在异常路径也会执行；Lock 若不写 finally 就真的漏锁了
