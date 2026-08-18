# 名片与静态资源维护原则

## 静态正文不得依赖运行时接口

姓名、简介、社交链接、VCF 和主导航必须由静态构建直接输出；运行时设置与评论只能增强已有页面，不得在接口失败时清空名片。

**理由**: NFC 访问常发生在移动网络或脚本受限环境，名片核心信息必须先于接口可用。

**示例**: `scripts/build-pages.mjs:112-189`, `scripts/build-pages.mjs:191-236`, `scripts/build-pages.mjs:346-435` 生成完整首页与日本旅记；`assets/js/app.js:1011-1020` 在绑定失败或设置加载失败时保留静态文档。

## 分享与通讯录必须有降级路径

分享操作优先使用 Web Share API，无法使用时复制当前 URL；通讯录始终使用稳定根路径 `/contact.vcf`，旧 VCF 地址只做永久重定向。

**理由**: 桌面浏览器、WebView 与不同移动系统对分享能力支持不一致，稳定 URL 也避免 NFC 或旧书签失效。

**示例**: `assets/js/app.js:719-780`, `scripts/build-pages.mjs:199-213`, `_redirects:1-2`。

## VCF 只保存公开且必要的信息

名片文件使用 UTF-8 vCard，并只写入公开姓名、邮件、主页及公开社交资料；不得加入私人电话号码、后台账号或密钥。

**理由**: `/contact.vcf` 是公开、可缓存的下载资源，内容会直接进入访客通讯录。

**示例**: `contact.vcf:1-11`, `_headers:32-35`。

## 不同视觉类型保持各自的内容边界

首页和普通城市内容图继续使用具象主题或地标的 16:9 水墨风图片，不以抽象线条、文字或水印作为主体。日本旅记是独立的 1440×1800、4:5 纸张 zine 系列，可以保留少量装饰性短标签，但不应把地点、日期或旅行叙事只写进图像。专用社交分享卡片可以包含姓名与站点地址。

**理由**: 普通内容图、旅行海报和分享图承担不同职责；用不同尺寸与文字边界可以保留系列风格，又不让语义被锁在像素中。

**示例**: 首页卡片见 `assets/js/data.js:298-317`；日本海报尺寸检查见 `scripts/verify-image-assets.mjs:127-177`；海报页的独立替代文本与图说见 `assets/js/data.js:768-1024`, `scripts/build-pages.mjs:426-434`；分享卡片排版见 `scripts/optimize-images.mjs:64-93`。

## 首页、城市与旅行海报保持目录边界

首页五张卡片使用 `assets/images/home/` 下的专用图片，不复用地区图；普通城市通过 `cityImages` 指向 `assets/images/cities/`；日本十五日海报只使用 `assets/images/japan-2026/` 下的顺序 PNG。`regionalImages` 仅作普通城市的兜底。

**理由**: 目录与资料映射同时表达用途，可防止宽幅城市图被当作竖版海报，也避免不同专题大范围复用视觉。

**示例**: `assets/js/data.js:298-317`, `assets/js/data.js:768-1024`, `assets/js/data.js:1238-1284`, `scripts/verify-image-assets.mjs:108-120`, `scripts/verify-image-assets.mjs:127-153`。

## 单张城市图最多覆盖三个城市

城市或地标组图片可以覆盖相近城市，但同一张图不得超过三个城市。

**理由**: 这能减少重复，又避免为每个短暂停留城市生成低价值图片。

**示例**: `scripts/verify-image-assets.mjs:101-125` 统计站点图片复用次数并在超过三个时失败。

## 海报画面与页面语义分开维护

每张日本海报都必须在资料层同时维护三语 `place`、`label`、`summary` 和 `alt`。海报画面内的编号或英文短语只是构图元素，不得取代可见图说、日期、替代文本或结构化数据。

**理由**: 将语义从像素中独立出来，才能同时支持三语访问、辅助技术、图片失败回退和搜索结构化数据。

**示例**: `assets/js/data.js:768-1024` 定义十五条三语记录；`scripts/build-pages.mjs:426-434` 输出图片替代文本、图说与 `time`；`scripts/build-pages.mjs:505-531` 输出对应 JSON-LD。

## 只编辑源资源，衍生文件交给构建

头像和原始内容图在源码目录维护；响应式 WebP、hero 变体、Open Graph 卡片和应用图标由 `npm run build` 生成，不手工修改 `public/` 或 `assets/images/generated/` 中的衍生文件。普通 PNG 生成 480/960 WebP，日本 4:5 海报另外生成 1440 WebP；海报 PNG 留在源码目录，Pages 输出只携带 WebP。

**理由**: 构建会重建衍生资源和整个 `public/`，手工改产物会在下一次构建丢失。

**示例**: `scripts/optimize-images.mjs:14-47`, `scripts/optimize-images.mjs:50-104`, `scripts/prepare-worker-assets.mjs:3-43`, `package.json:6-11`。

## 首幅海报优先，图廊图片延迟加载

日本专题的 hero 首图应让预加载与页面图片共用 480/960 WebP 的候选和 `sizes` 规则，并保留 `fetchpriority="high"`。四章图廊中的卡片图片使用 `loading="lazy"`；1440 WebP 用于点击后的完整海报和分享元数据，不作为列表默认下载尺寸。

**理由**: 首屏只有一张关键视觉，而一次请求十五张高清海报会增加移动网络的首次访问成本。

**示例**: `scripts/build-pages.mjs:108-116`, `scripts/build-pages.mjs:355-371`, `scripts/build-pages.mjs:393-434` 分别设置响应式首图预加载/高优先级、图廊懒加载和 1440 链接。

## 已发布图片不做同名覆盖

Pages 输出中 `/assets/images/*` 下的普通内容图与 WebP 衍生图使用长期 `immutable` 缓存。替换日本海报或其他已发布图片时，必须使用新文件名并同步修改资料映射；不使用同一 URL 覆盖新内容。日本 PNG 源图不属于线上 URL。

**理由**: CSS/JS 的查询参数版本和 Service Worker 缓存名不会改变图片自身的 URL；同名替换会让已缓存访客继续看到旧图。

**示例**: `_headers:25-26` 声明一年不可变缓存；`assets/js/data.js:768-1024` 为十五张海报声明独立文件名；`scripts/optimize-images.mjs:29-47` 以源图相对名生成对应 WebP URL。

## 改首屏资源时同步更新版本与缓存

替换头像、hero、分享图、CSS 或客户端脚本时，同步更新静态资源版本和 Service Worker 缓存名，并运行完整检查。

**理由**: 页面查询参数与 Service Worker 缓存是两个独立的更新边界，只改其中一个可能继续命中旧资源。

**示例**: `scripts/build-pages.mjs:8`, `scripts/build-pages.mjs:95-96`, `sw.js:1-15`, `scripts/verify-image-assets.mjs:204-210`。

## 生产发布只走 Pages Git 集成

发布前运行 `npm run build` 与 `npm run check`，推送 `main` 后等待 Pages 自动部署；不要对当前 `wrangler.jsonc` 执行 `npx wrangler deploy`。生产完成后运行：

```powershell
node scripts/verify-image-assets.mjs --origin https://about.shuangyue.space
```

**理由**: 仓库把 `public/` 定义为 Pages 输出，而 Wrangler 配置只模拟本地 Functions；另行部署 Worker 会制造第二个入口和两套环境变量边界。

**示例**: `README.md:31-78`, `wrangler.jsonc:1-5`, `wrangler.jsonc:29-33`, `scripts/verify-image-assets.mjs:228-269`。

## 预览域名不得参与索引

正式页面用自定义域名作为 canonical；Pages 默认域名与版本预览域名必须发送 `X-Robots-Tag: noindex`。

**理由**: 多个可抓取域名承载相同静态内容会分散搜索信号。

**示例**: `scripts/build-pages.mjs:100-123`, `_headers:60-64`。

## 不在文档或配置中保存密钥

Cloudflare Pages Functions 的管理员密码与 Turnstile 私钥必须配置为 Pages 环境变量或 Secret；只有另建独立 Worker 时才使用 Worker secret，真实值不得写入仓库。

**理由**: 公开仓库和构建产物都不是密钥存储边界。

**示例**: `README.md:64-80`, `worker.js:58`, `worker.js:751`, `worker.js:949-975`。
