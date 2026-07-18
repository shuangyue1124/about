# 项目文档索引

本文档目录只记录可从当前仓库验证的事实。新增或修改名片首屏、图片、静态资源、离线策略或部署方式时，只更新受影响的文档区段，不做整站重写。

## 文档分类

- `docs/features/visual-content.md`: 访客能看到的 NFC 名片、分享、通讯录、静态降级与图片行为。
- `docs/architecture/asset-delivery.md`: 静态页面、图片衍生资源、PWA 文件从源码到 Cloudflare Pages 的交付边界。
- `docs/principles/image-asset-maintenance.md`: 后续换图、调整首屏、维护分享/VCF、构建和发布时必须遵守的规则。

## 更新规则

- 改 `assets/js/data.js`、`assets/js/app.js` 或 `scripts/build-pages.mjs` 的用户可见行为时，同步检查功能文档。
- 改 `scripts/optimize-images.mjs`、`scripts/prepare-worker-assets.mjs`、`sw.js`、`wrangler.jsonc` 或 `package.json` 的构建交付链路时，同步检查架构与维护原则。
- 发布前运行 `npm run build` 和 `npm run check`；`npm run build:worker` 只是兼容别名，不代表生产站部署到独立 Worker。
- 推送 `main` 后，等待 Pages Git 集成完成生产部署，再运行 `node scripts/verify-image-assets.mjs --origin https://about.shuangyue.space`，确认线上资源版本、头像、分享卡片和 VCF 均可访问。

## 证据地图

- 三语静态页面框架、canonical/hreflang、Open Graph/Twitter 与 JSON-LD: `scripts/build-pages.mjs:73-123`, `scripts/build-pages.mjs:328-343`。
- NFC 首页首屏、保存通讯录、分享与联系入口: `scripts/build-pages.mjs:159-204`。
- 无 JavaScript 时的保底说明与可读静态正文: `scripts/build-pages.mjs:120-123`, `scripts/build-pages.mjs:318-325`。
- Web Share API、复制降级和操作反馈: `assets/js/app.js:717-789`。
- 首页卡片图片来自 `homeCards.image`: `assets/js/data.js:219-303`。
- 城市图片优先来自 `cityImages`，未命中才回退 `regionalImages`: `assets/js/data.js:892-972`。
- 响应式 WebP、首页 hero、1200×630 分享图和应用图标的生成: `scripts/optimize-images.mjs:14-94`。
- `public/` 发布目录的重建与复制清单: `scripts/prepare-worker-assets.mjs:3-27`；构建入口见 `package.json:7-11`。
- VCF 的响应头和旧地址迁移: `_headers:28-35`, `_redirects:1-2`。
- Service Worker 的页面网络优先与静态资源缓存策略: `sw.js:1-77`。
- Pages Git 集成与本地 Worker 预览的职责边界: `README.md:31-78`, `wrangler.jsonc:1-5`, `wrangler.jsonc:29-33`。
- 本地及线上资源回归检查: `scripts/verify-image-assets.mjs:120-158`。

## 维护约束

- **证据追溯**: 每条 claim 必须附来源文件与行号区间；无法直接证明的内容标记为 `[INFERRED]`。
- **LLM 安全**: 提供给外部 LLM 的内容只包含文件列表、模块边界、端点和函数签名等结构化中继数据，不发送完整源码或密钥。
- **增量更新**: 先以 `git diff` 确定受影响模块，再只修补相关文档区段。
- **Drift detection**: 建议每月或每季度比对文档与仓库；发现漂移时增量修复，不全面重写。
