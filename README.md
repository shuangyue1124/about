# 朔风霜月 NFC 名片站

多文件静态站，支持 Cloudflare Pages / Workers 部署。页面包含 NFC 名片、三语切换、QQ 头像同步、旅行城市页和首页留言区。

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
- `/api/comments`

Cloudflare Pages 也可以部署，构建设置为：

- Build command: `npm run build:worker`
- Build output directory: `public`
- Root directory: 仓库根目录

Pages 部署会使用 `functions/api/comments.js` 提供 `/api/comments`。如果要在 `*.pages.dev` 域名上启用留言写入，需要在 Cloudflare Pages 项目的 Settings -> Functions -> KV namespace bindings 中添加同名绑定：

- Variable name: `COMMENTS_KV`
- KV namespace: `COMMENTS_KV`

## 留言区存储

留言区只要求用户填写名称和留言内容，不要求邮箱、注册或登录。服务端会自动记录：

- 留言 ID
- 名称
- 留言内容
- 留言时间
- 留言者 IP

注意：当前需求要求公开显示留言者 IP。上线前请确认这符合你的隐私预期。

### Cloudflare KV

创建 KV namespace：

```powershell
npx wrangler kv namespace create COMMENTS_KV
```

把命令输出的 `id` 添加到 `wrangler.jsonc`：

```jsonc
"kv_namespaces": [
  {
    "binding": "COMMENTS_KV",
    "id": "你的 KV namespace id"
  }
],
"vars": {
  "COMMENTS_STORAGE": "kv"
}
```

默认读取和写入 `COMMENTS_KV`。留言列表保存在 `comments:index`，最多保留最近 100 条。

当前仓库已经绑定的 Workers KV namespace id：

```text
316829b9926e4f09b5faff727b875af7
```

### 远程数据库

如果要用远程数据库，配置 Worker 环境变量：

```jsonc
"vars": {
  "COMMENTS_STORAGE": "remote",
  "COMMENTS_DB_URL": "https://example.com/comments"
}
```

如果远程接口需要鉴权，添加 secret：

```powershell
npx wrangler secret put COMMENTS_DB_TOKEN
```

远程接口协议：

- `GET COMMENTS_DB_URL?limit=30`
- 返回 `[{...}]` 或 `{ "comments": [{...}] }`
- `POST COMMENTS_DB_URL`
- 请求体为单条留言 JSON
- 如果配置了 `COMMENTS_DB_TOKEN`，请求头会带 `Authorization: Bearer <token>`

也可以设置双写：

```jsonc
"vars": {
  "COMMENTS_STORAGE": "dual",
  "COMMENTS_DB_URL": "https://example.com/comments"
}
```

`dual` 模式会同时写远程数据库和 KV；读取优先远程数据库，远程不可用时回退 KV。

## 更新城市

城市数据在 `assets/js/data.js`。新增或修改城市后运行：

```powershell
npm run build:pages
```

脚本会重新生成 `cities/*.html` 入口文件。发布前建议运行：

```powershell
node --check assets/js/app.js
node --check assets/js/data.js
node --check worker.js
npm run build:worker
```
