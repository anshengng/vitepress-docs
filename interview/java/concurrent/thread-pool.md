# 线程池参数与工作流程

## 题目

> ThreadPoolExecutor 有哪些核心参数？任务提交后的执行流程是怎样的？为什么不推荐用 Executors？线程数该如何设置？

## 核心要点

### 为什么需要线程池：裸 new Thread 三宗罪

```
裸写法：
  new Thread(task).start();    // 每来一个任务现造一个线程

① 创建/销毁开销大：线程映射内核线程，创建销毁都要系统调用、分配栈内存
② 数量不可控：来一个任务造一个线程 → 高并发下线程爆炸 → CPU 疯狂切换 / 内存 OOM
③ 不可管理：没法统一命名、监控排队数、限流、优雅关闭，更谈不上复用
```

线程池 = 把线程当资源**池化**：复用吃掉创建开销，最大数兜住系统，队列削峰填谷。

### 七大参数

```java
new ThreadPoolExecutor(
    corePoolSize,      // 核心线程数：常驻，空闲也不回收（除非 allowCoreThreadTimeOut）
    maximumPoolSize,   // 最大线程数：核心 + 临时线程的总上限
    keepAliveTime,     // 临时线程空闲多久后被回收
    unit,              // keepAliveTime 的时间单位
    workQueue,         // 任务队列：核心线程忙时任务在此排队
    threadFactory,     // 线程工厂：统一命名/优先级/守护标记（排查问题全靠名字）
    handler            // 拒绝策略：池和队列全满后的处理方式
)
```

| 参数 | 一句话解释 |
| --- | --- |
| corePoolSize | 正式工：保底干活的人，空闲也留着 |
| maximumPoolSize | 正式工 + 临时工的总上限 |
| keepAliveTime | 临时工没事干多久后被辞退 |
| unit | 上面这个时间用秒还是毫秒 |
| workQueue | 排队的候客区（建议有界队列） |
| threadFactory | 造线程的工厂，顺便给线程起名 |
| handler | 全满了之后新任务怎么办 |

### 执行流程决策图

```
execute(task)
    │
    ▼
当前线程数 < core？──── 是 ───► 创建【核心线程】直接执行该任务
    │ 否
    ▼
队列能装下？─────────── 是 ───► 任务入队，等核心线程空出来按序取走
    │ 否（队列也满了）
    ▼
当前线程数 < max？───── 是 ───► 创建【非核心线程】直接执行
    │ 否（连 max 都到了）
    ▼
触发拒绝策略 handler.rejectedExecution(task, this)
```

⚠️ 反直觉点：是**先排队、后加人**——队列满了才开非核心线程，而不是先把人开满再排队。

### 模拟时间线：core=2、队列容量=2、max=4，连续提交 7 个任务

假设每个任务都很耗时（核心线程不会很快空出来）：

```
第1个 ─► 线程0<2 ─► 建核心 T1 ──── T1 执行【任务1】
第2个 ─► 线程1<2 ─► 建核心 T2 ──── T2 执行【任务2】
第3个 ─► 核心已满 ─► 队列0/2 ─────────────► 【任务3】入队排队
第4个 ─► 核心已满 ─► 队列1/2 ─────────────► 【任务4】入队排队
第5个 ─► 核心+队列全满 ─► 线程2<4 ─► 建临时 T3 ──── T3 执行【任务5】
第6个 ─► 核心+队列全满 ─► 线程3<4 ─► 建临时 T4 ──── T4 执行【任务6】
第7个 ─► 4线程忙 + 2任务排队 = 全满 ────────────► 触发【拒绝策略】❌
```

注意第 3、4 个：**没有**直接开新线程，而是去排队；第 5、6 个因为队列满了才"紧急招人"。

### 4 种拒绝策略

| 策略 | 行为 | 适用场景 |
| --- | --- | --- |
| AbortPolicy（默认） | 抛 RejectedExecutionException | 任务不能丢，靠异常 + 告警兜底 |
| CallerRunsPolicy | 提交任务的线程自己执行 | 天然限流：调用方被拖住就慢点提交；且不丢任务 |
| DiscardPolicy | 静默丢掉新任务 | 允许丢失的场景（日志上报类） |
| DiscardOldestPolicy | 丢掉队列里最老的任务，把新的塞进去 | 只关心最新值的场景（行情推送） |

### 为什么不推荐 Executors（两个坑）

```
坑1：newFixedThreadPool(10) / newSingleThreadExecutor()
     队列 = LinkedBlockingQueue，容量 Integer.MAX_VALUE ≈ 无界
     生产 > 消费 ──► 任务无限堆积在队列 ──► 堆内存 OOM

     [任务][任务][任务][任务]... ∞（21 亿容量的口袋，装得下就往里塞）

坑2：newCachedThreadPool()
     max = Integer.MAX_VALUE，队列 = SynchronousQueue（不存任务，直接手递手）
     突发流量 ──► 来一个任务建一个线程 ──► 线程数爆炸 ──► OOM / CPU 耗尽

     T1 T2 T3 T4 T5 ... ∞（要多少建多少）
```

结论（阿里规约）：一律手动 new ThreadPoolExecutor，显式指定**有界队列 + 明确的拒绝策略 + 有业务含义的线程名**。

### 线程数怎么定

| 任务类型 | 经验值 | 理由 |
| --- | --- | --- |
| CPU 密集 | N + 1 | 核数再多也是抢 CPU；+1 防偶发缺页暂停导致 CPU 空转 |
| IO 密集 | 2N，或 N × (1 + 等待时间/计算时间) | 大部分时间在等 IO，多开线程才吃得满 CPU |

经验值只是**起点**，生产以压测为准；进阶做法是动态调参（参数放配置中心，运行时 setCorePoolSize 热更新）。

### shutdown vs shutdownNow 与 5 种状态

| 对比 | shutdown() | shutdownNow() |
| --- | --- | --- |
| 新任务 | 拒绝 | 拒绝 |
| 队列中任务 | 继续执行完 | 丢弃，并以 List 形式返回 |
| 正在执行的任务 | 让它跑完 | 尝试 interrupt 中断 |

5 种状态一句话：RUNNING 正常接活 → SHUTDOWN 不接新活、干完存量 → STOP 不接新、中断在干的、清空队列 → TIDYING 全部干完的过渡瞬间 → TERMINATED 终结。

标准关闭姿势：先 shutdown() 拒绝新任务 → awaitTermination(超时) 等存量跑完 → 等不到再 shutdownNow() 强制收尾。

## 面试答法

### 30 秒版（先给框架）

> 线程池七大参数：核心线程数、最大线程数、空闲回收时间、时间单位、任务队列、线程工厂、拒绝策略。执行流程是：提交任务先看核心线程满没满，没满就建核心线程直接干；满了就入队排队；队列也满了且没到最大线程数，就建临时线程；到最大了就触发拒绝策略——注意是先排队后加临时线程，这点很反直觉。生产上不推荐 Executors，因为 fixed 用的是无界队列会堆积任务 OOM，cached 最大线程数是 21 亿会线程爆炸，所以要手动创建、用有界队列、明确拒绝策略。线程数 CPU 密集 N+1、IO 密集 2N 起步，最终以压测为准。

### 深入版（被追问时按这条线展开）

1. **为什么需要**：裸 new Thread 三宗罪（创建开销 / 数量失控 / 不可管理）
2. **参数**：七个参数逐个一句话，重点讲队列和拒绝策略
3. **流程**：决策图，强调"先队列后临时线程"的反直觉点，用 core=2/queue=2/max=4 推演 7 个任务各去哪
4. **坑**：Executors 两个 OOM 坑（无界队列 / 无限线程），给出手动创建的规约结论
5. **调参**：CPU 密集 N+1、IO 密集 2N，压测定，提一句动态调参
6. **收尾**：shutdown 与 shutdownNow 的优雅关闭组合拳

### 常见追问

- **核心线程能被回收吗？** → 默认不回收；allowCoreThreadTimeOut(true) 后核心线程也按 keepAliveTime 回收
- **"非核心线程"是固定哪几个？** → 没有编号之分，谁空闲超过 keepAliveTime 谁被回收，只保证核心数保底
- **任务队列推荐哪个？** → 有界的 LinkedBlockingQueue / ArrayBlockingQueue；任务直传用 SynchronousQueue；有优先级用 PriorityBlockingQueue
- **先提交的一定先执行吗？** → 不保证：队列满时后提交的任务可能被临时线程先执行（见模拟第 5 个）
- **任务抛异常会怎样？** → 任务内不 try-catch 的话异常被吞、线程悄悄死掉并被新线程补上；要 catch 或给线程设 UncaughtExceptionHandler
- **线程池怎么监控？** → beforeExecute/afterExecute 钩子，或定期读 getActiveCount/getQueue().size()/getCompletedTaskCount
