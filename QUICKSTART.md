# 快速启动指南

## 项目位置

所有文件都保存在以下目录：

```
C:\Users\28719\AppData\Local\Claude-3p\local-agent-mode-sessions\67ee9808\00000000\0258e6ae\outputs\vitepress-docs
```

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
├── index.md                  # 首页（带特性介绍）
├── .vitepress/config.mts     # 配置文件（侧边栏、导航等）
│
├── 基础概念/
│   ├── tfcc.md               # TFCC 介绍
│   └── arco-config.md        # Arco Design 配置
│
├── 弹窗系统/
│   ├── promise-dialog.md     # Promise 弹窗方案
│   ├── create-dialog.md      # createDialog 工厂
│   └── imperative-dialog.md  # 命令式组件调用
│
├── Vue 底层原理/
│   ├── render-and-h.md       # render 和 h 函数
│   ├── reactivity.md         # 响应式系统
│   ├── virtual-dom.md        # 虚拟 DOM
│   └── component-system.md   # 组件系统
│
└── 高级话题/
    ├── functional-component.md  # 函数式组件
    └── runtime-architecture.md  # 运行时架构
```

## 主要特性

✅ **侧边栏导航** - 按主题分类，方便查找  
✅ **搜索功能** - 支持本地搜索  
✅ **代码高亮** - 自动语法高亮  
✅ **响应式设计** - 支持移动端  
✅ **暗色主题** - 自动跟随系统主题  

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

1. 创建新的 `.md` 文件（如 `new-page.md`）
2. 在 `.vitepress/config.mts` 的 `sidebar` 中添加链接：

```typescript
sidebar: [
  {
    text: '新分类',
    items: [
      { text: '新页面', link: '/new-page' }
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
- [Vite 文档](https://vitejs.dev/)
