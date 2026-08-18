# 静态站与资源交付架构

## 静态 HTML 是可用性基线

构建阶段直接生成三种语言的完整页面正文、导航和 NFC 名片操作，并把静态内容写入 `#app`。日本旅记的四个章节和十五张海报也在这个阶段完整输出。客户端脚本只绑定交互和运行时增强；浏览器 API 或设置接口失败时保留原有文档。证据: `scripts/build-pages.mjs:112-189`, `scripts/build-pages.mjs:191-236`, `scripts/build-pages.mjs:346-435`, `assets/js/app.js:1011-1020`。

## 元数据与正文同源生成

每个语言版本在同一次静态构建中生成 canonical、hreflang、Open Graph、Twitter Card 与 JSON-LD。首页使用 1200×630 名片图；日本旅记使用首张海报的 1440 宽 WebP 作为分享图，并把十五天映射为带图片、说明和日期的 `ItemList`。证据: `scripts/build-pages.mjs:112-151`, `scripts/build-pages.mjs:226-235`, `scripts/build-pages.mjs:393-414`, `scripts/build-pages.mjs:505-531`。

## 日本旅记是资料驱动的专题页

`japanPlan` 定义 2026-06-30 至 2026-07-14 的已完成旅程、四个章节与十五条海报记录；章节与海报的标题、地点、摘要和替代文本都由资料层提供中、日、英三语。页面生成器为 `japan-2026` 选择专用模板，再与普通页面一起写入三个语言路径。证据: `assets/js/data.js:702-1025`, `scripts/build-pages.mjs:319-320`, `scripts/build-pages.mjs:346-435`, `scripts/build-pages.mjs:540-546`。

## 海报视觉文字不承担唯一语义

海报图像内的短标签属于视觉编辑层，页面语义来自独立的三语 `place`、`label`、`summary` 和 `alt` 字段。生成结果使用有替代文本的图片、`figure`/`figcaption`、机器可读的 `time` 和 JSON-LD 重述同一条旅行记录，不依赖对海报像素做文字识别。证据: `assets/js/data.js:768-1024`, `scripts/build-pages.mjs:426-434`, `scripts/build-pages.mjs:505-531`。

## 源码资源与 Pages 输出分离

源码页面与资源保存在仓库目录，`npm run build` 依次生成图片衍生资源、三语静态页面，然后删除并重建 `public/`。日本 4:5 PNG 与首页 hero PNG 只作为构建源图保留，复制资源时从 Pages 输出中排除；已退出页面映射的旧日本视觉也不发布。专题页和首页只引用体积更小的 WebP。`public/` 是 Cloudflare Pages 的构建输出目录，任何源图、文案或样式变化都必须经过完整构建。证据: `package.json:6-11`, `scripts/prepare-worker-assets.mjs:3-48`, `scripts/build-pages.mjs:355-434`, `wrangler.jsonc:29-33`。

## 图片衍生资源由构建统一生成

所有内容 PNG 会产生 480/960 宽度的 WebP；`assets/images/japan-2026/` 下的 1440×1800、4:5 海报额外产生 1440 宽 WebP，并在检查中验证三个尺寸都保持 4:5。日本专题的 hero 首图通过同一组 `imagesrcset` / `srcset` 候选预加载并使用高优先级；图廊卡片使用 `loading="lazy"`，图片回退与点击大图也都使用 WebP，不要求线上保留 PNG。证据: `scripts/optimize-images.mjs:14-47`, `scripts/build-pages.mjs:108-116`, `scripts/build-pages.mjs:355-371`, `scripts/build-pages.mjs:393-434`, `scripts/verify-image-assets.mjs:138-193`。

## 首页与城市图片由资料层声明

首页卡片通过 `homeCards.image` 声明图片；普通城市由 `cityImages` 映射专用城市图；日本专题的每一天则直接在 `japanPlan.posters` 中声明独立图片路径。这个边界让文案、顺序、语言和图片映射保持在资料层。证据: `assets/js/data.js:298-317`, `assets/js/data.js:768-1024`, `assets/js/data.js:1238-1284`, `scripts/build-pages.mjs:239-254`, `scripts/build-pages.mjs:426-434`。

## VCF 使用稳定公共入口

首页的两个保存入口都指向根路径 `/contact.vcf`。构建把该文件复制到 Pages 输出目录，Pages 响应头声明 UTF-8 `text/vcard` 与下载文件名；旧地址永久重定向到稳定入口。证据: `scripts/build-pages.mjs:199-213`, `scripts/prepare-worker-assets.mjs:9-28`, `_headers:28-35`, `_redirects:1-2`。

## Service Worker 按资源类型分层缓存

首页、旅行入口、日本专题入口与首幅海报、样式、脚本、头像、分享图和 VCF 构成核心预缓存。页面导航采用网络优先并回退缓存，静态资源采用 stale-while-revalidate；API 与管理员路径不进入这套公开静态缓存。证据: `sw.js:1-15`, `sw.js:29-78`。

## 生产 Pages 与本地 Worker 各自负责单一边界

仓库的生产发布约定是：推送 `main` 后由 Cloudflare Pages Git 集成执行构建并发布 `public/`，Pages Functions 承载 `/api/`。`wrangler.jsonc` 和 `worker.js` 仅用于本地模拟 Functions 与资源绑定，不应以 `wrangler deploy` 创建第二个独立生产入口。证据: `README.md:31-78`, `package.json:6-11`, `wrangler.jsonc:1-5`, `wrangler.jsonc:29-33`。

## 版本号、不可变图片与线上探测分属不同边界

静态页面通过 query string 引用带版本号的 CSS/JS，Service Worker 缓存名随版本更新。图片响应头则对 `/assets/images/*` 声明一年 `immutable`；因此已发布图片不能通过同名覆盖来可靠更新，新画面必须使用新文件名并在资料层切换 URL。发布前检查还会验证十五张源图、三种 WebP 衍生尺寸、三语页面与 `public/` 产物；传入 `--origin` 后再探测线上三语旅记、版本和核心资源。证据: `scripts/build-pages.mjs:8`, `scripts/build-pages.mjs:95-96`, `sw.js:1-15`, `_headers:25-26`, `scripts/verify-image-assets.mjs:127-196`, `scripts/verify-image-assets.mjs:228-282`。
