# Common Development Commands

- `npm ci` — 按锁文件安装项目依赖；不要用它改写依赖版本。
- `npm run build` — 优化图片、生成三语首页/旅行页/城市页，并重建 `public/` 部署目录。
- `npm run check` — 检查前端与 Worker JavaScript 语法，并验证图片、页面版本和 vCard 产物。
- `apltk codegraph --help` — 仅在本机已有 `apltk` 时先读取可用命令，再按帮助检查依赖、影响范围与循环；工具缺失时不要自行安装或下载。

# Project Business Goals

- 维护 `about.shuangyue.space` 的 NFC 个人名片体验，让个人资料、社交入口、联系方式和旅行足迹在移动端与弱网下仍可访问。
- 以 Cloudflare Pages 托管静态站和 Pages Functions API，通过 GitHub `main` 分支集成发布生产站。

## Prohibitions

- 不要直接修改 `public/`；它会被 `scripts/prepare-worker-assets.mjs` 删除并从根页面、`assets/`、`cities/`、`en/`、`ja/` 等源码/生成物重建。
- 不要手工修改 `index.html`、`travel/index.html`、`cities/*.html` 及其 `en/`、`ja/` 版本；它们由 `scripts/build-pages.mjs` 根据 `assets/js/data.js` 生成。
- 不要对本仓库运行 `npx wrangler deploy`，也不要给 `about.shuangyue.space/*` 添加 Worker route；生产发布走 Pages Git 集成。历史提交 `ade8f25` 已移除会绕过 Pages 的该路由。
- 不要把管理员密码、Turnstile secret 或其他密钥写入仓库；只保留绑定名和非敏感配置。

# Project Documentation Index

- `README.md` — 本地预览、Pages 部署、Functions 绑定、留言存储和管理员后台说明。
- `docs/README.md` — 项目文档入口与文档维护范围。
- `docs/features/visual-content.md` — 首页、城市图片及多语言视觉内容的可见行为。
- `docs/architecture/asset-delivery.md` — 源资源、页面生成、`public/` 产物和部署链路。
- `docs/principles/image-asset-maintenance.md` — 图片替换、复用、构建和线上验证原则。
- `AGENTS.md` — 面向非 Claude 代理的同一组根级项目约束。
