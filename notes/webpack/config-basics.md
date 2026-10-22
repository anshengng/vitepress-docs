# Webpack 基础配置

Webpack 是模块打包器：以入口文件为起点递归分析依赖，通过 loader 处理非 JS 资源、通过 plugin 扩展构建流程，最终输出 bundle。本页只覆盖基础配置项，进阶（自定义 loader/plugin、优化实战）后续单独展开。

配置文件为项目根目录的 `webpack.config.js`，导出一个对象或函数：

```js
const path = require('node:path')

module.exports = (env, argv) => ({
  // argv.mode 可拿到命令行传入的模式
  mode: 'production',
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js'
  }
})
```

## entry

- **类型**：`string | string[] | object`
- **默认值**：`'./src/index.js'`

打包起点。常见形态：

```js
// 单入口
entry: './src/index.js'

// 多入口对象（推荐，可为每个入口命名）
entry: {
  main: './src/main.js',
  admin: './src/admin.js'
}
```

## output

- **类型**：`object`

输出配置，`path` 必须是**绝对路径**：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `filename` | `string` | 输出文件名，可用 `[name]` `[contenthash]` 占位符 |
| `path` | `string` | 输出目录（绝对路径） |
| `publicPath` | `string` | 资源引用前缀，部署到 CDN/子目录时配置 |
| `chunkFilename` | `string` | 异步 chunk 的文件名规则 |
| `clean` | `boolean` | 构建前清空 dist（webpack5，替代 clean-webpack-plugin） |

```js
output: {
  path: path.resolve(__dirname, 'dist'),
  filename: '[name].[contenthash:8].js',
  publicPath: '/static/',
  chunkFilename: '[name].[contenthash:8].chunk.js',
  clean: true
}
```

## mode

- **类型**：`'development' | 'production' | 'none'`
- **默认值**：`'production'`

决定内置优化行为：`development` 开启调试友好配置，`production` 自动压缩、tree-shaking、`DefinePlugin` 注入 `process.env.NODE_ENV`。

## devtool

- **类型**：`string`

SourceMap 策略，开发/构建推荐组合：

| 值 | 场景 |
| --- | --- |
| `'eval-cheap-module-source-map'` | 开发（快、定位到行） |
| `'source-map'` | 生产（完整映射，可上传错误平台） |
| `false` | 生产不输出 map |

## module.rules（loader）

loader 把非 JS 资源转换成 webpack 能处理的模块。规则按数组顺序匹配，同一 `use` 数组内**从右到左**执行：

```js
module: {
  rules: [
    {
      test: /\.jsx?$/,
      exclude: /node_modules/,
      use: {
        loader: 'babel-loader',
        options: { presets: ['@babel/preset-env', '@babel/preset-react'] }
      }
    },
    {
      test: /\.css$/,
      use: ['style-loader', 'css-loader']   // css-loader 先执行，style-loader 后注入
    },
    {
      test: /\.s[ac]ss$/,
      use: ['style-loader', 'css-loader', 'sass-loader']
    },
    {
      // webpack5 资源模块：替代 url-loader / file-loader
      test: /\.(png|jpe?g|svg|gif)$/,
      type: 'asset',
      parser: { dataUrlCondition: { maxSize: 8 * 1024 } }
    }
  ]
}
```

规则常用字段：

| 字段 | 说明 |
| --- | --- |
| `test` | 匹配条件（正则/字符串/函数） |
| `include` / `exclude` | 缩小处理范围，务必排除 `node_modules` |
| `use` | loader 数组或对象 |
| `enforce` | `'pre'` / `'post'` 控制与其他插件的相对执行顺序 |
| `type` | 资源模块类型：`asset` / `asset/resource` / `asset/inline` / `json` |

## resolve

模块解析规则：

```js
resolve: {
  extensions: ['.js', '.jsx', '.ts', '.vue'],   // 自动补全后缀
  alias: {
    '@': path.resolve(__dirname, 'src')          // 路径别名
  },
  mainFields: ['browser', 'module', 'main']      // package.json 字段查找顺序
}
```

## plugins

插件在生命周期关键节点介入，实例化后放入数组：

```js
const HtmlWebpackPlugin = require('html-webpack-plugin')
const webpack = require('webpack')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')

plugins: [
  // 生成 HTML 并自动注入 script 标签
  new HtmlWebpackPlugin({ template: 'public/index.html' }),

  // 编译期常量替换
  new webpack.DefinePlugin({
    __APP_VERSION__: JSON.stringify('1.0.0')
  }),

  // 自动注入模块，免去手写 import
  new webpack.ProvidePlugin({ $: 'jquery' }),

  // CSS 抽取为独立文件（生产环境替代 style-loader）
  new MiniCssExtractPlugin({ filename: '[name].[contenthash:8].css' })
]
```

常用插件速查：

| 插件 | 用途 |
| --- | --- |
| `html-webpack-plugin` | 生成/注入 HTML |
| `mini-css-extract-plugin` | CSS 抽离 |
| `copy-webpack-plugin` | 复制静态目录 |
| `terser-webpack-plugin` | JS 压缩（production 已内置） |
| `css-minimizer-webpack-plugin` | CSS 压缩 |
| `webpack-bundle-analyzer` | 产物体积分析 |

## devServer

开发服务器（需安装 `webpack-dev-server`）：

```js
devServer: {
  static: './dist',          // 静态目录
  port: 8080,
  open: true,
  hot: true,                 // 模块热替换
  historyApiFallback: true,  // SPA history 路由回退到 index.html
  proxy: {                   // webpack5 对象式代理
    '/api': {
      target: 'http://localhost:3000',
      changeOrigin: true,
      pathRewrite: { '^/api': '' }
    }
  }
}
```

## optimization

```js
optimization: {
  minimize: true,
  minimizer: [
    new TerserPlugin(),
    new CssMinimizerPlugin()
  ],
  splitChunks: {
    chunks: 'all',
    cacheGroups: {
      vendors: {
        test: /[\\/]node_modules[\\/]/,
        name: 'vendors',
        priority: 10
      }
    }
  },
  runtimeChunk: 'single'   // 抽离运行时代码，利于长效缓存
}
```

## 与 Vite 的对应关系

| Webpack | Vite |
| --- | --- |
| `entry` / `output` | `root` / `build.outDir` |
| `module.rules` loader | `plugins`（插件内部转换） |
| `resolve.alias` | `resolve.alias` |
| `devServer.proxy` | `server.proxy` |
| `optimization.splitChunks` | `build.rollupOptions.output.manualChunks` |
| `DefinePlugin` | `define` |
