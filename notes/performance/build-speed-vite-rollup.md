# Vite 与 Rollup 构建提速

Vite 的构建要分成两段看：**开发阶段靠 esbuild 按需编译，生产构建仍然交给 Rollup**。两段的瓶颈完全不同，优化手段也不一样。

| 阶段 | 谁在干活 | 主要瓶颈 | 优化目标 |
| --- | --- | --- | --- |
| 开发（`vite dev`） | esbuild 依赖预构建 + 按需 transform | 依赖预构建、首屏请求瀑布、插件过多 | 冷启动、HMR 响应 |
| 生产（`vite build`） | Rollup | 插件链、chunk 数量、sourcemap、压缩 | 构建耗时与产物体积 |

## 一、开发阶段：减少重复预构建与插件开销

### 依赖预构建的缓存

Vite 会把 `node_modules` 里的依赖预构建到 `node_modules/.vite`。只要依赖版本和配置不变，后续启动会复用缓存。常见的「每次启动都重新构建」通常来自：

- `optimizeDeps.force: true`（强制重建，调试时用，不要常驻）
- 依赖列表或锁文件变化
- 配置文件改动导致缓存 key 变化

```ts
export default defineConfig({
  optimizeDeps: {
    // 把运行时才发现的依赖提前纳入预构建，避免页面打开时二次构建
    include: ['lodash-es', 'axios'],
    // 明确排除不需要预构建的包（如已经是 ESM 且无需合并的库）
    exclude: ['some-esm-only-lib']
  }
})
```

### 预热首屏文件

Vite 5+ 支持在服务启动后预热指定文件，避免第一次打开页面时集中 transform：

```ts
export default defineConfig({
  server: {
    warmup: {
      clientFiles: [
        './src/main.ts',
        './src/App.vue',
        './src/router/**/*.ts'
      ]
    }
  }
})
```

### 让重插件只在构建期生效

分析、压缩、SSR 相关的插件往往只在 `vite build` 时需要。用 `apply` 把它们挡在开发阶段之外：

```ts
export default defineConfig({
  plugins: [
    {
      name: 'build-only-plugin',
      apply: 'build',           // 仅构建阶段启用
      // ...
    }
  ]
})
```

同理，`visualizer` 这类分析插件不要常驻，按需通过环境变量开启。

## 二、生产构建：Vite 侧的可控项

```ts
export default defineConfig({
  build: {
    // 生产默认 esbuild，已是最快的压缩方案之一
    minify: 'esbuild',
    // 不需要线上 sourcemap 就关掉，省下大量时间与体积
    sourcemap: false,
    // 大型项目关闭 gzip 体积统计，能明显缩短构建时间
    reportCompressedSize: false,
    // 目标越现代，降级转换越少
    target: 'es2020',
    rollupOptions: {
      output: {
        // 控制 chunk 数量，避免碎包过多
        manualChunks: {
          vendor: ['vue', 'vue-router', 'pinia']
        }
      }
    }
  }
})
```

几个容易忽略的点：

- `build.target` 调得越现代，Babel/esbuild 做的降级越少；但要确认目标浏览器支持。
- `build.cssCodeSplit` 默认 `true`，按 chunk 拆 CSS；关闭后会合并成一个大 CSS 文件，请求少了但首屏可能更大，按项目权衡。
- `build.assetsInlineLimit` 调大可以把小图内联，减少请求，但会增大 JS/CSS 体积。

## 三、Rollup 构建提速（库模式尤其重要）

Vite 的 `build` 底层就是 Rollup；如果直接用 Rollup 打包库，优化点更集中：

```js
// rollup.config.js
export default {
  input: 'src/index.ts',
  external: ['vue', 'vue-router'],        // peer 依赖不要打进产物
  perf: true,                             // 输出各阶段耗时，先定位再优化
  output: {
    dir: 'dist',
    format: 'es',
    sourcemap: false                      // 不需要就关
  },
  plugins: [
    // 只保留必要的 transform 插件
  ]
}
```

要点：

- **`external` 是库构建提速和减体积的第一杠杆**：把 `peerDependencies` 全部 external，既快又小。
- **减少 transform 插件**：每多一个插件，每个模块就多一次 AST 遍历。
- **`perf: true`** 会打印各阶段耗时，先看是 resolve、transform 还是 render 慢。
- **`maxParallelFileOps`** 控制同时打开的文件数，文件极多时适当调低可减少 I/O 抖动，调高可提升吞吐（取决于磁盘）。
- **watch 模式**会自动复用上一次的模块图，增量构建远快于全量；不要每次都重启进程。

## 四、Vite 构建突然变慢的排查顺序

```
构建变慢
  │
  ├─ 1. 插件变多了？           → 检查新加的插件是否 apply: 'build' 且必要
  ├─ 2. sourcemap 开了？       → build.sourcemap 是否为 true
  ├─ 3. 压缩器换了？           → terser 比 esbuild 慢很多
  ├─ 4. target 太低？          → 大量降级转换
  ├─ 5. 依赖反复预构建？       → optimizeDeps 缓存是否失效
  ├─ 6. chunk 太碎或太大？     → manualChunks 策略是否合理
  └─ 7. 单文件巨大？           → 拆分超大组件 / 超大 JSON
```

## 工具对比小节

| 能力 | Vite | Rollup | Webpack | esbuild |
| --- | --- | --- | --- | --- |
| 开发期编译 | esbuild 按需 transform | 不适用（无 dev server） | 全量构建 + watch | 可用 serve/watch |
| 依赖预构建 | `optimizeDeps` + `.vite` 缓存 | 无 | 无（靠 `cache`） | 无（靠自身速度） |
| 构建期引擎 | Rollup | Rollup | 自研 | 自研 |
| 关闭 sourcemap 提速 | `build.sourcemap: false` | `output.sourcemap: false` | `devtool: false` | `sourcemap: false` |
| 库模式 external | `build.rollupOptions.external` | `external` | `externals` | `external` |
| 构建耗时分析 | `--debug` / `--profile` | `perf: true` | `--profile` + SMP | `metafile` |
| 并行文件操作 | 由 Rollup 控制 | `maxParallelFileOps` | `thread-loader` | Go 协程 |

## 相关页面

- [Vite build 构建配置](/notes/vite/build)
- [Vite resolve 与依赖预构建](/notes/vite/resolve-deps)
- [Vite 底层原理（Dev 与 HMR）](/notes/vite/dev-principle)
- [Rollup 执行流程与架构总览](/notes/rollup/architecture-flow)
- [Webpack 构建提速](/notes/performance/build-speed-webpack)
