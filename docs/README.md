# 项目文档索引

本文档目录只记录可从当前仓库代码验证的事实。新增或修改站点图片、静态资源、部署方式时，优先更新受影响的文档，不做整站重写。

## 文档分类

- `docs/features/visual-content.md`: 用户能看到的首页和城市图片行为。
- `docs/architecture/asset-delivery.md`: 图片从源码目录到 Cloudflare Worker 的交付链路。
- `docs/principles/image-asset-maintenance.md`: 后续换图、加图、发布时必须遵守的维护规则。

## 更新规则

- 改 `assets/js/data.js` 的图片映射时，同步检查功能文档和维护原则。
- 改 `scripts/build-pages.mjs`、`scripts/prepare-worker-assets.mjs`、`wrangler.jsonc` 或 `package.json` 的构建部署链路时，同步检查架构文档。
- 发布前运行 `npm run build:worker` 和 `npm run verify:images`。
- 发布后运行 `node scripts/verify-image-assets.mjs --origin https://about.shuangyue.space`，确认线上已经引用最新资源版本且新图片返回 200。

## 证据地图

- 首页卡片图片来自 `homeCards.image`: `assets/js/data.js:183-267`。
- 首页语录来自 `ui.*.homeMotto` 并由首页渲染输出: `assets/js/data.js:34`, `assets/js/data.js:86`, `assets/js/data.js:139`, `assets/js/app.js:253`。
- 城市图片优先来自 `cityImages`，未命中才回退 `regionalImages`: `assets/js/data.js:856-936`。
- 城市视觉组件使用 `visual.image` 输出 `<img class="city-visual__image">`: `assets/js/app.js:520-531`。
- 构建会生成城市 HTML 并写入资源版本号: `scripts/build-pages.mjs:4-31`。
- Worker 静态资源从 `public/` 发布: `wrangler.jsonc:23-27`。
- `public/` 由 `scripts/prepare-worker-assets.mjs` 从源码目录复制: `scripts/prepare-worker-assets.mjs:3-18`。
- 图片回归检查脚本: `scripts/verify-image-assets.mjs`，命令入口在 `package.json:7-10`。
