# css / json / define / esbuild

本页覆盖 `css`、`json`、`define`、`esbuild`、`worker`、`ssr` 等其余配置组。

## css

### css.devSourcemap

- **类型**：`boolean`
- **默认值**：`false`

开发环境下是否为 CSS 生成 sourcemap。

### css.preprocessorOptions

- **类型**：`Record<string, object>`

透传给 CSS 预处理器的选项。Sass 示例：

```ts
export default defineConfig({
  css: {
    preprocessorOptions: {
      scss: {
        // 全局注入变量文件，免去每个文件手动 @use
        additionalData: `@use "@/styles/variables.scss" as *;`
      },
      less: {
        javascriptEnabled: true,
        modifyVars: { 'primary-color': '#1677ff' }
      }
    }
  }
})
```

> 注意：新版 `sass-embedded` 中 `additionalData` 写法可能触发弃用警告，可改用 `api: 'modern-compiler'` 配合 `importers`。

### css.preprocessorMaxWorkers

- **类型**：`number | true`
- **默认值**：`0`（不启用）

预处理器并行编译的最大 worker 数，`true` 表示根据 CPU 核心数自动决定。

### css.transformer

- **类型**：`'postcss' | 'lightningcss'`
- **默认值**：`'postcss'`

CSS 后处理引擎。LightningCSS 更快，但生态插件兼容性需自行确认。

### css.modules

- **类型**：`{ localsConvention?, generateScopedName?, scopeBehaviour?, globalModulePaths? }`

CSS Modules 行为配置：

```ts
css: {
  modules: {
    // 类名风格：camelCase 与原始 kebab-case 同时导出
    localsConvention: 'camelCase',
    // 自定义生成的类名
    generateScopedName: '[name]__[local]___[hash:base64:5]'
  }
}
```

## json

### json.namedExports

- **类型**：`boolean`
- **默认值**：`true`

是否支持从 `.json` 文件按需具名导入（只打包用到的字段）：

```ts
import { version } from '../package.json'
```

### json.stringify

- **类型**：`boolean`
- **默认值**：`false`

大型 JSON 以字符串形式导入（避免解析开销）。

## define

- **类型**：`Record<string, any>`

定义全局常量替换，类似 Webpack 的 `DefinePlugin`。替换发生在编译期，是**文本级**的直接替换：

```ts
export default defineConfig({
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
    'process.env.VERSION': JSON.stringify('1.0.0')
  }
})
```

规则：

- 值必须是可 JSON 序列化的字符串，或本身就是字符串字面量；传对象/布尔需先 `JSON.stringify`
- 替换作用于所有代码（包括依赖），谨慎使用宽泛的键
- 类型提示需自行声明：`declare const __DEV__: boolean`

## esbuild

- **类型**：`esbuild.TransformOptions`

直接透传给 esbuild 的转换选项，影响 TS/JSX 编译：

```ts
export default defineConfig({
  esbuild: {
    // 生产构建移除 debugger 与 console
    drop: mode === 'production' ? ['console', 'debugger'] : [],
    // JSX 自动运行时注入
    jsxInject: `import React from 'react'`,
    legalComments: 'none'
  }
})
```

常用字段：`target`、`jsx`、`jsxInject`、`drop`、`pure`、`keepNames`、`tsconfigRaw`。

## worker

- **类型**：`{ format?: 'iife' | 'es'; plugins?; rollupOptions? }`

Web Worker 打包配置。`format: 'es'` 可让 Worker 使用动态导入：

```ts
worker: {
  format: 'es'
}
```

## ssr

- **类型**：`{ target?, external?, noExternal?, resolve?, optimizeDeps? }`

SSR 相关解析行为：

| 字段 | 说明 |
| --- | --- |
| `target` | `'node'`（默认）或 `'webworker'` |
| `external` | 强制外部化的依赖 |
| `noExternal` | 即使是 CJS 也强制内部打包的依赖 |

```ts
ssr: {
  noExternal: ['some-esm-only-lib']
}
```
