# 朔风霜月 NFC 名片站

多文件静态站，支持 Cloudflare Pages / Workers 部署。页面包含 NFC 名片、三语切换、QQ 头像同步、旅行城市页、首页留言区和管理员后台。

## 本地预览

静态页面预览：

```powershell
cd D:\pc\shuangyue-about
npm run build:worker
npx serve public
```

带评论 API 的 Worker 预览：

```powershell
cd D:\pc\shuangyue-about
npx wrangler dev
```

静态预览只能看页面，评论提交需要 Worker 环境和存储绑定。

本地预览管理员后台时，需要给 Wrangler 设置临时变量：

```powershell
$env:ADMIN_PASSWORD="你的管理员密码"
npx wrangler dev
```

## 部署

Workers 部署：

```powershell
npm run deploy
```

当前 Worker 使用 `public/` 作为静态资源目录，并通过 `worker.js` 兼容这些路径：

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

Cloudflare Pages 也可以部署，构建设置为：

- Build command: `npm run build:worker`
- Build output directory: `public`
- Root directory: 仓库根目录

Pages 部署会使用 `functions/api/` 下的 Pages Functions 复用 `worker.js` 里的 API 逻辑。如果要在 `*.pages.dev` 或绑定到 Pages 的自定义域名上启用留言写入和后台设置，需要在 Cloudflare Pages 项目的 Settings -> Functions 中添加：

- D1 binding: `COMMENTS_DB`
- KV namespace binding: `COMMENTS_KV`
- AI binding: `AI`
- Secret / Environment variable: `ADMIN_PASSWORD`
- Secret / Environment variable: `TURNSTILE_SECRET_KEY`

Workers 部署时，管理员密码通过 Worker secret 设置：

```powershell
npx wrangler secret put ADMIN_PASSWORD
```

如果自定义域名被 `wrangler.jsonc` 的 Worker route 接管，例如当前配置里的 `about.shuangyue.space/*`，后台读取的是 Worker 项目的 secret，而不是 Pages 项目的变量。Pages 自定义域名则读取 Pages 项目的 Functions 变量。两边都要可用时，请在 Workers 和 Pages 两个项目里都配置同名 `ADMIN_PASSWORD`，配置后重新部署对应项目。

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

## 更新城市

城市数据在 `assets/js/data.js`。新增或修改城市后运行：

```powershell
npm run build:pages
```

脚本会重新生成 `cities/*.html` 入口文件。发布前建议运行：

```powershell
node --check assets/js/app.js
node --check assets/js/admin.js
node --check assets/js/data.js
node --check worker.js
npm run build:worker
```
