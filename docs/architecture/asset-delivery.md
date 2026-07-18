# 静态站与资源交付架构

## 静态 HTML 是可用性基线

构建阶段直接生成三种语言的完整页面正文、导航和 NFC 名片操作，并把静态内容写入 `#app`。客户端脚本只绑定交互和应用运行时设置；浏览器 API 或设置接口失败时保留原有文档，不用空壳等待接口返回。证据: `scripts/build-pages.mjs:73-123`, `scripts/build-pages.mjs:159-204`, `assets/js/app.js:998-1007`。

## 元数据与正文同源生成

每个语言版本在同一次静态构建中生成 canonical、hreflang、Open Graph、Twitter Card 与 JSON-LD。首页使用 `profile` 类型和 1200×630 名片图，Person 结构化数据复用资料层的头像、邮件与社交链接，避免爬虫结果依赖客户端执行。证据: `scripts/build-pages.mjs:73-118`, `scripts/build-pages.mjs:194-204`, `scripts/build-pages.mjs:328-343`。

## 源码资源与 Pages 输出分离

源码页面与资源保存在仓库目录，`npm run build` 依次生成图片衍生资源、静态页面并重建 `public/`。`public/` 是 Cloudflare Pages 的构建输出目录；只修改源文件而不重新构建时，待发布目录不会同步。证据: `package.json:7-11`, `scripts/prepare-worker-assets.mjs:3-27`, `README.md:58-62`, `wrangler.jsonc:29-33`。

## 图片衍生资源由构建统一生成

原始 PNG 会产生 480/960 宽度的 WebP；首页 hero 另有 1600 宽度版本。构建还从本地头像与 hero 生成 1200×630 分享卡片，以及 32/192/512 像素站点图标。页面根据视口预加载 hero 变体，城市视觉用 `srcset` 选择响应式图片。证据: `scripts/optimize-images.mjs:14-94`, `scripts/build-pages.mjs:97-100`, `scripts/build-pages.mjs:310-315`。

## 首页与城市图片由资料层声明

首页卡片通过 `homeCards.image` 声明图片；城市详情先读取 `cityImages[stop.slug]`，找不到才回退到地区图。这个边界让内容映射保持在资料层，页面构建和客户端增强共用同一来源。证据: `assets/js/data.js:219-303`, `assets/js/data.js:892-972`, `scripts/build-pages.mjs:207-218`。

## VCF 使用稳定公共入口

首页的两个保存入口都指向根路径 `/contact.vcf`。构建把该文件复制到 Pages 输出目录，Pages 响应头声明 UTF-8 `text/vcard` 与下载文件名；旧地址永久重定向到稳定入口。证据: `scripts/build-pages.mjs:172-186`, `scripts/prepare-worker-assets.mjs:9-26`, `_headers:28-35`, `_redirects:1-2`。

## Service Worker 按资源类型分层缓存

首页、旅行入口、样式、脚本、头像、分享图和 VCF 构成核心预缓存。页面导航采用网络优先并回退缓存，静态资源采用 stale-while-revalidate；API 与管理员路径不进入这套公开静态缓存。证据: `sw.js:1-13`, `sw.js:27-77`。

## 生产 Pages 与本地 Worker 各自负责单一边界

仓库的生产发布约定是：推送 `main` 后由 Cloudflare Pages Git 集成构建 `public/`，Pages Functions 承载 `/api/`。`wrangler.jsonc` 和 `worker.js` 仅用于本地模拟 Functions 与资源绑定，不应以 `wrangler deploy` 创建第二个独立生产入口。Cloudflare 为 Pages Functions 生成的 `pages-worker--*-production` / `preview` 脚本属于同一个 Pages 项目的内部产物。证据: `README.md:31-78`, `wrangler.jsonc:1-5`, `wrangler.jsonc:29-33`。

## 版本号与线上探测共同防止旧资源残留

静态页面通过 query string 引用带版本号的 CSS/JS，Service Worker 缓存名随版本更新。发布前的检查验证源码与 `public/` 一致、分享图尺寸和 VCF 内容；传入 `--origin` 后还会探测生产首页的版本号及头像、分享图和 VCF 的内容类型。证据: `scripts/build-pages.mjs:8`, `scripts/build-pages.mjs:73-76`, `sw.js:1-12`, `scripts/verify-image-assets.mjs:120-158`。
