---
layout: home

hero:
  name: "Vue / React 深度技术问答"
  text: "核心原理与底层实现"
  tagline: 从基础概念到源码细节，吃透两大框架的面试高频考点
  actions:
    - theme: brand
      text: 开始阅读
      link: /vue/reactivity/reactivity
    - theme: alt
      text: React 原理
      link: /react/
    - theme: alt
      text: GitHub
      link: https://github.com/vuejs/core

features:
  - title: 响应式与重渲染
    details: Vue 的 Proxy 依赖收集与 React 的 setState 重渲染 + Fiber diff 对照理解
  - title: 编译时优化
    details: Vue 编译器三阶段与 PatchFlags、Block Tree 靶向更新，JSX 只是轻量语法糖
  - title: 运行时架构
    details: Vue 运行时核心模块划分，React Fiber 双缓冲、两阶段与可中断调度
  - title: 虚拟 DOM 与 Diff
    details: VNode 结构、最长递增子序列与 React 单链表 diff、key 与 bailout
  - title: Hooks 与组合式 API
    details: React memoizedState 链表与闭包陷阱，Vue setup 与响应式绑定
  - title: 调度与并发
    details: React Scheduler 时间切片、Lane 优先级模型与并发特性
  - title: 扩展专题
    details: Context/Ref、Portals、状态管理、路由、SSR 与水合、错误边界
  - title: 手写实现
    details: 从零手写简化版响应式、Hooks 与 mini-react，把链路串一遍
---

## 快速开始

本文档整理自 Vue 与 React 深度技术问答对话，覆盖从基础概念到底层实现的方方面面，按源码包结构与面试高频考点组织。

### 主要内容

- **Vue 三大模块** - 编译时、响应式、运行时，组件系统归属运行时
- **React 核心机制** - JSX 与 Element、Fiber 架构、Hooks 原理、调度与并发、事件系统
- **扩展专题** - 弹窗系统、Context/Ref、状态管理、Router、SSR、现代特性与手写实现
- **框架对比** - Vue 与 React 在设计哲学、更新机制与运行时结构上的差异

### 适合谁

- 前端工程师准备框架相关面试，需要系统梳理高频考点
- 想深入理解 Vue3 / React 源码实现原理的开发者
- 对前端框架设计模式与工程实现感兴趣的同学
