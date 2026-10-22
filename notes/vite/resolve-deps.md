# resolve 与依赖预构建

本页覆盖 `resolve`（路径解析）与 `optimizeDeps`（依赖预构建）两组配置。

## resolve

### resolve.alias

- **类型**：`Record<string, string | Array> | Array<{ find, replacement, customResolver }>`
- **默认值**：`{}`

路径别名，等价于 Webpack 的 `resolve.alias`。

对象写法：

```ts
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
})
```

数组写法（更精确，支持正则）：

```ts
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)/, replacement: '/src/$1' }
    ]
  }
})
```

> 提示：Vite 推荐直接使用相对路径或 `node_modules` 包名导入，别名只用于简化长路径。

### resolve.extensions

- **类型**：`string[]`
- **默认值**：`['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json']`

导入时尝试自动补全的后缀列表。自定义顺序会影响同名文件的解析优先级。

### resolve.preserveSymlinks

- **类型**：`boolean`
- **默认值**：`false`

开启后，符号链接的文件会以链接路径解析（而非真实路径），适合 monorepo 调试场景。

## optimizeDeps（依赖预构建）

Vite 启动时会将 CommonJS/UMD 依赖和大量 ES Module 依赖用 esbuild 预打包成 ESM，减少开发时的请求瀑布。以下情况一般不需要手动干预，只有出现异常时才调整。

### optimizeDeps.entries

- **类型**：`string | string[]`
- **默认值**：`index.html` 所在目录下的入口扫描

指定扫描入口（glob 写法），让预构建发现动态导入的依赖：

```ts
export default defineConfig({
  optimizeDeps: {
    entries: ['src/**/*.vue', 'src/**/*.ts']
  }
})
```

### optimizeDeps.include

- **类型**：`string[]`
- **默认值**：`[]`

强制预构建的依赖。典型场景：

- 通过动态导入、间接引用发现的 CJS 包
- monorepo 中需要预构建的本地包

```ts
export default defineConfig({
  optimizeDeps: {
    include: ['lodash-es', 'some-cjs-package']
  }
})
```

### optimizeDeps.exclude

- **类型**：`string[]`
- **默认值**：`[]`

强制不预构建的依赖。典型场景：预构建后出现异常的纯 ESM 包。

### optimizeDeps.force

- **类型**：`boolean`
- **默认值**：`false`

强制忽略缓存重新预构建，等价于命令行 `vite --force`。

### optimizeDeps.esbuildOptions

- **类型**：`EsbuildOptions`
- **说明**：透传给 esbuild 的选项，如 `define`、`loader`、`target`。

## 常见问题速查

| 现象 | 处理 |
| --- | --- |
| 依赖没有自动更新 | 重启时加 `--force`，或配置 `optimizeDeps.entries` |
| CJS 包报 `does not provide an export named` | 加入 `optimizeDeps.include` |
| 纯 ESM 包预构建后行为异常 | 加入 `optimizeDeps.exclude` |
| monorepo 本地包热更新不生效 | 配置 `resolve.preserveSymlinks` 或将包加入 `include` |
