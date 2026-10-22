# 插件配置与常用插件

本页介绍如何在 `vite.config` 中使用插件、插件的执行顺序，以及项目中最常用的官方/社区插件。插件开发（钩子机制、虚拟模块等）属于进阶内容，后续单独展开。

## 使用插件

插件以数组形式注册，按数组顺序执行：

```ts
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'

export default defineConfig({
  plugins: [
    vue(),
    vueJsx()
  ]
})
```

> Vite 插件兼容 Rollup 插件接口，但并非所有 Rollup 插件都能在 Vite 中工作（依赖完整 bundle 阶段的插件除外）。

## 插件顺序

Vite 将插件分为四类，按顺序执行：

1. **Alias**（别名解析）
2. **Pre**（`enforce: 'pre'`，或插件内部标记为 pre）
3. **Normal**（普通插件）
4. **Post**（`enforce: 'post'`）

```ts
plugins: [
  { name: 'my-plugin', enforce: 'pre', transform(code, id) { /* ... */ } }
]
```

数组内部顺序同样重要：先注册的插件先执行同名钩子。

## 官方插件

### @vitejs/plugin-vue

Vue 3 单文件组件（SFC）支持：

```ts
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [
    vue({
      // 传给 vue/compiler-sfc 的选项
      script: { defineModel: true },
      template: { compilerOptions: {} }
    })
  ]
})
```

### @vitejs/plugin-vue-jsx

Vue 3 JSX/TSX 支持：

```ts
import vueJsx from '@vitejs/plugin-vue-jsx'

plugins: [vue(), vueJsx()]
```

### @vitejs/plugin-legacy

兼容不支持原生 ESM 的旧浏览器，生成 UMD 产物并注入 `SystemJS`：

```ts
import legacy from '@vitejs/plugin-legacy'

plugins: [
  legacy({
    targets: ['defaults', 'not IE 11']
  })
]
```

### @vitejs/plugin-basic-ssl

开发服务器快速启用 HTTPS（自签证书）：

```ts
import basicSsl from '@vitejs/plugin-basic-ssl'

plugins: [basicSsl()]
```

## 常用社区插件

### unplugin-auto-import / unplugin-vue-components

自动按需导入 API 与组件，免去手写 `import`：

```ts
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ArcoResolver } from 'unplugin-vue-components/resolvers'

export default defineConfig({
  plugins: [
    AutoImport({
      imports: ['vue', 'vue-router', 'pinia'],
      resolvers: [ArcoResolver()],
      dts: 'src/auto-imports.d.ts'
    }),
    Components({
      resolvers: [ArcoResolver({ sideEffect: true })],
      dts: 'src/components.d.ts'
    })
  ]
})
```

### vite-plugin-svg-icons

SVG 雪碧图：

```ts
import { createSvgIconsPlugin } from 'vite-plugin-svg-icons'
import path from 'node:path'

plugins: [
  createSvgIconsPlugin({
    iconDirs: [path.resolve(process.cwd(), 'src/icons')],
    symbolId: 'icon-[dir]-[name]'
  })
]
```

### vite-plugin-compression

产物 gzip/brotli 压缩（配合 Nginx `gzip_static`）：

```ts
import viteCompression from 'vite-plugin-compression'

plugins: [
  viteCompression({ algorithm: 'gzip', ext: '.gz' })
]
```

### vite-plugin-mock

本地 Mock 数据：

```ts
import { viteMockServe } from 'vite-plugin-mock'

plugins: [
  viteMockServe({
    mockPath: 'mock',
    enable: process.env.NODE_ENV === 'development'
  })
]
```

## 速查：该用哪个插件

| 需求 | 方案 |
| --- | --- |
| Vue SFC / JSX | `@vitejs/plugin-vue` / `plugin-vue-jsx` |
| 旧浏览器兼容 | `@vitejs/plugin-legacy` |
| 本地 HTTPS | `@vitejs/plugin-basic-ssl` |
| 自动导入 API/组件 | `unplugin-auto-import` + `unplugin-vue-components` |
| 产物压缩 | `vite-plugin-compression` |
| 接口 Mock | `vite-plugin-mock` |
| PWA | `vite-plugin-pwa` |
| 环境变量校验 | `vite-plugin-checker`（类型/lint 检查） |
