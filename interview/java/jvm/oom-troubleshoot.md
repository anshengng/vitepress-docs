# 线上 OOM 排查流程

## 题目

> 线上服务报 OOM 了，你怎么排查？说说完整流程。你实际处理过内存问题吗？用了哪些命令和工具？生产环境 JVM 参数怎么配？

## 为什么强调"先分类再定位"

`OutOfMemoryError` 只是"内存不够"的统称，**五种 OOM 的根因、排查方向完全不同**：堆溢出查大对象/泄漏，元空间查类加载/动态代理，栈溢出查递归，堆外查 NIO/Netty，线程溢出查线程泄漏。上来就 dump 堆是浪费——Metaspace OOM 时堆 dump 毫无信息量。

## 核心要点

### 第一步：看异常类型分类

| 异常 | 典型原因 | 排查方向 |
| --- | --- | --- |
| `Java heap space` | 大对象一次申请超限；对象只增不减（缓存无上限、集合泄漏） | 堆 dump + MAT |
| `GC overhead limit exceeded` | 98% 时间 GC 只回收 2%——堆快满的前兆 | 同上，本质也是 heap 问题 |
| `Metaspace` | 动态代理/CGLIB 无限生成类、Groovy 脚本热加载、类加载器泄漏 | jcmd GC.class_stats / 类数量趋势 |
| `StackOverflowError` | 递归没出口、栈上超大局部数组 | jstack 看重复栈帧 |
| `Direct buffer memory` | NIO/Netty 堆外 ByteBuffer 没释放 | 堆外内存：NMT、pmap |
| `unable to create new native thread` | 线程数爆炸、ulimit/容器 pid 限制 | jstack 数线程、看线程池配置 |

### 完整排查流程图

```
监控告警(内存曲线陡增 / 接口超时 / GC 日志异常)
   │
   ├─ ① 保留现场：-XX:+HeapDumpOnOutOfMemoryError 已自动生成 dump
   │      没配 → jmap -dump:live,format=b,file=heap.hprof <pid>
   │      同时抓 jstat / jstack / GC 日志
   ├─ ② 摘流量、重启恢复（先止血，dump 文件传回本地慢慢看）
   ├─ ③ 本地 MAT 打开 dump → Leak Suspects 报告
   │      → Dominator Tree 找"占内存最大的一棵树"
   │      → Path to GC Roots 看谁引用着它不放
   ├─ ④ 结合代码定位：大集合？缓存无上限？ThreadLocal 没 remove？
   └─ ⑤ 修复 → 压测/灰度验证 → 复盘加监控指标
```

### 命令级图解

```bash
jps -lvm                 # 找 pid：列出所有 Java 进程 + 主类 + 启动参数
# 1234  com.example.OrderApp -Xmx4g ...

jstat -gcutil 1234 1000 10   # 每秒打一行，共 10 行
#   S0     S1     E      O      M     YGC  YGCT  FGC FGCT  GCT
#  0.00  98.76  99.99  87.32  61.02  1204  12.3  35  8.9   21.2
#                       ▲堆老年代使用率        ▲Full GC 次数 ▲FGC 耗时
# 怎么读：O 长期 >90% 且 FGC 持续涨（回收不动）→ 堆内有泄漏/大对象，该 dump 了
#        YGC 频率暴涨但 O 不降 → 对象晋升过快，看是否大集合拷贝

jmap -histo:live 1234 | head -20   # 快速看 Top 对象类（不 dump，轻量）
jmap -dump:live,format=b,file=/tmp/heap.hprof 1234   # 完整堆快照
jstack 1234 > thread.txt           # 线程快照；死锁时末尾直接打印 "Found deadlock"
```

MAT 分析思路：

```
Leak Suspects ──► 提示 "One object occupies 1.2 GB (85%)"
Dominator Tree ──► 按"独占支配内存"排序，第一行通常是嫌疑对象
   └─ 右键 List objects → with GC roots ──► 引用链：
      ThreadLocalMap$Entry.value ← Thread「http-nio-8080-exec-7」
      → 直接指到泄漏代码位置
```

### 案例一：缓存无上限，大集合无限增长

```
时刻  业务流量                    堆内 HashMap CACHE
 t1   商品详情请求 1k QPS         1 万条，占 200MB
 t2   热点 key 持续新增，只 put    50 万条，1.2GB   ← 老年代持续上涨
 t3   无淘汰、无上限               300 万条，6GB
 t4   Full GC 后 O 区不降          对象全部"活着"，GC 无能为力
 t5   Java heap space ❌
```

修复：换 Caffeine/Guava Cache 设 `maximumSize` + `expireAfterWrite`；dump 里 Dominator Tree 第一行就是那个 CACHE。

### 案例二：ThreadLocal 没 remove（呼应 ThreadLocal 篇）

```
时刻  线程池工作线程 T              USER_TL 的 Entry
 t1   请求A：set(大对象A)           key=弱引用, value=A
 t2   请求A结束，未 remove           A 仍被 Entry→Thread 链挂住
 t3   T 回池复用，又 set 新对象…     旧对象只在"换 key 时"才覆盖
 t4   高 QPS 下 value 堆积          老年代缓坡上涨、Full GC 不回落
 t5   Java heap space ❌（MAT 里 GC Roots 是 Thread）
```

修复：`try { set } finally { remove }`；MAT 里按 Thread 分组看 threadLocals 字段即可实锤。

### 生产参数建议

```bash
-Xms4g -Xmx4g                     # 初始=最大，避免运行时扩缩抖动
# 容器里：-Xmx ≤ 容器内存 × 70~80%，给元空间/线程栈/堆外/Netty 留余量
#   （曾踩坑：-Xmx 等于容器 limit → OOMKilled，dmesg 里能看到）
-XX:MetaspaceSize=256m -XX:MaxMetaspaceSize=256m
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/data/logs/heap.hprof   # 提前配！OOM 后再想 dump 就晚了
-XX:+UseG1GC -Xlog:gc*:file=gc.log        # GC 日志是趋势判断的命脉
-XX:MaxDirectMemorySize=1g                # 堆外上限，防 NIO 失控
```

## 面试答法

### 30 秒版（可背诵口语）

> 我的流程是先分类再定位。OOM 分五种：heap space、Metaspace、StackOverflow、Direct buffer、create native thread，根因完全不同，所以第一步看异常类型和监控曲线。是堆溢出的话，最好生产提前配了 HeapDumpOnOutOfMemoryError，现场保留 dump，同时用 jstat -gcutil 看老年代和 Full GC 趋势确认回收不动了；先摘流量重启止血，本地用 MAT 打开 dump，看 Leak Suspects 和 Dominator Tree 找占内存最大的对象，再顺 GC Roots 引用链定位到代码。我们实际遇到过两个：一个是本地缓存没设上限无限 put，一个是 ThreadLocal 用完没 remove，线程池里堆积。修复后加监控复盘。

### 深入版（被追问时按编号展开）

1. **分类先行**：报出五种 OOM 和各自方向，强调"Metaspace OOM 去 dump 堆"是方向性错误
2. **保留现场**：jps 找 pid → jstat 读趋势（O 高 + FGC 涨不回落）→ jmap -histo 快速看 → dump 留证 → jstack 看线程/死锁
3. **止血与恢复**：摘流量、重启，dump 异步分析；体现"先恢复再排查"的生产意识
4. **MAT 思路**：Leak Suspects → Dominator Tree → Path to GC Roots，举 ThreadLocal 的 Entry 链例子
5. **真实案例**：缓存无上限（修复：maximumSize+expire）；ThreadLocal 泄漏（修复：finally remove）
6. **参数与复盘**：-Xms=-Xmx、容器内存留余量、dump 参数必配、GC 日志常开

### 常见追问

- **dump 文件太大传不回来怎么办？** → 先 jmap -histo 看 Top 类缩小范围；MAT 用 index 文件增量分析；或远程挂载 NAS 直接写
- **jmap -dump 会把服务卡死？** → 是的，STW 且大堆耗时久，所以首选自动 dump；手动 dump 前先摘流量
- **Full GC 频繁但没 OOM 怎么查？** → 同样 jstat 趋势 + GC 日志看晋升速率，jmap -histo 对比两次快照找增量对象
- **内存一直在涨但堆监控正常？** → 怀疑堆外：NMT（-XX:NativeMemoryTracking=summary）、pmap/smaps、Netty 的 ByteBuf 泄漏检测
- **怎么区分泄漏和大对象？** → dump 看 GC Roots 可达性：可达且不该存活=泄漏；单对象超大（如一次查百万行）=大对象问题，改分页/流式
