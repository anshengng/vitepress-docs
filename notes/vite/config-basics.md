# 配置文件与环境变量

本页覆盖 Vite 配置文件的组织方式，以及 `root` / `base` / `publicDir` / `mode` 等顶层选项和环境变量机制。

## 配置文件

Vite 会在项目根目录查找 `vite.config.*` 文件，支持以下后缀：

```
vite.config.js
vite.config.mjs
vite.config.ts
vite.config.cjs
```

推荐使用 `defineConfig` 提供类型提示与智能补全：

```ts
// vite.config.ts
import { defineConfig } from 'vite'

export default defineConfig({
  // 类型检查与补全可用
})
```

### 条件配置

导出一个函数即可根据命令与模式返回不同配置：

```ts
import { defineConfig } from 'vite'

export default defineConfig(({ command, mode }) => {
  // command: 'serve'（开发）或 'build'（构建）
  if (command === 'serve') {
    return { define: { __DEV__: true } }
  } else {
    return { define: { __DEV__: false } }
  }
})
```

回调参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `command` | `'build' \| 'serve'` | 当前执行的命令 |
| `mode` | `string` | 当前模式，`serve` 默认 `development`，`build` 默认 `production` |
| `isSsrBuild` | `boolean` | 是否为 SSR 构建（3.1+） |
| `isPreview` | `boolean` | 是否为预览服务器（4.0+） |

## 顶层选项

### root

- **类型**：`string`
- **默认值**：`process.cwd()`

项目根目录，`index.html` 所在的位置，也是依赖解析、构建输出的基准路径。

```ts
export default defineConfig({
  root: 'src' // 以 src 为根目录
})
```

### base

- **类型**：`string`
- **默认值**：`/`

应用部署的基础路径。所有静态资源引用都会以此为前缀。

```ts
export default defineConfig({
  base: '/my-app/' // 部署到子路径时使用
})
```

特殊值：

- `''` 或 `'./'`：相对路径，适合不确定部署位置的场景
- `'//foo/bar/'`：协议相对路径

### publicDir

- **类型**：`string | false`
- **默认值**：`'public'`

静态资源目录。该目录下的文件在开发时以 `/` 路径直接访问，构建时原样复制到 `outDir`，**不做任何处理**（文件名不会被 hash，内容不会被编译）。

```ts
export default defineConfig({
  publicDir: 'static' // 自定义静态目录
})
```

### mode

- **类型**：`string`
- **默认值**：开发为 `'development'`，构建为 `'production'`

可通过命令行覆盖：

```bash
vite build --mode staging
```

## 环境变量

### .env 文件加载规则

Vite 使用 [dotenv](https://github.com/motdotla/dotenv) 加载环境变量，按以下顺序合并（优先级从高到低）：

```
.env                # 所有模式都加载
.env.local          # 所有模式都加载，但被 git 忽略
.env.[mode]         # 只在指定模式下加载
.env.[mode].local   # 只在指定模式下加载，但被 git 忽略
```

> 注意：以 `.local` 结尾的文件不应提交到版本库。

### VITE\_ 前缀

**只有以 `VITE_` 为前缀的变量才会暴露给客户端代码**，避免数据库密码等敏感信息泄漏到产物中：

```bash
# .env
VITE_API_URL=https://api.example.com
DB_PASSWORD=secret   # 不会暴露给浏览器
```

```ts
// 业务代码中通过 import.meta.env 读取
console.log(import.meta.env.VITE_API_URL)
```

可通过 `envPrefix` 修改前缀（支持多个）：

```ts
export default defineConfig({
  envPrefix: ['VITE_', 'APP_']
})
```

### import.meta.env 内置变量

| 变量 | 说明 |
| --- | --- |
| `BASE_URL` | 部署基础路径，即 `base` 的值 |
| `MODE` | 当前模式 |
| `DEV` | 布尔值，是否处于开发环境 |
| `PROD` | 布尔值，是否处于生产环境 |
| 自定义 `VITE_*` | 从 `.env` 文件加载的变量 |

### loadEnv

在配置文件中读取 `.env` 变量（不会自动加 `VITE_` 前缀限制）：

```ts
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  // 第三个参数 '' 表示加载所有变量，不限前缀
  const env = loadEnv(mode, process.cwd(), '')
  return {
    server: {
      port: Number(env.PORT) || 5173
    }
  }
})
```

## 常见搭配示例

多环境（开发 / 测试 / 生产）：

```bash
# .env.development
VITE_API_URL=http://localhost:8080

# .env.production
VITE_API_URL=https://api.example.com
```

```json
// package.json
{
  "scripts": {
    "dev": "vite --mode development",
    "build:test": "vite build --mode test",
    "build": "vite build --mode production"
  }
}
```
