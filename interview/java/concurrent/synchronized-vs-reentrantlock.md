# synchronized 与 ReentrantLock

## 题目

> synchronized 和 ReentrantLock 有什么区别？底层实现原理分别是什么？

## 核心要点

### 区别对比

| 对比项 | synchronized | ReentrantLock |
| --- | --- | --- |
| 层面 | JVM 关键字 | JDK API（AQS） |
| 加/解锁 | 自动（monitorenter/exit） | 手动 lock/unlock（finally 释放） |
| 可中断 | 不可 | lockInterruptibly |
| 公平锁 | 非公平 | 可选公平/非公平 |
| 条件队列 | 单个 wait/notify | 多个 Condition |
| 锁升级 | 偏向→轻量→重量（JDK 15 后默认关闭偏向） | — |

### 原理

- synchronized：对象头 MarkWord + Monitor（重量级锁时基于 OS mutex）
- ReentrantLock：AQS state + CLH 双向队列，CAS 获取锁，失败入队 park

## 面试答法

（待补充：组织 30 秒版本 + 深入版本）
