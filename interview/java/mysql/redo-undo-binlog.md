# redo log / undo log / binlog 三大日志

## 题目

> redo log、undo log、binlog 有什么区别？为什么要两阶段提交？崩溃恢复时 MySQL 怎么判断一条事务该提交还是回滚？

## 为什么需要三大日志

InnoDB 的数据页在磁盘上、修改先发生在内存（Buffer Pool）。如果直接改磁盘数据页，随机 IO 太慢，而且"改到一半宕机"数据页就废了。所以 MySQL 的思路是：**把"随机写数据"变成"顺序写日志"，靠日志来兜底一切异常**。三张日志各管一件事。

## 核心要点

### 总览：谁产生、存哪、干什么用

| 对比项 | redo log | undo log | binlog |
| --- | --- | --- | --- |
| 谁产生 | InnoDB 存储引擎 | InnoDB 存储引擎 | Server 层（执行器） |
| 存储内容 | 物理日志："页 X 偏移 Y 改成 Z" | 逻辑日志："把这次修改反着做回去" | 逻辑日志：语句/行变更（statement/row） |
| 写入时机 | 事务执行中持续写（WAL） | 事务执行中写 | 事务提交时一次性写 |
| 大小 | 固定大小、循环写（4 组 ib_logfile） | 不单独成文件，在回滚段里 | 追加写，不覆盖，可配过期删除 |
| 核心作用 | **持久性**：宕机不丢已提交事务 | **原子性**：回滚 + MVCC 版本链 | **归档/主从复制**：给别的系统看 |
| 崩溃后 | 恢复（redo 前滚） | 回滚未完成事务 | 与 redo 配合判断提交与否 |

一句话记忆法：**redo 保持久性、undo 保原子性、binlog 保归档与主从**。

### redo log 与 WAL：一次 update 的完整时间线

WAL（Write-Ahead Logging）：日志先落盘，数据页稍后再刷。

```
update t_user set age = 20 where id = 1;

① 找到 id=1 的数据页（不在内存则从磁盘读入 Buffer Pool）
② 在内存里把 age 改成 20，此时页变成"脏页"
③ 把"页12 offset88: 10→20"写进 redo log buffer（内存）
④ 事务提交时 redo log 落盘（fsync）→ 到这里宕机也不怕了
⑤ 脏页由后台线程择机刷盘（检查点机制）

时刻        宕机在哪一步           后果
 t3 之前        内存改完、redo 没落盘    ❌ 事务视为未提交，重启后仍是 10
 t4 之后 t5 之前 redo 已落盘、脏页没刷  ✅ 重启后拿 redo 重放，age=20
```

redo log 是循环写的：

```
write pos（一直往前写）→        ↓ checkpoint（擦掉已落盘页的 redo，腾位置）
|====已写未刷====|====可写====|====已刷可覆盖====|
  若 write pos 追上 checkpoint → 必须停下来刷盘，MySQL 变慢（反压）
```

### undo log：回滚 + 版本链

每个事务修改数据前，先把旧值写进 undo log：

```
insert → undo 记 "delete 这行"
delete → undo 记 "insert 这行"
update → undo 记 "改前的值"

回滚时倒着执行 undo 即可复原 —— 这就是原子性的来源。

同时 undo 版本链支撑 MVCC（呼应事务隔离一文）：
  age: 20 → 15 → 10
  ^当前值   ^旧版本(undo)  ^更老版本(undo)
  每行隐藏列 trx_id 记录最后修改它的事务 ID，
  快照读顺着版本链找"对我可见"的那个版本 → 不用加锁也能读。
```

### binlog：Server 层的"账本"

- 追加写、不循环，记录所有变更（三种格式见后）
- 主从复制：从库拉主库 binlog 重放
- 数据恢复/订阅：canal 等 binlog 工具、按时间点恢复备份

### 为什么必须两阶段提交（重点）

redo log（引擎层）和 binlog（Server 层）是两套独立日志，**先写谁都会出问题**。MySQL 的选择：

```
update age=20 的两阶段提交时间线：

① InnoDB 写 redo log，标记为 prepare 状态
② Server 层写 binlog 并落盘
③ InnoDB 把 redo log 的 prepare 改成 commit
```

崩溃恢复时的推演——宕机时刻不同，两份日志"不一致"，MySQL 以 **binlog 为准**裁决：

```
情况 A：redo 先写（prepare）成功，binlog 还没写 → 宕机
  重启检查：redo=prepare，binlog 里没有这条事务
  → 说明这个事务"没被外部看见"（从库/canal 都不知道）
  → 回滚。✅ 一致

情况 B：binlog 写成功了，redo 还停在 prepare → 宕机
  重启检查：redo=prepare，但 binlog 里有完整事务
  → binlog 可能已经传给从库执行了！主库必须提交
  → 把 redo 补成 commit（前滚）。✅ 主从一致

反例：如果没有 prepare、直接提交 redo 再写 binlog
  redo commit 后、binlog 前宕机 → 主库改了，从库不知道 → 主从不一致 ❌
反例：只写 binlog 不写 redo
  binlog 写了但事务失败回滚 → 从库同步了一条"没发生"的变更 ❌
```

所以必须 prepare 状态当"中间地带"：**崩溃时哪份日志齐全，就按哪份补全/回滚，两份日志最终逻辑一致**。

- 性能优化：组提交（group commit）——把多个事务的 fsync 合并成一次，binlog 组提交 + redo commit 组提交
- `innodb_flush_log_at_trx_commit=1` + `sync_binlog=1` 叫"双一配置"，最安全

### binlog 三种格式

| 格式 | 记录内容 | 优点 | 缺点 |
| --- | --- | --- | --- |
| statement | 原始 SQL | 日志量小 | `now()`、`uuid()` 等主从可能执行结果不同 |
| row | 每行变更前后镜像 | 最可靠、可精确恢复 | 日志量大（改 100 万行记 100 万条） |
| mixed | 自动切换前两者 | 折中 | — |

生产常用 row（主从安全 + 配合 canal 订阅）。

## 面试答法

### 30 秒版（可背诵口语）

> MySQL 有三份日志：redo log 是 InnoDB 的物理日志，固定大小循环写，作用是持久性——WAL 先写日志再刷数据页，宕机后重放就能找回已提交事务；undo log 记录改前的旧值，一是回滚保原子性，二是串成版本链支撑 MVCC；binlog 是 Server 层的逻辑日志，追加写，用于主从复制和数据归档。更新一条数据的顺序是：redo 先 prepare，再写 binlog，最后 redo commit，这就是两阶段提交。因为两份日志独立，宕机时若 redo 是 prepare 而 binlog 完整就提交，binlog 缺失就回滚，这样两边永远逻辑一致。记忆口诀：redo 保持久性、undo 保原子性、binlog 保归档和主从。

### 深入版（被追问时按编号展开）

1. **WAL 的动机**：随机写数据页太慢 → 顺序写日志 + 内存改页 + 异步刷盘；画"①~⑤ + 宕机在哪步"的时间线
2. **redo 循环写**：write pos 与 checkpoint 的关系，写满要等刷盘
3. **undo 两用途**：回滚是"倒放"，版本链 + trx_id 是 MVCC 快照读的基础
4. **binlog 定位**：Server 层、追加写、主从复制/canal/恢复都靠它
5. **两阶段提交推演**：分别推演"redo 先写宕机"和"binlog 写完 redo 停 prepare 宕机"两种时刻的恢复决策，再讲两个反例说明为什么不能简化
6. **性能与安全**：组提交、双一配置
7. **binlog 三格式**对比收尾

### 常见追问

- **为什么 redo 是循环写、binlog 是追加写？** → redo 只服务于崩溃恢复，落盘刷页后就没用了可覆盖；binlog 要给从库/归档用，不能删只能追加
- **update 一行数据 redo 和 undo 都写吗？** → 都写：undo 记旧值（回滚+版本链），redo 记新值（持久性）
- **只写 redo 不写 binlog 行不行？** → 单机可以，但主从和恢复没了；两阶段提交就是为把两份日志的写入顺序约束成一致
- **checkpoint 是干什么的？** → 标记"这之前的 redo 对应的脏页已落盘"，redo 可以擦除复用；checkpoint 推进越慢恢复越快
- **binlog 记录了但主库回滚了怎么办？** → 正常流程不会发生：binlog 写完才会 commit redo；若极端情况 binlog 完整而 redo 停 prepare，恢复时以前滚为准
