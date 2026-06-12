# 朔风霜月 NFC 名片站

一个可直接部署到 Cloudflare Pages 的多文件静态站。页面保留 NFC 名片、三语切换、QQ 头像同步、联系方式和旅行足迹，并采用宣纸、水墨、青绿、朱砂印章风格。

## 本地预览

```powershell
cd D:\pc\shuangyue-about
npx serve .
```

如果只想快速查看，也可以用任意静态服务器打开当前目录。页面没有构建依赖。

## Cloudflare Pages

- Build command: 留空
- Build output directory: `/`
- Root directory: `shuangyue-about`

仓库推送后，Cloudflare Pages 会直接发布这些静态文件。`_headers` 提供基础安全头和静态资源缓存，`_redirects` 让 `/travel`、`/cities/<slug>` 和 NFC 入口更稳定。

## 更新城市

城市数据在 `assets/js/data.js`。新增或修改城市后运行：

```powershell
npm run build:pages
```

脚本会重新生成 `cities/*.html` 入口文件。页面内容仍由共享数据和 `assets/js/app.js` 渲染，便于统一维护中、日、英三种语言。
