# 文件压缩的方案

## 为什么需要

面经原文给了两个点："compressjs 压缩图片" 和 "nginx+gzip 压缩打包后的文件，提高首屏加载速度"——这恰好覆盖压缩的**两个战场**：① 用户**上传**文件时在浏览器端先压（省用户流量、省服务端存储与转码）；② 网站**下发**静态资源时压缩传输（省带宽、提首屏）。面试答这题要能分清"压谁的、在哪压、什么时候压"，混为一谈是常见失分点。

## 核心要点

### 1. 全景图：三个压缩位置

```
                    ① 上传侧（浏览器压缩）
  用户手机相册 10MB ──► canvas 压到 300KB ──► 服务端存储
                              │
  服务端 ──► ② 构建侧：minify/打包产物
                     │
  ③ 传输侧：nginx gzip/brotli 压缩响应
  浏览器 ◄── Content-Encoding: gzip ── CDN
```

| 位置 | 对象 | 手段 | 收益 |
| --- | --- | --- | --- |
| 上传侧 | 用户照片/视频/多文件 | canvas 重绘、browser-compress、JSZip | 省用户流量、秒传体验、降服务端转码压力 |
| 构建侧 | JS/CSS/HTML 产物 | Terser/esbuild 去空白混淆、cssnano、tree-shaking | 减小体积基数 |
| 传输侧 | HTTP 响应体 | gzip / brotli（Content-Encoding） | 文本再减 60~80%，首屏提速 |

### 2. 上传侧：图片压缩（面经的 compressjs 语境）

**原理**：解码 → 缩小尺寸 → 按质量重编码（有损）。核心是 canvas：

```js
// 可运行：读取用户选择的图片，等比缩到最大边 1280，输出 JPEG 质量 0.7
function compressImage(file, maxSide = 1280, quality = 0.7) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = img.width * scale
      canvas.height = img.height * scale
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height) // 重绘即缩放
      canvas.toBlob(
        (blob) => resolve(blob),   // 压缩后的 Blob，可直接 FormData 上传
        'image/jpeg',
        quality
      )
      URL.revokeObjectURL(url)
    }
    img.src = url
  })
}
```

- **现成库**：`browser-image-compression`（面经说的 compressjs 一类）、`compress.js`——封装了 canvas 方案 + 保留 EXIF 取舍 + Worker 支持。
- **大图不卡页面**：用 **Web Worker + OffscreenCanvas**，压缩在后台线程做，主线程只收结果。
- **多文件打包上传**：**JSZip** 把多个文件压成 zip 再传（减少请求数、整体压缩率更高）：

```js
import JSZip from 'jszip'
const zip = new JSZip()
files.forEach((f) => zip.file(f.name, f))     // 逐个塞进压缩包
const blob = await zip.generateAsync({
  type: 'blob',
  compression: 'DEFLATE',                    // zip 内用 deflate 算法
  compressionOptions: { level: 6 },          // 压缩级别 1~9
})
```

- 注意：canvas 方案**对 PNG 截图/含透明通道**要谨慎（转 JPEG 丢透明）；HEIC 需先解码；视频压缩走 `MediaRecorder`/ffmpeg.wasm，成本高。

### 3. 传输侧：gzip / brotli（面经的 nginx 语境）

```nginx
# nginx 传输压缩核心配置
gzip on;
gzip_min_length 1k;              # 小于 1k 不值得压
gzip_comp_level 5;               # 1~9，5 是性价比点
gzip_types text/css application/javascript application/json image/svg+xml;
gzip_vary on;                    # 加 Vary: Accept-Encoding，防 CDN 缓存错

# 更优：构建期预压缩 + 直接吐静态文件（省运行时 CPU）
brotli on;                       # 需 ngx_brotli 模块
brotli_comp_level 6;
gzip_static on;                  # 命中 vite/webpack 预生成的 .gz/.br 文件
```

- **gzip**：老牌通用，文本压缩率约 60~70%；**brotli**：Chrome 93%+ 流量支持，同等 CPU 下再优 15~20%，现代首选。
- **只对文本有效**：jpg/png/woff2/zip 本身已压缩，再 gzip 无收益甚至变大（所以 `gzip_types` 不含它们）。
- **构建期预压缩**：`vite-plugin-compression` / `compression-webpack-plugin` 生成 `.gz/.br`，配 `gzip_static` 命中即返回，运行时零开销。
- **协商**：请求头 `Accept-Encoding: br, gzip` ↔ 响应头 `Content-Encoding: br`。

### 4. 易错点对比表

| 误区 | 事实 |
| --- | --- |
| "gzip 能压图片" | 不能，jpg/png/woff2 已是压缩格式 |
| "压缩级别越高越好" | 9 级 CPU 翻倍、体积只小几个点，5~6 是甜点 |
| "上传压缩=传输压缩" | 一个在浏览器压用户文件，一个在服务端压响应体，对象不同 |
| "开了 gzip 就不用 minify" | 先 minify 去掉冗余再 gzip，收益叠加 |

## 面试答法

### 30 秒版本（可直接背诵）

> 文件压缩分三个位置：上传侧、构建侧、传输侧。上传侧是用户发图片时用 canvas 把大图重绘缩放、toBlob 按质量参数重编码（或用 browser-image-compression 这类库），大图放 Web Worker + OffscreenCanvas 避免卡主线程，多文件可以用 JSZip 打包成 zip 再传；构建侧用 Terser/esbuild 做 JS 压缩、cssnano 压 CSS，减小体积基数；传输侧 nginx 开 gzip 或 brotli 对文本响应压缩，Content-Encoding 协商，更优做法是构建期预压缩生成 .gz/.br 文件配 gzip_static 直接返回。要点是 gzip 只压文本，图片视频本身已压缩，要压的是格式转换（webp/avif）而不是 gzip。

### 深入展开

1. **先给全景图**：按"压谁的、在哪压"分上传/构建/传输三层，体现结构感。
2. **上传侧手写 canvas 压缩**：drawImage 缩放 + toBlob 质量参数，顺带 Worker 化。
3. **JSZip 场景**：批量附件打包，减少请求数。
4. **传输侧讲 nginx 配置**：gzip_types/min_length/level、Vary、brotli 与 gzip_static 预压缩。
5. **收尾对比**：minify 与 gzip 叠加、图片走 webp/avif 而非 gzip。

### 常见追问

- **gzip 和 brotli 怎么选？** → brotli 压缩率更高、适合文本，但 CPU 略贵；用构建期预压缩化解 CPU 问题；兼容兜底同时开启两者，Accept-Encoding 协商。
- **为什么 gzip_static 比动态 gzip 好？** → 响应时不再实时压缩，省服务端 CPU、TTFB 更低；代价是构建产物多一份 .gz/.br。
- **canvas 压缩会丢 EXIF 吗？有什么影响？** → 会丢（含拍摄时间/GPS）；社交场景常是优点（隐私），需要保留则用库配置或后端处理。
- **上传大视频怎么办？** → 浏览器端压缩成本高，一般分片上传（multipart）+ 服务端转码；前端可做分辨率裁剪的 MediaRecorder 方案。
- **CDN 下 gzip 要注意什么？** → 必须 `Vary: Accept-Encoding`，否则不同编码的响应会被 CDN 错误缓存互串。
- **怎么验证压缩生效？** → DevTools Network 看 Content-Encoding 响应头与 transferred/resources 两列体积差。
