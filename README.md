# Vue / React 深度技术问答文档

基于 Vue 与 React 深度技术问答对话记录整理的 VitePress 文档，覆盖两大框架的核心原理、底层实现与面试高频考点。

## 项目结构

```
vitepress-docs/
├── .vitepress/
│   └── config.mts           # VitePress 配置（侧边栏、导航、站点信息）
├── index.md                 # 首页
├── README.md                # 项目说明
├── QUICKSTART.md            # 快速启动指南
├── vue/                     # Vue 原理与实战
│   ├── basics/              # 基础与实战（Arco 配置、事件处理）
│   ├── dialogs/             # 弹窗系统（Promise / createDialog / 命令式）
│   ├── reactivity/          # 响应式系统（核心、Vue2 对比、computed/watch、浅层 API）
│   ├── compiler/            # 编译时（编译流程、指令编译、代码生成、SFC、编译优化）
│   ├── rendering/           # 渲染（render/h、虚拟 DOM、Diff、nextTick）
│   ├── components/          # 组件系统（v-model、keep-alive、生命周期、provide/inject、slot、Teleport、异步组件）
│   ├── advanced/            # 高级话题（运行时架构、组合式 API、自定义渲染器/指令、模板 ref、过渡、Router、Pinia、SSR）
│   └── handwritten/         # 手写响应式
├── react/                   # React 底层与专题
│   ├── jsx/                 # JSX 与 Element
│   ├── fiber/               # Fiber 架构（why-fiber、双缓冲、协调与 Diff）
│   ├── hooks/               # Hooks 原理（链表、useState、useEffect/useMemo、手写）
│   ├── scheduler/           # 调度与并发（时间切片、Lane、并发、Suspense）
│   ├── events/              # 事件系统（合成事件）
│   ├── context/ ref/ render/ forms/ optimization/ lifecycle/ state/ ecosystem/ modern/ ssr/ handwritten/
│   └── index.md             # React 原理总览
└── compare/                 # 框架对比
    └── vue-vs-react.md
```

## 快速开始

### 安装依赖

```bash
cd vitepress-docs
npm install
```

### 本地开发

```bash
npm run dev
```

访问 http://localhost:5173 查看文档。

### 构建生产版本

```bash
npm run build
```

构建产物在 `.vitepress/dist` 目录。

### 预览生产版本

```bash
npm run preview
```

## 文档内容

### Vue 三大模块

- **响应式系统** - ref、reactive、effect 与依赖收集原理
- **编译时** - parse / transform / generate 三阶段与编译优化
- **运行时** - 虚拟 DOM、Diff、组件系统、生命周期、运行时架构

### Vue 扩展专题

- **弹窗系统** - Promise 弹窗、createDialog 工厂、命令式组件调用
- **组件能力** - provide/inject、插槽、Teleport、异步组件、keep-alive
- **生态与进阶** - 组合式 API、自定义指令、过渡动画、Vue Router、Pinia、SSR 与水合

### React 核心机制

- **JSX 与 Element** - JSX 编译产物与 Element/Fiber 的关系
- **Fiber 架构** - 可中断调度、双缓冲两阶段、协调与 Diff
- **Hooks 原理** - memoizedState 链表、更新队列、effect 与依赖比较
- **调度与并发** - Scheduler、Lane 优先级、并发特性与 Suspense
- **事件系统** - 合成事件与事件委托

### React 扩展专题

- **数据流与渲染** - Context、Ref、Portals、受控/非受控组件
- **优化与生命周期** - memo/PureComponent、错误边界、类组件生命周期
- **生态** - 状态管理方案、React Router
- **现代特性** - React 18 新 Hooks、React 19 新特性、SSR 与水合
- **手写实现** - 手写简化版 Hooks 与 mini-react

### 框架对比

- **Vue vs React** - 设计哲学、更新机制、运行时结构的全面对比

## 配置说明

文档配置在 `.vitepress/config.mts` 中，包括：

- **侧边栏** - 按 Vue / React 主题分组组织内容
- **顶部导航** - 快速访问主要部分
- **搜索** - 支持本地搜索
- **社交链接** - 链接到 Vue GitHub 仓库

## 自定义

### 添加新页面

1. 在对应目录下创建新的 `.md` 文件
2. 在 `.vitepress/config.mts` 的 `sidebar` 中添加链接

### 修改主题

VitePress 使用默认主题，可以通过 `themeConfig` 进行配置。

## 部署

### GitHub Pages

1. 在仓库设置中启用 GitHub Pages
2. 选择 `gh-pages` 分支或 `docs/` 目录
3. 构建并推送：

```bash
npm run build
git add .vitepress/dist
git commit -m "build: update docs"
git subtree push --prefix .vitepress/dist origin gh-pages
```

### Vercel / Netlify

直接连接仓库，设置构建命令为：

```bash
npm run build
```

输出目录为 `.vitepress/dist`。

## 技术栈

- [VitePress](https://vitepress.dev/) - 静态网站生成器
- [Vue 3](https://vuejs.org/) - 渐进式 JavaScript 框架
- [React](https://react.dev/) - 用于构建用户界面的 JavaScript 库
- [Vite](https://vitejs.dev/) - 下一代前端构建工具

## 许可证

MIT License
