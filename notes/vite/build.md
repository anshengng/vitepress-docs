# build 构建配置

本页覆盖 `build` 选项组，即 `vite build` 产物的行为控制。

## 基础输出

### build.target

- **类型**：`string | string[]`
- **默认值**：`'modules'`

编译目标。`'modules'` 等价于现代浏览器基线（`['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14']`）。也可指定 `'es2015'`、`'esnext'` 或具体浏览器版本列表。

### build.outDir

- **类型**：`string`
- **默认值**：`'dist'`

输出目录，相对于 `root`。

### build.assetsDir

- **类型**：`string`
- **默认值**：`'assets'`

静态资源（图片、字体等）在 `outDir` 内的存放子目录。

### build.assetsInlineLimit

- **类型**：`number | ((filePath, content) => number | boolean | undefined)`
- **默认值**：`4096`（4 KiB）

小于该阈值的资源会被内联为 base64 data URL，否则作为独立文件输出。

### build.sourcemap

- **类型**：`boolean | 'inline' | 'hidden'`
- **默认值**：`false`

- `true`：生成独立 `.map` 文件
- `'inline'`：map 内联在产物中
- `'hidden'`：生成 map 但不在产物中引用（适合上传错误监控平台）

### build.emptyOutDir

- **类型**：`boolean`
- **默认值**：`undefined`（根据 `outDir` 是否在 root 内自动判断）

构建前是否清空输出目录。

### build.copyPublicDir

- **类型**：`boolean`
- **默认值**：`true`

是否将 `publicDir` 内容复制到 `outDir`。

### build.reportCompressedSize

- **类型**：`boolean`
- **默认值**：`true`

是否计算并报告 gzip 大小。关闭可加快大型项目的构建速度。

### build.chunkSizeWarningLimit

- **类型**：`number`
- **默认值**：`500`

chunk 体积警告阈值（kB）。

## 压缩与拆分

### build.minify

- **类型**：`boolean | 'terser' | 'esbuild' | 'oxlify'`
- **默认值**：`'esbuild'`

压缩器选择。需要更细粒度控制（如保留特定注释、移除 console）时选 `'terser'` 并配合 `build.terserOptions`。

### build.cssMinify

- **类型**：`boolean | 'esbuild' | 'lightningcss'`
- **默认值**：同 `minify`

CSS 压缩方式。

### build.cssCodeSplit

- **类型**：`boolean`
- **默认值**：`true`

将 CSS 按 chunk 拆分，页面按需加载各自样式。关闭则合并为单个 CSS 文件。

### build.modulePreload

- **类型**：`boolean | { polyfill?: boolean; resolveDependencies?: Function }`
- **默认值**：`{ polyfill: true }`

动态导入 chunk 的预加载控制。

## Rollup 集成

### build.rollupOptions

- **类型**：`RollupOptions`

透传给 Rollup 的完整配置，最常用的是 `output` 自定义分包与文件名：

```ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // 手动分包：把第三方库拆出来
        manualChunks: {
          vendor: ['vue', 'pinia', 'vue-router'],
          arco: ['@arco-design/web-vue']
        },
        // 自定义产物文件名
        chunkFileNames: 'js/[name]-[hash].js',
        entryFileNames: 'js/[name]-[hash].js',
        assetFileNames: '[ext]/[name]-[hash].[ext]'
      }
    }
  }
})
```

函数形式可以按模块路径自动分包：

```ts
manualChunks(id) {
  if (id.includes('node_modules')) {
    return id.toString().split('node_modules/')[1].split('/')[0].toString()
  }
}
```

### build.commonjsOptions

- **类型**：`RollupCommonJSOptions`

透传给 `@rollup/plugin-commonjs`，处理 CJS 依赖时使用。

### build.dynamicImportVarsOptions

- **类型**：`Options`

处理 `import(variable)` 动态导入时的模块匹配规则。

## 库模式（lib）

### build.lib

- **类型**：`{ entry, name, formats, fileName, cssFileName?, patches? }`

以库的形式打包：

```ts
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'MyLib',
      formats: ['es', 'cjs', 'umd'],
      fileName: (format) => `my-lib.${format}.js`
    },
    rollupOptions: {
      // 把 peer 依赖 external 掉，不打进产物
      external: ['vue'],
      output: { globals: { vue: 'Vue' } }
    }
  }
})
```

| 字段 | 说明 |
| --- | --- |
| `entry` | 打包入口（字符串或对象，多入口） |
| `name` | UMD/IIFE 格式的全局变量名 |
| `formats` | 输出格式：`es` / `cjs` / `umd` / `iife`，默认 `['es', 'cjs']` |
| `fileName` | 输出文件名规则 |

> 库模式不会处理 `index.html`，需配合 `build.rollupOptions` 与 `external` 排除依赖。

## SSR 构建

### build.ssr

- **类型**：`boolean | string`

以 SSR 为目标构建，`true` 使用 `entry` 配置，字符串指定入口文件。

### build.ssrManifest

- **类型**：`boolean | string`
- **默认值**：`false`

生成 SSR 资源清单，供服务端注入 preload 标签。

### build.sourcemap / build.target 在 SSR 下

SSR 构建默认 `target: 'node'`、`ssr: true`，产物为 Node 可执行的 ESM/CJS。
