# ConcurrentHashMap 原理

## 题目

> ConcurrentHashMap 在 JDK 7 和 JDK 8 里分别怎么实现？为什么 JDK 8 去掉分段锁？put 流程是什么？size 怎么统计？为什么 key 和 value 都不能为 null？

## 为什么需要并发安全的 Map

HashMap 并发使用会丢数据甚至死循环（详细分析见集合篇 HashMap），Hashtable 又太慢——所以需要**细粒度锁**的并发 Map：ConcurrentHashMap。

## 核心要点

### 前辈 Hashtable 为什么被淘汰：全表一把锁

```
Hashtable：所有方法 synchronized —— 整张表一把大锁

  T1 get ──┐
  T2 put ──┼──► 同一把锁 ──► 读写全互斥，全表串行化 ❌
  T3 get ──┘

高并发缓存场景 = 所有请求排队走独木桥
```

### JDK 7：分段锁 Segment

```
ConcurrentHashMap（JDK7）
┌───────────────────────────────────────────────┐
│ Segment 数组（默认 16 段，Segment 继承 ReentrantLock）│
│ ┌─────────┐ ┌─────────┐ ┌─────────┐   ...    │
│ │ Seg[0]  │ │ Seg[1]  │ │ Seg[2]  │          │
│ │ 锁=整段  │ │         │ │         │          │
│ │ ┌─────┐ │ │         │ │         │          │
│ │ │桶[] │ │ │         │ │         │          │
│ │ │链表  │ │ │         │ │         │          │
│ └─────────┘ └─────────┘ └─────────┘          │
└───────────────────────────────────────────────┘

定位：先 hash 定位 Segment（哪一段），再 hash 定位段内桶
锁粒度 = 段 → 理论并发度 = 段数（默认 16）
```

### JDK 8 大改：锁粒度细化到"桶头"

结构与 HashMap 8 对齐：**Node 数组 + 链表/红黑树，取消 Segment**。

```
table: Node[]
 [0] → null
 [1] → Node → Node → Node   （链表，长度≥8 且表长≥64 转红黑树）
 [2] → TreeBin（红黑树）
 [3] → Node
 ...

写操作锁粒度 = 单个桶头：
  桶空    → CAS 无锁插入
  桶非空  → synchronized(桶头)
```

为什么取消 Segment：段的粒度仍粗（一段含很多桶）；JDK8 直接锁桶头，并发度从 16 提升到桶数量级，且不再需要 Segment 这层继承结构。

### JDK 8 put 完整流程

```
put(key, val)
  │
  ① spread(hash)：h ^ (h >>> 16) 扰动，减少碰撞
  │
  ② table 未初始化 → initTable()（CAS 抢 sizeCtl，只有一个线程建表）
  │
  ③ 定位桶：i = (n - 1) & hash
  │
  ④ 桶空？──是──► CAS 放入新 Node（无锁）──成功──► addCount 计数，结束
  │
  ⑤ 桶头 hash == MOVED？──是──► helpTransfer() 协助扩容后再插入
  │
  ⑥ synchronized(桶头) {
  │       链表 → 尾插；红黑树 → 树插入
  │    } 释放锁
  │
  ⑦ 链表长度 ≥ 8 → treeifyBin（表长 < 64 时先扩容代替转树）
  │
  ⑧ addCount()：计数 +1，超阈值触发/协助扩容
```

### 模拟两个线程并发 put：不同桶 → 互不阻塞

```
table 长度 16；T1 的 key 落桶 3，T2 的 key 落桶 9

时刻   T1: put(k1,v1)                T2: put(k2,v2)
 t1    hash(k1) → 桶 3               hash(k2) → 桶 9
 t2    桶 3 非空                      桶 9 非空
 t3    synchronized(桶3头) 🔒 拿到     synchronized(桶9头) 🔒 拿到
 t4    遍历链表，尾插 k1 ✅            遍历链表，尾插 k2 ✅ ← 各锁各的，零阻塞
 t5    释放桶 3 🔓                     释放桶 9 🔓
 t6    addCount（分段计数）             addCount
```

### 模拟两个线程并发 put：同一桶 → 后者短暂阻塞

```
时刻   T1: put(k1,v1) 落桶 3          T2: put(k3,v3) 也落桶 3
 t1    synchronized(桶3头) 🔒 拿到锁
 t2    遍历链表尾插中...               synchronized(桶3头) → 阻塞 ⏳
 t3    插入 k1 完成，释放锁 🔓
 t4                                     竞争到锁，遍历尾插 k3 ✅

只有"同一个桶"这一小撮范围才串行，粒度比 JDK7 的整段更细。
```

### size 怎么算：baseCount + CounterCell

思想同 LongAdder（详见 CAS 篇）：单点 CAS 计数在高峰互相踩，改成"无竞争时 CAS baseCount，有竞争时散到 CounterCell[] 各自加"。

```
T1 ──► CAS baseCount 失败 ──► 散列到 CounterCell[2] += 1 ✅
T2 ──► 直接 CAS baseCount += 1 ✅

size() = baseCount + Σ CounterCell[i]
（近似值：求和瞬间可能仍有线程在改某个 Cell）
```

### 扩容协助机制：多线程一起搬

```
put/addCount 发现超过阈值 → 首个线程创建 nextTable（2 倍大）
transfer 把旧表按区间分片（stride，最低 16 个桶一段）：

 T1 认领 [桶 0 ~ 桶 15]  ──迁移──► 迁完的桶放 ForwardingNode(hash=MOVED)
 T2 认领 [桶 16 ~ 桶 31] ──迁移──►
 T3 put 时发现桶是 ForwardingNode → helpTransfer，先帮搬再写入
 get 遇到 ForwardingNode → 转发到新表读（读无锁，不受影响）

全部迁完 → 整体替换 table
```

### JDK 7 vs JDK 8 对比表

| 维度 | JDK 7 | JDK 8 |
| --- | --- | --- |
| 结构 | Segment[] + HashEntry[] | Node[] + 链表/红黑树 |
| 锁实现 | Segment 继承 ReentrantLock | 桶空 CAS / 非空 synchronized 桶头 |
| 锁粒度 | 段（默认 16） | 单个桶头（并发度≈桶数） |
| hash 冲突 | 只有链表 | 链表 + 红黑树 |
| 计数 | 各段 count 相加 | baseCount + CounterCell 分段 |
| 扩容 | 段内独立扩容 | 多线程协助扩容 |
| null | 不允许 | 仍不允许 |

### 三个高频注意点

1. **key/value 都不能为 null**：并发下 `get` 返回 null 分不清"key 不存在"还是"值就是 null"；HashMap 单线程可用 containsKey 二次确认，但并发下两次调用之间 map 可能已被改，二次确认也不可靠，干脆禁止。
2. **迭代器弱一致性**：迭代时允许并发修改，尽力反映创建后的最新状态但不保证；不会像 HashMap 那样 fail-fast 抛 ConcurrentModificationException。
3. **复合操作仍不安全**：`if (!map.containsKey(k)) map.put(k,v)` 两步之间会被插队，必须用原子的 putIfAbsent / computeIfAbsent / merge。

## 面试答法

### 30 秒版（可背诵口语）

> ConcurrentHashMap 是并发安全的 Map。JDK7 用分段锁：整表拆成默认 16 个 Segment，每段一把 ReentrantLock，写只锁自己那段，并发度等于段数。JDK8 大改：取消 Segment，改用 Node 数组加链表或红黑树，锁粒度细化到单个桶头——桶空用 CAS 无锁插入，桶非空才 synchronized 锁桶头，并发度提升到桶数量级。size 用 baseCount 加 CounterCell 分段统计，扩容支持多线程认领区间协助迁移。另外记住三点：key 和 value 都不许为 null，因为并发下 get 返回 null 分不清不存在还是值为 null；迭代器是弱一致的，不 fail-fast；复合操作要用 putIfAbsent 这类原子方法。

### 深入版（被追问时按编号展开）

1. **引出**：HashMap 并发丢数据（一句带过，详见集合篇）→ Hashtable 全表一把锁串行化 → 需要细粒度锁
2. **JDK7**：Segment 继承 ReentrantLock，两次 hash 定位，锁粒度=段
3. **JDK8 结构**：Node 数组+链表/红黑树，取消 Segment，锁粒度=桶头
4. **put 流程**：空桶 CAS → MOVED 协助扩容 → synchronized 链表/树插入 → addCount
5. **双时间线证明细粒度**：不同桶互不阻塞 / 同桶才短暂串行
6. **size 与扩容**：CounterCell 分段计数（同 LongAdder 思想）；多线程协助迁移 + ForwardingNode
7. **收尾三注意点**：null、弱一致迭代、复合操作

### 常见追问

- **get 需要加锁吗？** → 不加。Node 的 val 和 next 都是 volatile，读路径全程无锁
- **为什么 get 返回 null 就必须禁止 null 值？** → 单线程可 containsKey 二次确认；并发下确认和 get 之间 map 可能被改，无法可靠区分"不存在"与"值为 null"
- **扩容期间读写怎么办？** → 写线程发现 ForwardingNode 就协助迁移；读线程顺着 ForwardingNode 转发到新表读
- **putIfAbsent 和先 containsKey 再 put 区别？** → 前者一步原子；后者两步之间可能被其他线程插入导致覆盖
- **size() 准确吗？** → 近似值，计数本身分段进行（同 LongAdder），高并发下只是一个统计口径
