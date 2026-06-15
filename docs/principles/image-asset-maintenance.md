# 图片资源维护原则

## 新图必须具象、高清、无文字

首页和城市图片应表现具体主题、城市或地标组，不使用抽象线条作为主体。生成或替换图片时，提示词必须包含“16:9 高清水墨风、具象地标或主题、无文字、无水印、非抽象线条”。理由: 当前首页和城市渲染都直接展示图片，抽象线条会成为用户第一眼内容。示例: 首页图片路径位于 `assets/js/data.js:187-267`，城市图片路径位于 `assets/js/data.js:875-920`。

## 首页图片只放在 `assets/images/home/`

首页五张卡片必须使用 `assets/images/home/` 下的专用图片，不复用 `region-*.png`。理由: `homeCards.image` 是首页卡片唯一图片来源，复用地区图会让首页和城市页视觉重复。示例: `assets/js/data.js:183-267`。

## 城市图片只放在 `assets/images/cities/`

已存在城市必须通过 `cityImages` 指向 `assets/images/cities/`。`regionalImages` 只保留给未来未知城市兜底，不作为主要城市页资源。理由: `enrichStop` 的顺序是城市专用图优先、地区图兜底。示例: `assets/js/data.js:856-936`。

## 单张城市图最多覆盖三个城市

城市或地标组图片可以覆盖相近城市，但同一张图不得超过三个城市。理由: 这能减少重复，又避免为每个短暂停留城市生成低价值图片。示例: `scripts/verify-image-assets.mjs` 会统计城市图片复用次数并在超过三个时失败。

## 换图后必须同步构建产物

改 `assets/images/` 或 `assets/js/data.js` 后必须运行 `npm run build:worker`，让 `public/` 跟源码一致。理由: Worker 发布的是 `public/`，不是直接读取源码目录。示例: `scripts/prepare-worker-assets.mjs:3-18`, `package.json:7-10`。

## 发布后必须检查线上版本

提交和推送不能证明自定义域名已经更新。发布后必须运行:

```powershell
node scripts/verify-image-assets.mjs --origin https://about.shuangyue.space
```

理由: 自定义域名由 Worker route 接管，未部署 Worker 时线上仍可能停在旧资源版本。示例: `wrangler.jsonc:8-15`, `scripts/verify-image-assets.mjs`。

## 不在文档中保存密钥

Wrangler 部署或 Cloudflare Dashboard 可能显示远端变量差异，文档和提交中不得写入真实密钥值。需要恢复管理员密码时，使用 `npx wrangler secret put ADMIN_PASSWORD` 或 Cloudflare Dashboard Secret，不把值写入 `wrangler.jsonc`。理由: `worker.js` 支持从 Worker 环境和 Secrets Store 读取管理员密码，仓库只应保存绑定名，不保存密钥值。示例: `worker.js:52`, `worker.js:411-419`, `README.md:65-73`。
