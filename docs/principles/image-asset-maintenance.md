# 名片与静态资源维护原则

## 静态正文不得依赖运行时接口

姓名、简介、社交链接、VCF 和主导航必须由静态构建直接输出；运行时设置与评论只能增强已有页面，不得在接口失败时清空名片。

**理由**: NFC 访问常发生在移动网络或脚本受限环境，名片核心信息必须先于接口可用。

**示例**: `scripts/build-pages.mjs:120-123`, `scripts/build-pages.mjs:159-204` 生成完整首页；`assets/js/app.js:998-1007` 在绑定失败或设置加载失败时保留静态文档。

## 分享与通讯录必须有降级路径

分享操作优先使用 Web Share API，无法使用时复制当前 URL；通讯录始终使用稳定根路径 `/contact.vcf`，旧 VCF 地址只做永久重定向。

**理由**: 桌面浏览器、WebView 与不同移动系统对分享能力支持不一致，稳定 URL 也避免 NFC 或旧书签失效。

**示例**: `assets/js/app.js:717-775`, `scripts/build-pages.mjs:172-186`, `_redirects:1-2`。

## VCF 只保存公开且必要的信息

名片文件使用 UTF-8 vCard，并只写入公开姓名、邮件、主页及公开社交资料；不得加入私人电话号码、后台账号或密钥。

**理由**: `/contact.vcf` 是公开、可缓存的下载资源，内容会直接进入访客通讯录。

**示例**: `contact.vcf:1-11`, `_headers:32-35`。

## 新图必须具象、高清、无文字

首页和城市内容图应表现具体主题、城市或地标组，不使用抽象线条作为主体；生成或替换图片时保持“16:9 高清水墨风、具象地标或主题、无文字、无水印、非抽象线条”。专用的社交分享卡片可以包含姓名与站点地址。

**理由**: 内容图片直接出现在卡片和城市视觉中，而分享图承担链接识别职责，两者用途不同。

**示例**: 内容图映射见 `assets/js/data.js:219-303`, `assets/js/data.js:892-972`；分享卡片的固定排版见 `scripts/optimize-images.mjs:55-84`。

## 首页图与城市图保持目录边界

首页五张卡片使用 `assets/images/home/` 下的专用图片，不复用地区图；已存在城市通过 `cityImages` 指向 `assets/images/cities/`，`regionalImages` 只用于未知城市兜底。

**理由**: 目录和资料映射共同避免首页、城市页大范围视觉重复。

**示例**: `assets/js/data.js:219-303`, `assets/js/data.js:892-972`。

## 单张城市图最多覆盖三个城市

城市或地标组图片可以覆盖相近城市，但同一张图不得超过三个城市。

**理由**: 这能减少重复，又避免为每个短暂停留城市生成低价值图片。

**示例**: `scripts/verify-image-assets.mjs:92-112` 统计城市图片复用次数并在超过三个时失败。

## 只编辑源资源，衍生文件交给构建

头像和原始内容图在源码目录维护；响应式 WebP、hero 变体、Open Graph 卡片和应用图标由 `npm run build` 生成，不手工修改 `public/` 或 `assets/images/generated/` 中的衍生文件。

**理由**: 构建会重建衍生资源和整个 `public/`，手工改产物会在下一次构建丢失。

**示例**: `scripts/optimize-images.mjs:14-94`, `scripts/prepare-worker-assets.mjs:3-27`, `package.json:7-10`。

## 改首屏资源时同步更新版本与缓存

替换头像、hero、分享图、CSS 或客户端脚本时，同步更新静态资源版本和 Service Worker 缓存名，并运行完整检查。

**理由**: 页面查询参数与 Service Worker 缓存是两个独立的更新边界，只改其中一个可能继续命中旧资源。

**示例**: `scripts/build-pages.mjs:8`, `sw.js:1-12`, `scripts/verify-image-assets.mjs:120-158`。

## 生产发布只走 Pages Git 集成

发布前运行 `npm run build` 与 `npm run check`，推送 `main` 后等待 Pages 自动部署；不要对当前 `wrangler.jsonc` 执行 `npx wrangler deploy`。生产完成后运行：

```powershell
node scripts/verify-image-assets.mjs --origin https://about.shuangyue.space
```

**理由**: 仓库把 `public/` 定义为 Pages 输出，而 Wrangler 配置只模拟本地 Functions；另行部署 Worker 会制造第二个入口和两套环境变量边界。

**示例**: `README.md:31-78`, `wrangler.jsonc:1-5`, `wrangler.jsonc:29-33`, `scripts/verify-image-assets.mjs:140-158`。

## 预览域名不得参与索引

正式页面用自定义域名作为 canonical；Pages 默认域名与版本预览域名必须发送 `X-Robots-Tag: noindex`。

**理由**: 多个可抓取域名承载相同静态内容会分散搜索信号。

**示例**: `scripts/build-pages.mjs:80-95`, `_headers:52-56`。

## 不在文档或配置中保存密钥

Cloudflare Pages Functions 的管理员密码与 Turnstile 私钥必须配置为 Pages 环境变量或 Secret；只有另建独立 Worker 时才使用 Worker secret，真实值不得写入仓库。

**理由**: 公开仓库和构建产物都不是密钥存储边界。

**示例**: `README.md:64-80`, `worker.js:58-59`, `worker.js:948-975`。
