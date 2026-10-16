# 慢 SQL 优化流程

## 题目

> 线上有一条 SQL 很慢，你怎么排查和优化？EXPLAIN 主要看哪些字段？哪些情况索引会失效？深分页为什么慢，怎么优化？

## 为什么需要流程化排查

慢 SQL 是线上最常见的性能问题：接口超时、CPU 飙高、连接池打满，根因往往就是几条没走索引的查询。面试考的不是"背优化技巧"，而是**有没有一套完整的排查→定位→优化→验证的方法论**。

## 核心要点

### 完整流程图

```
发现慢（接口超时/监控告警/SHOW PROCESSLIST 看到大量 Sending data）
   ↓
开慢查询日志：slow_query_log=1, long_query_time=1（超 1 秒记一条）
   ↓  用 mysqldumpslow / pt-query-digest 聚合出 TOP N 慢 SQL
定位到具体 SQL
   ↓
EXPLAIN 分析执行计划（type / key / rows / Extra）
   ↓
按决策树优化：加索引？改写 SQL？拆分页？换驱动表？
   ↓
验证：对比优化前后 rows、实际耗时、压测
```

### EXPLAIN 关键列速查表

| 列 | 含义 | 怎么看 |
| --- | --- | --- |
| id | 执行顺序 | 越大越先执行；相同则从上到下 |
| select_type | 查询类型 | SIMPLE / PRIMARY / SUBQUERY / DERIVED |
| type | **访问方式（最重要）** | 等级从好到差（见下） |
| key | 实际用到的索引 | NULL = 没走索引 |
| rows | 预估扫描行数 | 越小越好，和表总行数比大小 |
| filtered | 过滤后剩余百分比 | 越高说明索引条件越有效 |
| Extra | 附加信息 | 见下 |

type 等级（面试必背，从好到差）：

```
system > const(主键/唯一键等值) > eq_ref(join 唯一键)
  > ref(普通索引等值) > range(索引范围) > index(扫索引树)
  > ALL(全表扫描) ❌

至少到 range，出现 ALL 基本要优化；index 扫索引树比 ALL 略好（索引比数据小）
```

Extra 常见值：

| Extra 值 | 含义 | 危险吗 |
| --- | --- | --- |
| Using index | 覆盖索引，不回表 | ✅ 好 |
| Using index condition | 索引条件下推 ICP | ✅ 好 |
| Using filesort | 内存/磁盘排序 | ⚠️ 大表要优化 |
| Using temporary | 临时表（常见于 group by） | ⚠️ 要优化 |
| Using where | 索引取出后再 where 过滤 | 正常 |

### 索引失效决策树（每条带 SQL 示例）

```
WHERE 条件用了索引列，但没走索引？逐个排查：

├─ 对索引列做函数/运算        WHERE YEAR(create_time)=2024        ❌
│    改：范围查询 create_time >= '2024-01-01'                      ✅
├─ 隐式类型转换              phone 是 varchar，传数字 138...      ❌
│    （数字会被转字符串再比，索引列被套函数）  改：传字符串          ✅
├─ 前导模糊                 LIKE '%abc'                           ❌
│    改：LIKE 'abc%' 可走索引；全文检索上 ES
├─ 不满足最左前缀            联合索引(a,b,c)：WHERE b=2            ❌
│    WHERE a=1 AND c=3 只用 a 一段                                ⚠️
│    WHERE a=1 AND b=2 AND c=3                                   ✅
├─ OR 两边不都有索引         WHERE a=1 OR d=2（d 无索引）          ❌
├─ != / NOT IN / IS NOT NULL 优化器认为命中太多，直接全表         ⚠️ 看数据分布
├─ 数据量小/命中比例高        优化器主动放弃索引（回表更贵）        ⚠️ 正常
└─ 索引列被 join 字符集/排序规则不一致                             ❌
```

### 深分页：limit 1000000, 10 为什么慢

```
SELECT * FROM orders ORDER BY id LIMIT 1000000, 10;

B+ 树定位到第 100 万条，然后……
┌────────────────────────────────────────────┐
│ 逐条取出 1,000,000 条"不要的"行             │
│ 每一行还要回表：二级索引主键 → 聚簇索引取整行 │  ← 100 万次回表
│ 丢弃前 100 万条，只留最后 10 条             │
└────────────────────────────────────────────┘
慢的根源：扫描+回表次数 = offset + limit，绝大部分白干

优化① 延迟关联（先覆盖索引拿主键，再回表 10 次）：
SELECT o.* FROM orders o
JOIN (SELECT id FROM orders ORDER BY id LIMIT 1000000,10) t
ON o.id = t.id;
     内层：Using index 不回表，扫 100 万条"轻量"索引记录
     外层：只回表 10 次 ✅

优化② 游标续传（记住上一页末尾 id，适合无限下拉）：
SELECT * FROM orders WHERE id > 1000000 ORDER BY id LIMIT 10;
     主键直接定位，扫描行数恒为 10 ✅（代价：不能跳页）
```

### join 与 order by 两句话

- **join**：小表驱动大表（被驱动表有索引时优化器会自动安排；没有则 BNL 很惨），`STRAIGHT_JOIN` 可强制顺序
- **order by + filesort**：排序列没索引就要 filesort——数据小走内存排序，数据大要归并临时文件；让排序顺序吃索引（联合索引最后一列是排序列）可消灭 filesort

### 实战案例：订单列表 3s → 50ms

```
SELECT * FROM order
WHERE user_id=? AND status=2 ORDER BY create_time DESC LIMIT 10;

t0  监控告警接口 P99 3s，慢日志定位到这条
t1  EXPLAIN：type=ALL, key=NULL, rows=800万, Extra=Using filesort
t2  分析：user_id 单索引命中后仍要按 create_time 排序 → filesort 大
t3  建联合索引 (user_id, status, create_time)
    → 等值前两列定位 + 第三列天然有序，type=ref, Extra=Using index condition
t4  SELECT * 改指定列，避免回表宽行；深分页入口改游标续传
t5  验证：rows 从 800 万 → 几百，实测 50ms，压测通过上线
```

## 面试答法

### 30 秒版（可背诵口语）

> 我会先按流程走：监控或慢查询日志定位到具体 SQL，long_query_time 设 1 秒，用 mysqldumpslow 聚合出最慢的几条；然后 EXPLAIN 看执行计划，重点看 type 是不是掉到 ALL 或 index、key 有没有用上索引、rows 预估扫描量、Extra 里有没有 filesort 和 temporary；接着对症优化——索引失效常见于列上做函数、varchar 列传数字隐式转换、前导模糊、不满足最左前缀；深分页 limit 一百万,十 慢在 offset 次回表，用延迟关联先覆盖索引取主键、或游标续传 where id>上页末尾；最后用 rows 和实际耗时对比验证。我处理过一条订单列表查询，建了 user_id+status+create_time 联合索引，把 filesort 也消掉了，从 3 秒降到 50 毫秒。

### 深入版（被追问时按编号展开）

1. **发现渠道**：慢查询日志配置与聚合工具、PROCESSLIST、APM 告警
2. **EXPLAIN 逐列讲**：type 等级链、rows/filtered 的性价比含义、Extra 五个常见值
3. **索引失效**：按决策树逐条报 SQL 例子，重点讲隐式转换（varchar 传数字 = 列上套 CAST 函数）
4. **深分页**：画回表次数图，讲延迟关联与游标续传各自的适用场景（跳页 vs 下拉）
5. **join/filesort**：小表驱动大表、排序吃索引
6. **案例收尾**：3s→50ms 时间线，体现"定位→分析→动手→验证"闭环

### 常见追问

- **type=index 是走全索引扫描，算好吗？** → 不好，只是比 ALL 省（索引比表小）；出现它说明该加 where 条件走 range/ref
- **为什么 varchar 传数字会失效，反过来呢？** → 数字传 varchar 列：列侧被 CAST 失效；varchar 传数字列：转换在常量侧，索引仍可用
- **加了索引还是慢？** → 看区分度（count(distinct col)/count(*)）、优化器成本估算（命中比例高主动放弃索引）、回表列太多
- **limit 10 不带 offset 会慢吗？** → 不会，从头取 10 条就停
- **怎么防止线上再出现慢 SQL？** → SQL 上线前 EXPLAIN 审核、慢日志告警、分页接口强制游标
