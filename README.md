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
git push origin main
```

不要对这份配置运行 `npx wrangler deploy`；`wrangler.jsonc` 和 `worker.js` 用于本地模拟 Pages Functions 运行环境，生产自定义域名由 Pages 托管。启用 Functions 后，Cloudflare 会为 Pages 项目生成 `pages-worker--*-production` / `pages-worker--*-preview` 内部脚本；控制台中看到它们不代表存在第二个同名站点，也不要单独删除。

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

评论完整数据和站点配置保存在 D1，KV 只缓存已审核公开评论；Worker 实例内还有短期内存缓存。读取路径是内存缓存 -> KV -> D1。KV 是最终一致存储，公开评论刷新后全球边缘传播可能需要 60 秒以上，后台配置里的 KV TTL 默认 60 秒。

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

## 管理员后台

访问 `/admin.html` 或 `/admin` 进入后台。后台功能：

- 使用 `ADMIN_PASSWORD` 登录
- 审核、批准、驳回或删除留言
- 管理运行时配置：评论开关、AI 模型、缓存 TTL、Turnstile site key、站点标题 / 副标题 / 公告
- 查看 D1、KV、AI、Turnstile secret、管理员密码的只读健康状态
- 幂等迁移旧 KV `comments:index` 到 D1

登录态使用 HttpOnly Cookie 保存 24 小时，Cookie 签名由 `ADMIN_PASSWORD` 派生。没有配置 `ADMIN_PASSWORD` 时，后台登录会返回 `ADMIN_PASSWORD is not configured`。

## 字体

站点已内置自托管字体文件，放在 `assets/fonts/`：

- `SFSY Inter`：来自开源字体 Inter，用作 Claude 风格无衬线近似字体
- `SFSY Source Serif 4`：来自开源字体 Source Serif 4，用作 Claude 风格衬线近似字体

CSS 会优先使用这些本地 woff2 文件，然后回退到 `Styrene B` / `Tiempos Text`、系统字体和中文字体。中文正文仍主要使用系统中文字体回退，避免打包大型中文字体文件。

注意：仓库没有打包 Claude.ai 使用的商业字体原文件。若你拥有合法授权的 `Styrene B` / `Tiempos Text` 字体文件，可以再替换 `assets/fonts/` 中的文件和 `@font-face` 配置。

当前仓库已经绑定的 Workers KV namespace id：

```text
316829b9926e4f09b5faff727b875af7
```

## 更新旅行与城市内容

### 日本 2026 旅记

日本专题的三语文案、四个章节与十五天海报清单统一维护在 `assets/js/data.js` 的 `japanPlan`。每张源图保存在 `assets/images/japan-2026/`，并遵守以下约定：

- 使用 `01-*.png` 至 `15-*.png` 的顺序文件名，源图尺寸为 1440×1800（4:5）。
- `place`、`label`、`summary` 和 `alt` 必须同时提供中文、日文和英文；海报画面内的短标签只属于装饰性排版，不代替页面文本。
- 图片 URL 使用长期不可变缓存；替换画面时应使用新文件名并同步更新 `image`，不要以新内容覆盖已发布的同名资产。

`npm run build` 会为日本海报生成 480、960 和 1440 宽的 WebP，生成中、日、英三语专题页，然后完整重建 `public/`。

### 普通城市

城市数据同样位于 `assets/js/data.js`。新增或修改城市后，不要手工编辑 `cities/*.html` 或 `public/`；运行完整构建与检查：

```powershell
npm run build
npm run check
```
