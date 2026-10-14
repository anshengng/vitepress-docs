# React 底层原理

本分区规划中，以下为准备覆盖的主题大纲。

## 计划主题

### React 核心机制
- JSX 本质与编译（jsx-runtime 自动引入）
- Fiber 架构：为什么要从栈协调改为链表
- 调度与时间切片（Scheduler、MessageChannel）
- 并发模式与优先级（Lane 模型）

### Hooks 原理
- Hooks 链表存储（memoizedState）
- useState 与闭包陷阱
- useEffect 与依赖比较、清理函数
- useMemo / useCallback 与性能优化
- 手写简化版 useState / useEffect

### Diff 与更新
- Reconciliation 协调算法（单链表遍历、sibling/return 指针）
- Key 的作用
- bailout 优化：context 命中与 props 浅比较
- 合成事件系统

### 状态管理
- Context 与性能陷阱
- Redux 中间件原理
- Zustand / Jotai 原子化思路

### 与 Vue 的对比
见 [Vue vs React 对比](/compare/vue-vs-react)
