# 图片资源交付架构

## 源码资源与构建产物分离

站点图片的源文件保存在 `assets/images/`，Worker 实际发布目录是 `public/`。构建脚本会把 `assets`、页面入口、城市页和 Worker 辅助文件复制到 `public/`，所以只修改 `assets/images/` 但不运行 `npm run build:worker` 时，待发布目录不会同步。证据: `scripts/prepare-worker-assets.mjs:3-18`, `wrangler.jsonc:23-27`。

## 首页图片由数据层声明

首页卡片不直接在 HTML 中写死图片。图片路径由 `homeCards.image` 声明，渲染时由首页卡片组件转换为 CSS 变量和 `<img>`。证据: `assets/js/data.js:183-267`, `assets/js/app.js:331-341`。

## 城市图片按 slug 优先映射

城市详情先读取 `cityImages[stop.slug]`，找不到才回退到地区图。这个顺序保证已有城市优先使用城市或地标组专用图片；地区图只作为兜底。证据: `assets/js/data.js:856-936`。

## 城市视觉组件保留兜底能力

城市视觉组件在存在 `visual.image` 时输出真实图片，并添加 `city-visual--with-image`。没有图片时 CSS 仍可用地区背景作为兜底，因此新增城市时如果忘记加入 `cityImages`，页面不会空白，但会被 `npm run verify:images` 拦截。证据: `assets/js/app.js:520-531`, `assets/css/styles.css:858-919`, `scripts/verify-image-assets.mjs`。

## 资源版本号用于浏览器和 Worker 缓存破旧

根页面和生成的城市页面通过 query string 引用 CSS/JS 资源版本。更换图片或数据映射时，需要更新 `assetVersion`，并重新构建页面入口。证据: `index.html:13-18`, `travel/index.html:13-18`, `admin.html:8-13`, `scripts/build-pages.mjs:9-31`。

## Worker route 是线上自定义域名入口

`about.shuangyue.space/*` 由 Worker route 接管，部署目标不是单纯的 Pages 静态输出。发布新图片必须执行 Worker 部署，并在部署后检查线上首页是否引用最新资源版本。证据: `wrangler.jsonc:8-15`, `package.json:7-10`, `scripts/verify-image-assets.mjs`。

## 本次故障根因

2026-06-15 复查时，线上首页仍引用旧版本 `20260613-full-images`，新路径 `/assets/images/home/about.png` 和 `/assets/images/cities/zhangjiajie-pillars.png` 返回 404。本地代码和 GitHub `main` 已包含新图片，但 Worker 线上版本没有完成部署。执行 `npx wrangler deploy` 后，线上首页改为引用 `20260614-varied-images`，上述图片 URL 返回 200。该结论来自部署前后的 HTTP 校验和 Wrangler 部署输出。
