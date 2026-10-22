# server 开发服务器与 preview

本页覆盖 `server`（开发服务器）与 `preview`（构建预览）两组配置。

## server

### server.port

- **类型**：`number`
- **默认值**：`5173`

开发服务器端口。被占用时自动尝试下一个端口。

### server.host

- **类型**：`boolean | string`
- **默认值**：`false`（仅监听 `127.0.0.1`）

设为 `true` 或 `'0.0.0.0'` 可监听所有地址，局域网内其他设备即可访问：

```ts
export default defineConfig({
  server: { host: true }
})
```

### server.strictPort

- **类型**：`boolean`
- **默认值**：`false`

设为 `true` 时端口被占用直接报错，而不是自动递增。

### server.https

- **类型**：`https.ServerOptions`
- **默认值**：`undefined`

启用 HTTPS。需要配合证书，推荐用 `@vitejs/plugin-basic-ssl` 快速生成自签证书：

```ts
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [basicSsl()],
  server: { https: {} }
})
```

### server.open

- **类型**：`boolean | string`
- **默认值**：`false`

启动后自动打开浏览器，可指定浏览器名称（如 `'chrome'`）。

### server.cors

- **类型**：`boolean | CorsOptions`
- **默认值**：`true`

开发服务器默认允许跨域，便于本地调试。

### server.proxy

- **类型**：`Record<string, string | ProxyOptions>`
- **默认值**：`{}`

代理配置，底层使用 `http-proxy`。最常用的是把 `/api` 转发到后端：

```ts
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
})
```

`ProxyOptions` 常用字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `target` | `string` | 代理目标地址 |
| `changeOrigin` | `boolean` | 修改请求头 `Host` 为目标地址 |
| `rewrite` | `(path) => string` | 重写请求路径 |
| `ws` | `boolean` | 是否代理 WebSocket |
| `secure` | `boolean` | 目标为 HTTPS 时是否校验证书 |
| `configure` | `(proxy, options) => void` | 直接操作底层代理实例，监听错误等事件 |

WebSocket 代理示例：

```ts
proxy: {
  '/ws': {
    target: 'ws://localhost:3000',
    ws: true
  }
}
```

### server.hmr

- **类型**：`boolean | HmrOptions`
- **默认值**：`true`

热更新（HMR）配置。设为 `false` 可关闭，回退为全页刷新。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `protocol` | `string` | HMR 的 WebSocket 协议（`ws` / `wss`） |
| `host` | `string` | HMR WebSocket 主机名（页面与服务器不同域名时用） |
| `port` | `number` | HMR WebSocket 端口 |
| `path` | `string` | WebSocket 路径 |
| `timeout` | `number` | 重连超时 |
| `overlay` | `boolean` | 错误时是否在页面显示遮罩层 |

### server.watch

- **类型**：`{ ignored?: string | string[] \| RegExp }`

文件监听配置，基于 `chokidar`。监听大量文件时可排除无关目录：

```ts
export default defineConfig({
  server: {
    watch: { ignored: ['**/node_modules/**', '**/dist/**'] }
  }
})
```

### server.fs

- **类型**：`{ strict?: boolean; allow?: string[]; deny?: string[] }`

模块解析的安全限制。`strict`（默认 `true`）只允许访问项目根目录及工作区内的文件；`allow` 显式放行目录，`deny` 禁止访问敏感文件（默认已禁止 `.env`、`.git` 等）。

### server.headers

- **类型**：`OutgoingHttpHeaders`

给开发服务器所有响应添加自定义 HTTP 头。

### server.allowedHosts

- **类型**：`string | string[] | true`

允许访问 dev server 的域名，防止 DNS 重绑定攻击。使用自定义域名调试时可能需要配置。

### server.historyApiFallback

- **类型**：`boolean | HistoryOptions`

配合 SPA history 路由使用，Vite 内部已默认处理，一般无需手动开启。

## preview

`preview` 用于 `vite preview` 预览构建产物，选项与 `server` 大部分同名：

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `port` | `4173` | 预览端口 |
| `host` | `localhost` | 监听地址 |
| `strictPort` | `false` | 端口占用是否报错 |
| `https` | `undefined` | 是否启用 HTTPS |
| `proxy` | `undefined` | 代理配置（同 `server.proxy`） |

```ts
export default defineConfig({
  preview: { port: 8080 }
})
```
