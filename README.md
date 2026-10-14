# Vue 深度技术问答文档

基于 Vue 深度技术问答对话记录整理的 VitePress 文档。

## 项目结构

```
vitepress-docs/
├── .vitepress/
│   └── config.mts          # VitePress 配置
├── index.md                # 首页
├── tfcc.md                 # TFCC 介绍
├── arco-config.md          # Arco Design 配置
├── promise-dialog.md       # Promise 弹窗方案
├── create-dialog.md        # createDialog 工厂
├── imperative-dialog.md    # 命令式组件调用
├── render-and-h.md         # render 和 h 函数
├── reactivity.md           # 响应式系统
├── virtual-dom.md          # 虚拟 DOM
├── component-system.md     # 组件系统
├── functional-component.md # 函数式组件
├── runtime-architecture.md # 运行时架构
└── package.json
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

### 基础概念
- **TFCC** - 三角纤维软骨复合体介绍
- **Arco Design** - ConfigProvider 配置

### 弹窗系统
- **Promise 弹窗方案** - 使用 Promise 管理弹窗状态
- **createDialog 工厂** - 命令式调用弹窗组件
- **命令式组件调用** - 使用 render 函数动态创建组件

### Vue 底层原理
- **render 和 h 函数** - 虚拟 DOM 创建和渲染
- **响应式系统** - ref、reactive、effect 原理
- **虚拟 DOM** - VNode 结构和 Diff 算法
- **组件系统** - 组件创建和生命周期

### 高级话题
- **函数式组件** - 类似 ElMessage 的实现
- **运行时架构** - Vue 四大核心模块

## 配置说明

文档配置在 `.vitepress/config.mts` 中，包括：

- **侧边栏** - 按主题分类组织内容
- **顶部导航** - 快速访问主要部分
- **搜索** - 支持本地搜索
- **社交链接** - 链接到 Vue GitHub 仓库

## 自定义

### 添加新页面

1. 在根目录创建新的 `.md` 文件
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
- [Vite](https://vitejs.dev/) - 下一代前端构建工具

## 许可证

MIT License
