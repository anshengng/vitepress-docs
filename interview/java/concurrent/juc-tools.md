# JUC 三大工具类：CountDownLatch / CyclicBarrier / Semaphore

## 题目

> CountDownLatch、CyclicBarrier、Semaphore 分别用在什么场景？底层怎么实现？CountDownLatch 能重用吗？三者怎么选？

## 一句话定位

| 工具 | 一句话定位 | 生活类比 |
| --- | --- | --- |
| CountDownLatch | 一等全员：**一次性倒计时门闩** | 主人等 3 道菜全上齐才开饭，门开了就废 |
| CyclicBarrier | 互相等：**可复用的集结点** | 多人游戏等玩家到齐开局，下一局接着用 |
| Semaphore | 控并发数：**车牌** | 停车场 2 个车位，进拿牌、出还牌 |

```
CountDownLatch：main ──等──► [T1 T2 T3 全部完成]   单向等待（一/多 等 多）
CyclicBarrier： [T1 T2 T3] ──互相等──► 到齐集体放行  相互等待（无主次）
Semaphore：    同时最多 N 个线程在区内，多的门口排队  限流闸机
```

## 核心要点

### CountDownLatch：一次性倒计时门闩

#### 场景时间线：并行加载三个配置，全部就绪后启动服务

```
latch = new CountDownLatch(3)

时刻   main 线程                      T1(数据库配置)  T2(缓存配置)  T3(MQ配置)   state
 t1    new CountDownLatch(3)                                                    3
 t2    提交 T1/T2/T3 ───────────────►│
 t3    await()：state≠0 → 阻塞 ⏳     加载中...      加载中...     加载中...
 t4                                    完成 countDown ─────────────────────────► 2
 t5    仍阻塞 ⏳                                       完成 countDown ──────────► 1
 t6                                                     完成 countDown ─────────► 0
 t7    被唤醒放行 ✅ → 启动服务
```

要点：countDown 只是"喊一声到了"并不阻塞；谁先谁后无所谓，只看"计数是否归零"；**归零后门永久打开，不可复位**。

底层一句：AQS **共享模式**，state = 计数值（AQS 的 state + 队列结构详见锁篇）；countDown 即 releaseShared 让 state 减 1，减到 0 唤醒所有 await 的线程；await 即 acquireSharedInterruptibly，state 为 0 才放行。

### CyclicBarrier：可复用的集结点

#### 场景时间线：3 人游戏，到齐开局，下一局继续等

```
barrier = new CyclicBarrier(3, () -> announce("人齐，开局！"))

时刻   T1(玩家1)         T2(玩家2)         T3(玩家3)       barrier 计数(count/parties)
 t1    加载地图...       加载皮肤...       加载音效...      3 / 3
 t2    await() 到达 ⏳                    （count 3→2）
 t3                      await() 到达 ⏳   （count 2→1）
 t4                                       await() 到达（1→0）
                                          → 先执行 barrierAction（喊"开局"）
                                          → signalAll 唤醒全体 🎉
                                          → 自动复位 count=3
 t5    ──────── 三人同时进入对局 #1 ────────
 t6    对局结束，各自再 await() ⏳ ...      ← 原地复用，不用新建对象
```

要点：**所有人到齐才集体放行**（一起动，没有"先走的一方"）；放行后自动复位可无限复用；等待中任一线程中断/超时 → barrier **broken**，所有人抛 BrokenBarrierException，需 reset() 或重建。

底层一句：ReentrantLock + Condition 实现（不直接用 AQS state）；await 到达时 count 递减，减到 0 执行屏障动作、唤醒全体、复位计数。

### Semaphore：并发数车牌

#### 场景时间线：permits=2 的停车场，三辆车抢两个车位

```
semaphore = new Semaphore(2)   // 2 个车位

时刻   T1(车1)            T2(车2)            T3(车3)          剩余车位(state)
 t1    acquire ✅ 进场                                       2→1
 t2                       acquire ✅ 进场                     1→0
 t3                                          acquire ⏳ 阻塞   0（排队等车位）
 t4    出场 release ───────────────────────────────────────►  0→1（还牌）
 t5                                          被唤醒，进场 ✅   1→0
```

要点：acquire 拿许可（拿不到阻塞）、release 还许可，许可数 = "最多同时几个线程在干活"。

**公平 vs 非公平一句**：非公平（默认）= 新来的先尝试直接抢，抢不到再排队，吞吐高；公平 = 严格先到先得，有排队的不许插队。

### 三者对比表

| 维度 | CountDownLatch | CyclicBarrier | Semaphore |
| --- | --- | --- | --- |
| 可复用 | ❌ 一次性，归零作废 | ✅ 到齐自动复位 | ✅ release 后许可回归 |
| 角色关系 | 主从：一方等其他方 | 平等：互相等、一起走 | 门卫：控制同时进入的数量 |
| 底层状态方向 | countDown → state 递减，await 等归零 | await → 已到数递增，计满 parties 放行 | acquire → state 递减，release → state 递增 |
| 底层实现 | AQS 共享模式 | ReentrantLock + Condition | AQS 共享模式 |
| 触发后行为 | 唤醒等待方，各自继续 | 全体同时放行，可带 barrierAction | 拿到许可的进入，其余继续排队 |

### 实际应用怎么选

| 场景 | 选型 | 例子 |
| --- | --- | --- |
| 并行任务汇总 | Latch | 10 个下游接口并行调用，主线程汇总返回（配合线程池，见线程池篇） |
| 服务启动依赖 | Latch | 等配置/缓存/连接池全部就绪再开放流量 |
| 分段计算合并 | Barrier | 大数组切 N 段并行算，各段算完在屏障点合并部分结果 |
| 批量任务分批跑 | Barrier | 100 个任务 10 个一批，每批到齐统一提交、统一等结果 |
| 限流/资源保护 | Semaphore | 数据库连接池限 20 个连接、下游接口限并发 50 |
| 削峰 | Semaphore | 秒杀入口只放 100 个并发进来，其余排队 |

## 面试答法

### 30 秒版（可背诵口语）

> 这三个都是 JUC 的线程协作工具。CountDownLatch 是一次性倒计时门闩：子线程 countDown 减计数，主线程 await 等计数归零放行，适合并行任务汇总和服务启动依赖，但归零就作废不能重用。CyclicBarrier 是可复用的集结点：多个线程互相等，全到齐才集体放行，然后自动复位，适合分段计算合并这种"人到齐一起走"的场景。Semaphore 是许可证：acquire 拿、release 还，用来限制同时访问的并发数，比如连接池和接口限流。底层上 Latch 和 Semaphore 基于 AQS 共享模式，Barrier 是锁加条件队列。选型口诀：一方等其他方用 Latch，互相等可复用用 Barrier，控并发用 Semaphore。

### 深入版（被追问时按编号展开）

1. **定位表**：先用一句话 + 生活类比把三者区分开
2. **CountDownLatch**：画"并行加载配置后启动服务"时间线 → AQS 共享模式 state=count → 一次性
3. **CyclicBarrier**：画"多人游戏开局"时间线 → 自动复位可复用 → broken 语义一句
4. **Semaphore**：画"三车抢两车位"时间线 → 公平/非公平一句
5. **对比表**：可复用 / 角色关系 / 底层状态方向（减法计数、增法计数、增减成对）
6. **落到项目**：讲一个真实用法（如并行调下游 + Latch 汇总超时兜底）

### 常见追问

- **Latch 能重用吗？** → 不能，计数归零后永久放行；要重用换 CyclicBarrier，或每次任务新建一个 Latch
- **CyclicBarrier 和 Latch 互换场景怎么选？** → "一方等其他方完成、只等一次"用 Latch（主从、单向）；"多方互相等、到齐一起动、还要循环用"用 Barrier（平等、可复位）；只跑一次的"多等一"两者都行，但 Latch 语义更直白
- **countDown 的线程会阻塞吗？** → 不会，减完计数就走；await 才阻塞
- **Semaphore 的许可能被别的线程释放吗？** → 能，release 不校验持有者，适合"获取和释放不在同一线程"的场景，但要防多释放
- **Latch 计数能加大吗？** → 不能，构造时定死；需要动态增减参与方用 Phaser
- **Barrier 等待中有人中断会怎样？** → barrier broken，所有等待者抛 BrokenBarrierException，避免别人永久等下去
