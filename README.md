# 朔风霜月 NFC 名片站

多文件静态站，生产环境部署在 Cloudflare Pages。页面包含 NFC 名片、三语切换、本地头像、旅行城市页、首页留言区和管理员后台；`worker.js` 仅用于本地模拟 Pages Functions。

## 本地预览

静态页面预览：

```powershell
cd D:\project\shuangyue-about
npm run build
npx serve public
```

带评论 API 的 Worker 预览：

```powershell
cd D:\project\shuangyue-about
npx wrangler dev
```

静态预览只能看页面，评论提交需要 Worker 环境和存储绑定。

本地预览管理员后台时，需要给 Wrangler 设置临时变量：

```powershell
$env:ADMIN_PASSWORD="你的管理员密码"
npx wrangler dev
```

## 部署

生产站使用 Cloudflare Pages 的 GitHub 集成：`main` 分支推送到 `shuangyue1124/about` 后会自动触发生产部署。发布前先运行：

```powershell
npm ci
npm run build
npm run check
npm run test:site
git push origin main
```

- `npm run build`：优化图片、生成三语页面、重建 `public/`。`public/` 与 `assets/images/generated/` 都是构建产物，已在 `.gitignore` 中排除；Pages 部署时会重新运行构建，所以不必入库。
- `npm run check`：JS 语法 + 图片产物验证 + `check:data`（数据完整性）+ `check:i18n`（三语完整性）+ `check:links`（断链）+ `check:seo`（SEO 元素）+ `check:routes`（Pages Functions 路由覆盖）+ `check:schedule`（课表边界）+ `test:profiles`（域名profile隔离）+ `test:site`（HTTP 冒烟与 API 分支）。
- `npm run check:routes`：`worker.js` 里出现的每个 `/api/...` 路径都必须能被 `functions/` 下的文件路由命中，否则该端点在线上就是 404（`wrangler dev` 却正常）。新增 API 时忘了补 `functions/**/*.js`，这个检查会直接失败并列出缺失路径。
- `npm run test:site`：本地 HTTP 服务对 sitemap 全部页面做冒烟（status/title/lang/h1/main/canonical/资源），并用内存 KV/D1 mock 跑 API 冒烟（405/400/401/429 等分支）。`npm run check` 已包含它，需要单独看详细输出时再单独运行。

不要对这份配置运行 `npx wrangler deploy`；`wrangler.jsonc` 和 `worker.js` 用于本地模拟 Pages Functions 运行环境，生产自定义域名由 Pages 托管。这一点有个容易踩的坑：Pages 只按 `functions/` 下的**文件路径**路由，`worker.js` 里的 `export default { fetch }` 路由器在生产**根本不会执行**。因此每个 `/api/...` 端点都必须在 `functions/` 下有对应文件，否则本地 `wrangler dev` 正常、线上却是 404。`functions/api/admin/[[path]].js` 是管理端 API 的统一兜底入口（具体文件仍优先于它），新增 `handleAdmin` 路由时仍建议补对应文件，并让 `npm run check:routes` 验证。启用 Functions 后，Cloudflare 会为 Pages 项目生成 `pages-worker--*-production` / `pages-worker--*-preview` 内部脚本；控制台中看到它们不代表存在第二个同名站点，也不要单独删除。

本地预览 Worker 使用 `public/` 作为静态资源目录，并通过 `worker.js` 兼容这些路径：

- `/`
- `/index.html`
- `/travel/`
- `/travel/index.html`
- `/cities/<slug>`
- `/cities/<slug>.html`
- `/admin`
- `/admin.html`
- `/api/site`
- `/api/comments`
- `/api/admin/*`

Cloudflare Pages 生产项目的构建设置为：

- Build command: `npm run build`
- Build output directory: `public`
- Root directory: 仓库根目录

Pages 部署会使用 `functions/api/` 下的 Pages Functions 复用 `worker.js` 里的 API 逻辑。如果要在 `*.pages.dev` 或绑定到 Pages 的自定义域名上启用留言写入和后台设置，需要在 Cloudflare Pages 项目的 Settings -> Functions 中添加：

- D1 binding: `COMMENTS_DB`
- KV namespace binding: `COMMENTS_KV`
- AI binding: `AI`
- Secret / Environment variable: `ADMIN_PASSWORD`
- Secret / Environment variable: `TURNSTILE_SECRET_KEY`

只有另建独立 Worker 时，管理员密码才通过 Worker secret 设置；当前 Pages 生产站不采用此部署方式：

```powershell
npx wrangler secret put ADMIN_PASSWORD
```

当前仓库推荐只用 Cloudflare Pages 托管自定义域名。不要在 `wrangler.jsonc` 为 `about.shuangyue.space/*` 配置 Worker route；否则后台会读取 Worker 项目的 secret，而不是 Pages 项目的 Functions 变量。Pages 自定义域名会读取 Pages 项目的 Production Functions 变量，修改变量后需要重新部署 Pages 项目。

后台密码读取兼容这些绑定名：`ADMIN_PASSWORD`、`ADMIN_SECRET`、`SFSY_ADMIN_PASSWORD`、`SITE_ADMIN_PASSWORD`。也兼容 Cloudflare Secrets Store 绑定名 `SECRETS`、`SECRET_STORE`、`ADMIN_SECRETS`，其中保存同名密钥即可。

## 留言区存储

留言区只要求用户填写名称和留言内容，不要求邮箱、注册或登录。服务端会自动记录：

- 留言 ID
- 名称
- 留言内容
- 留言时间
- 留言者 IP
- 留言者 IP 归属地

IP 归属地来自 Cloudflare 请求信息，优先显示国家 / 地区 / 城市；常见英文地名会在服务端转为中文显示。如果 Cloudflare 没有提供对应字段，会显示未知归属地。

注意：当前需求要求公开显示留言者 IP 和归属地。上线前请确认这符合你的隐私预期。

### D1 主库 + KV 缓存

评论完整数据和站点配置保存在 D1；KV 只承担公开评论缓存（`comments:approved:v1`）和短期限流计数，不再保存站点配置（旧 KV `site:settings` 仅作为无 D1 环境的迁移回退读取）。Worker 实例内还有短期内存缓存。读取路径是内存缓存 -> KV -> D1。KV 是最终一致存储，公开评论刷新后全球边缘传播可能需要 60 秒以上，后台配置里的 KV TTL 默认 60 秒。

创建 D1 数据库：

```powershell
npx wrangler d1 create about-comments
```

把输出的 `database_id` 填入 `wrangler.jsonc` 的 `d1_databases[0].database_id`，然后初始化 schema：

```powershell
npx wrangler d1 execute about-comments --file migrations/0001_comments_d1.sql
```

创建 KV namespace 作为公开评论缓存和旧数据迁移来源：

```powershell
npx wrangler kv namespace create COMMENTS_KV
```

把命令输出的 `id` 添加到 `wrangler.jsonc`：

```jsonc
"d1_databases": [
  {
    "binding": "COMMENTS_DB",
    "database_name": "about-comments",
    "database_id": "你的 D1 database id"
  }
],
"kv_namespaces": [
  {
    "binding": "COMMENTS_KV",
    "id": "你的 KV namespace id"
  }
],
"ai": {
  "binding": "AI"
},
"vars": {
  "COMMENT_MODERATION_MODEL": "@cf/meta/llama-guard-3-8b",
  "TURNSTILE_SITE_KEY": "你的 Turnstile site key"
}
```

Turnstile secret 必须作为 Cloudflare secret 配置，服务端会调用 siteverify 校验一次性、5 分钟有效的 token：

```powershell
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Workers AI 默认使用 `@cf/meta/llama-guard-3-8b` 审核。AI 判定不安全或模型调用失败时，留言会进入后台待审，管理员批准后才会写入公开评论缓存。

### Telegram 新留言通知（仅管理员接收）

访客不需要 Telegram。新留言成功写入 D1 后，服务端会用 Bot API 给站长发一条通知（`worker.js` 的 `sendTelegramNotification`，`fetch` 直调 `https://api.telegram.org`，不经过浏览器）：

1. 在 Telegram 里找 @BotFather 创建 bot，拿到 bot token。
2. 给 bot 发一句话，然后打开 `https://api.telegram.org/bot<TOKEN>/getMe` 确认可用，再用 `getUpdates` 查到你的 chat ID（不要把 token 发给任何人）。
3. 在 Pages 项目的 Settings -> Functions（或本地 `npx wrangler dev` 的环境）里添加两个 secret：
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
4. 重新部署，发一条测试留言，查看是否收到通知。
5. 也可在后台「测试 Telegram」按钮发送测试消息（需登录，有频率限制）；后台健康检查会显示 Telegram 是否已配置（只显示是否配置，不回显 secret）。

行为说明：

- 通知内容只有名称、页面、语言、留言正文（截断）、中国时间、留言 ID 和审核状态；不含 IP、Cookie、Turnstile token 或请求头。
- 通知是 D1 写入成功后的后台副作用（`ctx.waitUntil`），Telegram 失败不会回滚留言，也不会让访客等待；失败只记服务端日志。
- 每次成功写入只通知一次（复用留言 UUID），不建额外去重表，不写 KV。
- 没有公开的 Telegram 测试接口；唯一的测试入口是需登录的 `POST /api/admin/test-telegram`。

## 管理员后台

访问 `/admin.html` 或 `/admin` 进入后台。后台功能：

- 使用 `ADMIN_PASSWORD` 登录
- 审核、批准、驳回或删除留言
- 管理运行时配置：评论开关、AI 模型、缓存 TTL、Turnstile site key、站点标题 / 副标题 / 公告
- 查看后台依赖的 Cloudflare 绑定与环境变量清单状态（D1、KV、AI、Turnstile、管理员密码、Telegram 等）；缺少某项时逐项提示变量名、期望值与设置位置，只提醒不拦截，不影响页面访问与后台管理
- 幂等迁移旧 KV `comments:index` 到 D1
- 清理 90 天前的 `site_events` 统计事件
- 发送 Telegram 通知测试（需先配置 `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`）

登录态使用 HttpOnly Cookie 保存 24 小时，Cookie 签名由 `ADMIN_PASSWORD` 派生。没有配置 `ADMIN_PASSWORD` 时，后台登录会返回 `ADMIN_PASSWORD is not configured`。

### API 防滥用与数据保留

写入接口的限流按频率分层（KV Free 仅 1,000 写/天，超限会硬失败；D1 写额度约为 KV 的 100 倍）：

- `/api/events`：单 IP 60 次/分钟、240 次/10 分钟，但只用 Worker 内存固定窗口（0 KV 读/写），因为它随每次页面访问触发；`type` 仅接受 `page_view`，`page`/`lang` 为有限枚举，空 UA 或超大 body 会被拒绝。非法 payload 在限流计数之前拒绝，不消耗配额；自动化浏览器（`navigator.webdriver`）在客户端直接跳过上报，不写 D1。
- `/api/comments` POST：单 IP 5 次/分钟、20 次/10 分钟（KV：先读全部窗口，被限流时只读不写，通过才写；超大 body（>8KB）直接 413），在 Turnstile 验证之前先限流。
- `/api/admin/login`：单 IP 5 次失败/5 分钟后返回 429，登录成功后清零（此前无失败记录时跳过 KV 删除，省一次 delete 额度）。
- `/api/admin/ai-chat`：每个管理员会话 30 次/分钟（空消息在限流前直接 400，不消耗 KV）。
- `/api/admin/test-telegram`：每个管理员会话 3 次/分钟。

限流键里的客户端标识是 SHA-256 哈希（KV 只存短 TTL 计数），不以明文存 IP。静态页面不触碰 KV；`/api/events` 正常与超限时均为 0 KV 操作，只有低频 API（评论/登录/AI 对话/Telegram 测试）与公开评论缓存会走 KV。

`site_events` 没有自动无限增长，生产环境有两条清理路径，任选其一即可保留数据：

- 自动抽样清理：每次写入事件后，以 1/40 的概率顺带删除超过保留期（默认 90 天）的旧事件（`worker.js` 的 `maybeCleanupEvents`）。Pages Functions 无法配置定时触发，这是线上唯一真正自动生效的路径；失败只记录日志，不影响访问。
- 手动清理：后台「清理统计事件」按钮调用 `POST /api/admin/cleanup-events`（默认删除 90 天前事件，可传 `days` 7~365）。

`wrangler.jsonc` 另配了每天 00:00 中国时间（即 16:00 UTC，Cron 按 UTC 运行）的 `scheduled()` 自动清理，但它只在 Worker 运行时（`wrangler dev` / `wrangler deploy`）生效——Pages Functions 没有定时触发 wiring，Pages 生产部署会忽略该配置。

### 安全响应头与 CSP

静态页面通过 `_headers` 下发 HSTS（`max-age=31536000`，不含 `includeSubDomains`）与正式生效的 `Content-Security-Policy`（此前是 `Report-Only`），CSP 违规报告同源 POST 到 `/api/csp-report` 并记录到 Workers 日志。策略允许 `self`、data: 图片与 `https://challenges.cloudflare.com`（Turnstile），并限制 `object-src`、`base-uri`、`form-action`、`frame-ancestors`。API 响应在 `worker.js` 内单独附加 `nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy` 与 `Permissions-Policy`；管理员 API 不开放跨域，公共 API 保持 `Access-Control-Allow-Origin: *`。

已知限制：`script-src` / `style-src` 仍带 `'unsafe-inline'`，因为三语页面使用了内联 `style=` 属性、JSON-LD 与主题初始化脚本。要去掉它需要先把这些内联片段改成外部文件或逐页 CSP 哈希，届时按同样方式在 `_headers` 中收紧即可。

## 字体

站点已内置自托管字体文件，放在 `assets/fonts/`：

- `SFSY Inter`：来自开源字体 Inter，用作 Claude 风格无衬线近似字体
- `SFSY Source Serif 4`：来自开源字体 Source Serif 4，用作 Claude 风格衬线近似字体

CSS 会优先使用这些本地 woff2 文件，然后回退到 `Styrene B` / `Tiempos Text`、系统字体和中文字体。中文正文仍主要使用系统中文字体回退，避免打包大型中文字体文件。

注意：仓库没有打包 Claude.ai 使用的商业字体原文件。若你拥有合法授权的 `Styrene B` / `Tiempos Text` 字体文件，可以再替换 `assets/fonts/` 中的文件和 `@font-face` 配置。

当前仓库已经绑定的 Workers KV namespace id（公开评论缓存）：

```text
f7c63320decb47d584bb78fbd6144167
```

## 更新旅行与城市内容

首页「年龄」不再硬编码：在 `assets/js/data.js` 的 `profile.birthDate` 填写 `YYYY-MM-DD` 后，`npm run build` 会自动计算年龄并显示为「N 岁 · 学生 · 呼和浩特」；留空则只显示「学生 · 呼和浩特」。`npm run check:data` 会校验生日格式。

### 日本 2026 旅记

日本专题的三语文案、四个章节与十五天海报清单统一维护在 `assets/js/data.js` 的 `japanPlan`。每张源图保存在 `assets/images/japan-2026/`，并遵守以下约定：

- 使用 `01-*.png` 至 `15-*.png` 的顺序文件名，源图尺寸为 1440×1800（4:5）。
- `place`、`label`、`summary` 和 `alt` 必须同时提供中文、日文和英文；海报画面内的短标签只属于装饰性排版，不代替页面文本。
- 图片 URL 使用长期不可变缓存；替换画面时应使用新文件名并同步更新 `image`，不要以新内容覆盖已发布的同名资产。

`npm run build` 会为日本海报生成 480、960 和 1440 宽的 WebP，生成中、日、英三语专题页，然后完整重建 `public/`。1440×1800 PNG 只作为仓库源图保留，不复制到 Pages 输出；线上页面与分享元数据只发布 WebP。

专题页包含纯 CSS 的路线概览（东京 → 河口湖 → 热海 → 关西）与海报 Gallery：点击任意海报在灯箱中放大，支持键盘 ←/→ 切换、ESC 关闭和触屏滑动。

### 普通城市

城市数据同样位于 `assets/js/data.js`。新增或修改城市后，不要手工编辑 `cities/*.html` 或 `public/`；运行完整构建与检查：

```powershell
npm run build
npm run check
```

## 作息与「现在的状态」

首页有一张小卡片，根据公开课表估算站长现在大概在做什么（例如「现在大概在上数学课」），并显示中国时间。实现要点：

- 课表唯一数据源是 `assets/js/schedule.js`（集中结构：周一至周五分日制模板 + 周五晚间特例 + 周六特殊表 + 周日休息），改课表只改这一个文件；`npm run check:schedule` 会跑 130+ 个边界用例（含 06:50/07:25/18:10/22:30 等临界点、周一升旗/周四午读政治/周五分段晚补与校本课程特例、周六/周日特例与 CST 换算）。
- 时间一律按中国标准时间（UTC+8，全年无夏令时）计算：`schedule.js` 把任意时刻先整体 +8 小时再取星期/时分，访客在哪个时区都不影响结果。
- 纯浏览器计算，每 45 秒刷新一次（页面隐藏时跳过），不请求 API、不写 D1/KV；无 JS 时卡片保持隐藏，页面其余功能不受影响。
- 文案刻意使用「大概」类估计语，不做实时定位，不暴露任何地址与精确位置；中/日/英三语分别在 `schedule.js` 与 `assets/js/data.js`（`nowStatus*` 键）中维护。
- 注意：周一至周四晚辅导按权威课表拆分为 17:30–18:10（第一节）与 18:20–19:00（第二节），中间 18:10–18:20 为课间休息；周五为校本课程 16:10–17:00 / 17:00–17:40 与分段晚补 17:50–18:25（地理）/ 18:25–19:00（生物）；晚餐统一为 19:00–19:40，随后是夜自习一（19:40–21:20）与夜自习二（21:30–22:30），22:30–22:50 为回家路估计；周四午读为政治；周六 06:50 为语文早读、14:20–14:30 为数学午读，19:10 后为自由时间（无夜自习）；周日全天休息。
