# Rollup 基础配置

Rollup 是 ES Module 优先的打包器：基于 ESM 静态结构做 tree-shaking，产物干净、体积小，因此**特别适合打包库**；应用打包通常直接用 Vite（其构建层就是 Rollup）。本页只覆盖基础配置，插件开发（钩子机制）后续单独展开。

配置文件为 `rollup.config.js`（或 `.mjs` / `.ts`），导出对象或数组：

```bash
npm i -D rollup
npx rollup -c            # 使用配置文件
npx rollup src/index.js -f es -o dist/bundle.js   # 纯命令行
```

## input

- **类型**：`string | string[] | object`

打包入口。对象形式可为多入口命名：

```js
export default {
  input: {
    main: 'src/index.js',
    vendor: 'src/vendor.js'
  }
}
```

## output

- **类型**：`object | object[]`

输出配置，可以是数组（一份输入产出多种格式）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `file` | `string` | 单入口时指定输出文件 |
| `dir` | `string` | 多入口/代码分割时指定输出目录 |
| `format` | `string` | 输出格式：`es` / `cjs` / `umd` / `iife` / `amd` / `system` |
| `name` | `string` | `umd` / `iife` 必需，全局变量名 |
| `globals` | `object` | 外部依赖的全局变量映射（umd 用） |
| `sourcemap` | `boolean \| 'inline'` | 是否生成 map |
| `entryFileNames` / `chunkFileNames` / `assetFileNames` | `string` | 文件名规则，支持 `[name]` `[hash]` |

```js
export default {
  input: 'src/index.js',
  output: [
    { file: 'dist/bundle.es.js', format: 'es' },
    {
      file: 'dist/bundle.umd.js',
      format: 'umd',
      name: 'MyLib',
      globals: { vue: 'Vue' }
    }
  ]
}
```

## plugins

- **类型**：`Plugin[]`

Rollup 插件是带钩子的对象，数组顺序即执行优先级。基础打包常备组合：

```js
import { nodeResolve } from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import replace from '@rollup/plugin-replace'
import terser from '@rollup/plugin-terser'
import typescript from '@rollup/plugin-typescript'

export default {
  input: 'src/index.ts',
  output: { file: 'dist/bundle.js', format: 'es' },
  plugins: [
    typescript(),                       // TS 编译
    nodeResolve(),                      // 解析 node_modules 中的 ESM
    commonjs(),                         // CJS 转 ESM（必须放在 resolve 之后）
    json(),                             // 导入 .json
    replace({ preventAssignment: true, __DEV__: 'false' }),
    terser()                            // 压缩
  ]
}
```

> 裸用 Rollup 打浏览器代码时，`nodeResolve` + `commonjs` 几乎是必配，否则无法解析包名与 CJS 依赖。

## external

- **类型**：`string | string[] | (id) => boolean`

排除不打进产物的依赖（库模式必备，避免把 peer 依赖打包）：

```js
export default {
  input: 'src/index.js',
  external: ['vue', /^element-plus/],   // 正则也可
  output: { file: 'dist/bundle.js', format: 'es' }
}
```

函数形式可动态判断：

```js
external: (id) => !id.startsWith('.') && !path.isAbsolute(id)  // 所有裸包名外部化
```

## treeshake

- **类型**：`boolean | object`
- **默认值**：`true`

默认开启。设为 `false` 关闭；对象形式可细调（如 `moduleSideEffects` 声明无副作用）：

```js
treeshake: {
  moduleSideEffects: false   // 告知 Rollup 未使用的 import 可安全删除
}
```

## watch

- **类型**：`boolean | object`

监听模式（`npx rollup -c -w`），对象可限定范围：

```js
watch: {
  include: 'src/**',
  exclude: 'node_modules/**',
  clearScreen: false
}
```

## 多配置与命令

导出数组即一次构建多个目标：

```js
export default [
  { input: 'src/index.js', output: { file: 'dist/es.js', format: 'es' } },
  { input: 'src/cli.js', output: { file: 'dist/cli.js', format: 'cjs' } }
]
```

常用 CLI 参数：

| 参数 | 说明 |
| --- | --- |
| `-c, --config` | 使用配置文件 |
| `-w, --watch` | 监听重建 |
| `-d, --dir` | 输出目录 |
| `-f, --format` | 输出格式 |
| `-o, --file` | 输出文件 |
| `-m, --sourcemap` | 生成 sourcemap |

## 与 Webpack 的差异速记

| 维度 | Rollup | Webpack |
| --- | --- | --- |
| 模块规范 | ESM 优先 | 任意规范 |
| tree-shaking | 天然、彻底 | 依赖 ESM + sideEffects 标记 |
| 代码分割 | 支持（动态 import） | 成熟（splitChunks） |
| 适用场景 | 库打包 | 应用打包 |
| 产物形态 | 接近手写 ESM，干净 | 带运行时包装 |
