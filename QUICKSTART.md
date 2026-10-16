# 快速启动指南

## 项目位置

项目位于 `vitepress-docs` 目录（本仓库根目录）。

## 启动步骤

### 1. 打开终端

在 `vitepress-docs` 目录打开终端（Windows 可以用 PowerShell 或 CMD）

### 2. 安装依赖

```bash
npm install
```

### 3. 启动开发服务器

```bash
npm run dev
```

### 4. 访问文档

打开浏览器访问：http://localhost:5173

## 文档结构

```
vitepress-docs/
├── index.md                  # 首页
├── .vitepress/config.mts     # 配置文件（侧边栏、导航等）
│
├── vue/
│   ├── basics/               # 基础与实战（Arco 配置、事件处理）
│   ├── dialogs/              # 弹窗系统（Promise / createDialog / 命令式）
│   ├── reactivity/           # 响应式系统
│   ├── compiler/             # 编译时（编译流程、指令、代码生成、SFC、优化）
│   ├── rendering/            # render/h、虚拟 DOM、Diff、nextTick
│   ├── components/           # 组件系统、生命周期、provide/inject、slot、Teleport 等
│   ├── advanced/             # 组合式 API、Router、Pinia、SSR、过渡动画等
│   └── handwritten/          # 手写响应式
│
├── react/
│   ├── jsx/                  # JSX 与 Element
│   ├── fiber/                # Fiber 架构
│   ├── hooks/                # Hooks 原理
│   ├── scheduler/            # 调度与并发
│   ├── events/               # 事件系统
│   ├── context/ ref/ render/ forms/ optimization/ lifecycle/ state/ ecosystem/ modern/ ssr/ handwritten/
│   └── index.md              # React 原理总览
│
├── compare/
│   └── vue-vs-react.md       # 框架对比
│
└── interview/                # 面试题专区
    ├── frontend-basics/      # 前端基础面试题（每小节一题）
    ├── vue-react/            # Vue & React 面试题（每小节一题）
    └── java/                 # Java 面试题（按模块分目录：basics/concurrent/jvm/mysql/redis/spring/mq/distributed）
```

## 主要特性

- **侧边栏导航** - 按 Vue / React 主题分组，方便查找
- **搜索功能** - 支持本地搜索
- **代码高亮** - 自动语法高亮
- **响应式设计** - 支持移动端
- **暗色主题** - 自动跟随系统主题

## 自定义修改

### 修改文档标题和描述

编辑 `.vitepress/config.mts`：

```typescript
export default defineConfig({
  title: '你的文档标题',
  description: '你的文档描述',
  // ...
})
```

### 添加新页面

1. 在对应目录下创建新的 `.md` 文件（如 `vue/advanced/new-page.md`）
2. 在 `.vitepress/config.mts` 的 `sidebar` 中添加链接：

```typescript
sidebar: [
  {
    text: '高级话题',
    items: [
      { text: '新页面', link: '/vue/advanced/new-page' }
    ]
  }
]
```

### 修改首页

编辑 `index.md` 文件，可以修改：
- Hero 区域的标题和描述
- 特性介绍卡片
- 快速开始部分

## 构建生产版本

```bash
npm run build
```

构建产物在 `.vitepress/dist` 目录。

## 部署选项

### GitHub Pages

1. 推送代码到 GitHub
2. 在仓库设置中启用 GitHub Pages
3. 选择分支和目录

### Vercel

1. 连接 GitHub 仓库
2. 自动检测 VitePress 项目
3. 自动部署

### Netlify

1. 连接 GitHub 仓库
2. 设置构建命令：`npm run build`
3. 设置输出目录：`.vitepress/dist`

## 技术支持

如有问题，可以参考：
- [VitePress 官方文档](https://vitepress.dev/)
- [Vue 3 文档](https://vuejs.org/)
- [React 文档](https://react.dev/)
- [Vite 文档](https://vitejs.dev/)
