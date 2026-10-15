# 线程池参数与工作流程

## 题目

> ThreadPoolExecutor 的核心参数有哪些？任务提交后的执行流程？如何合理设置线程数？

## 核心要点

### 七大参数

```java
new ThreadPoolExecutor(
  corePoolSize,      // 核心线程数
  maximumPoolSize,   // 最大线程数
  keepAliveTime,     // 非核心线程空闲存活时间
  unit,              // 时间单位
  workQueue,         // 任务队列（ArrayBlocking/LinkedBlocking/Synchronous）
  threadFactory,     // 线程工厂
  handler            // 拒绝策略
)
```

### 执行流程

```
提交任务
  → 核心线程未满？创建核心线程
  → 队列未满？入队
  → 未达最大线程？创建非核心线程
  → 触发拒绝策略（Abort/CallerRuns/Discard/DiscardOldest）
```

### 线程数经验值

- CPU 密集：N核 + 1
- IO 密集：N核 × (1 + 等待时间/计算时间)，或 2N
- 生产环境：压测 + 动态调参

## 面试答法

（待补充：组织 30 秒版本 + 深入版本）
