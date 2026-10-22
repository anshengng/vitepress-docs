# esbuild 基础配置

esbuild 是用 Go 编写的构建工具，核心卖点是**快**（比 JS 生态工具快 10-100 倍），主要能力是 TS/JSX 转换与 ESM/CJS 打包。Vite 开发环境的依赖预构建、JS/TS 编译默认都走 esbuild。本页只覆盖基础配置，进阶（自定义插件、与 SWC/Terser 对比）后续展开。

```bash
npm i -D esbuild
```

## CLI 用法

```bash
# 转换单个文件（不打包）
esbuild src/app.ts --outfile=dist/app.js

# 打包（递归处理依赖）
esbuild src/index.js --bundle --outfile=dist/bundle.js

# 常用组合：打包 + 目标 + 压缩 + sourcemap
esbuild src/index.tsx --bundle --platform=browser --target=es2020 \
  --minify --sourcemap --outfile=dist/bundle.js

# 监听重建
esbuild src/index.js --bundle --outfile=dist/bundle.js --watch
```

## build() JS API

CLI 的等价编程接口，也是绝大多数配置项的载体：

```js
import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/bundle.js',
  format: 'esm',
  platform: 'browser',
  target: ['es2020', 'chrome87', 'safari14'],
  minify: true,
  sourcemap: true,
  external: ['react'],
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.png': 'file' },
  logLevel: 'info'
})
```

核心选项：

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `entryPoints` | `string[]` | — | 入口文件列表 |
| `bundle` | `boolean` | `false` | 是否递归打包依赖 |
| `outfile` / `outdir` | `string` | — | 单输出文件 / 多输出目录（互斥） |
| `format` | `'iife' \| 'cjs' \| 'esm'` | `iife`（bundle）/ `esm` | 输出格式 |
| `platform` | `'browser' \| 'node' \| 'neutral'` | `browser` | 目标平台，决定默认条件与 `mainFields` |
| `target` | `string \| string[]` | `esnext` | 语法降级目标，如 `es2017`、`chrome80`、`esnext` |
| `minify` | `boolean` | `false` | 压缩（whitespace + identifiers + syntax） |
| `minifyWhitespace/Identifiers/Syntax` | `boolean` | — | 分别控制三类压缩 |
| `sourcemap` | `boolean \| 'linked' \| 'inline' \| 'external'` | `false` | map 策略 |
| `external` | `string[]` | `[]` | 外部化依赖（不打包），`platform=node` 时默认排除 node 内置模块 |
| `define` | `object` | — | 编译期文本替换，值需是合法 JS 表达式字符串 |
| `inject` | `string[]` | `[]` | 注入垫片文件（替代 ProvidePlugin） |
| `banner` / `footer` | `object` | — | 在产物头尾插入内容 |
| `tsconfig` | `string` | — | 读取 TS 编译选项（仅部分支持） |
| `watch` | `object \| boolean` | — | 监听模式 |
| `splitting` | `boolean` | `false` | 代码分割，**仅 `format: 'esm'` + `outdir` 可用** |
| `treeShaking` | `boolean` | `true`（bundle 时） | 未使用代码剔除 |
| `logLevel` | `'silent' \| 'error' \| 'warning' \| 'info' \| 'verbose'` | `info` | 日志级别 |
| `metafile` | `boolean` | `false` | 输出依赖/体积元信息（`result.metafile`） |

## transform() API

不做打包、只做单文件语法转换（TS → JS、JSX → JS、语法降级），Vite 处理源码时用的就是它：

```js
import { transform } from 'esbuild'

const { code, map } = await transform(source, {
  loader: 'tsx',
  target: 'es2020',
  jsx: 'automatic',          // React 17+ 自动 JSX 运行时
  jsxImportSource: 'react',
  format: 'esm'
})
```

## loader 一览

告诉 esbuild 如何解析非 `.js` 文件：

| loader | 行为 |
| --- | --- |
| `js` / `jsx` / `ts` / `tsx` | 对应语言编译 |
| `css` | 解析 CSS 并打包 |
| `json` | JSON 转 ESM 模块 |
| `text` | 文件内容作为字符串导出 |
| `file` | 输出独立文件，导出其相对路径（带 hash） |
| `dataurl` / `base64` | 内联为 data URL / base64 |
| `empty` | 忽略该文件 |

显式指定：`loader: { '.png': 'file' }`；CLI 写法 `--loader:.png=file`。

## 能力边界（选型须知）

- **只做语法转换**：`target` 降级语法，但**不注入 polyfill**（Promise、fetch 等 API 兼容需自行配合 core-js）
- **CSS 支持有限**：能打包压缩 CSS，但无 PostCSS 生态、无 CSS Modules 完整支持
- **无 HMR**：esbuild 本身不提供热更新，需配合 Vite/Dev Server 使用
- 定位是「编译/打包引擎」，而非完整应用构建方案

## 与 Vite 的关系

| Vite 环节 | esbuild 角色 |
| --- | --- |
| 依赖预构建 `optimizeDeps` | esbuild 打包（CJS → ESM） |
| TS/JSX 开发期转换 | esbuild `transform`（只转语法，类型由 IDE/vue-tsc 检查） |
| 生产构建 | Rollup（esbuild 仅负责压缩，除非配置 `build.minify: 'terser'`） |
