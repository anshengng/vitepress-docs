# Redis 持久化：RDB 与 AOF

## 题目

> Redis 有哪些持久化方式？RDB 和 AOF 的区别、优缺点和选型？

## 核心要点

### RDB（快照）

- 定时把内存数据 fork 子进程 dump 成二进制文件
- 优点：文件紧凑、恢复快、对主进程影响小（fork + COW）
- 缺点：两次快照之间的数据会丢失

### AOF（追加日志）

- 每条写命令追加到 AOF 文件，`appendfsync` 三档：always / everysec（默认）/ no
- AOF 重写（rewrite）压缩文件体积
- 优点：数据更安全（everysec 最多丢 1 秒）
- 缺点：文件大、恢复慢

### 混合持久化（Redis 4.0+）

- AOF rewrite 时前半段存 RDB 二进制、增量存 AOF 文本，兼顾恢复速度与数据安全

## 面试答法

（待补充：组织 30 秒版本 + 深入版本）
