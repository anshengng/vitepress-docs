# React Fiber 架构

## 题目

> 为什么 React 需要 Fiber？Fiber 架构解决了什么问题？

## 核心要点

- **动机**：Stack Reconciler 递归不可中断，大组件树更新会阻塞主线程，导致掉帧
- **Fiber 本质**：用链表模拟可中断的调用栈，每个 Fiber 节点对应一个 ReactElement
  - `child` / `sibling` / `return` 构成树的可遍历结构
- **两阶段**：
  1. Render 阶段：构建 WorkInProgress 树，可中断、可恢复、可丢弃
  2. Commit 阶段：一次性将变更应用到 DOM，不可中断
- **优先级**：Lane 模型给更新分配优先级，高优先级更新可插队
- **时间切片**：Scheduler 每 5ms 让出主线程，检查是否有更高优先级任务

## 面试答法

（待补充：组织 30 秒版本 + 深入版本）
