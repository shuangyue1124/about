# 留言回复与 AI 整页翻译

本文档记录访客可见的两组行为：留言回复的层级展示，以及非静态语言的整页 AI 翻译与缓存清理。所有条目都可以从当前仓库验证。

## 留言回复

- 访客可以对任意一条**已公开**的留言点「回复」；回复复用页面唯一的主表单与同一个 Turnstile 组件，不为每条评论生成独立表单。证据：`assets/js/app.js` 的 `bindReplyButtons` / `setReplyTarget`。
- 回复与普通留言走完全相同的服务端链路（蜜罐 -> 限流 -> Turnstile -> AI 审核 -> D1），只是额外携带 `parentId`。父留言不存在或状态不是 `approved` 时返回 400。证据：`worker.js` 的 `handleComments` POST 分支。
- 前台只嵌套**一层**：直接回复缩进显示在原留言下（`.comment-item--reply`）；「回复的回复」平铺在同一组里，并以「回复 @昵称」标注被回复对象。父留言不在当前列表（被删除 / 被驳回 / 超出 limit）时，回复平铺为顶层并同样标注。证据：`assets/js/app.js` 的 `buildCommentTree` / `renderCommentTree` / `commentItem`。
- 父留言被管理员驳回时，其回复在前台隐藏；父留言重新批准后自动恢复。证据：`buildCommentTree` 的 `hidden()` 判断（依据后端返回的 `parentStatus`）。
- 管理员删除一条留言会连同其全部回复一起删除（D1 `WITH RECURSIVE` 级联），后台删除按钮会二次确认。证据：`worker.js` 的 `deleteComment`、`assets/js/admin.js` 的 `deleteComment`。
- 数据模型：`comments.parent_id`（`migrations/0004_comment_replies_and_translations.sql`），列表查询用 LEFT JOIN 一次取回 `parent_name` / `parent_status`。证据：`worker.js` 的 `listD1Comments`。

## AI 整页翻译

- 语言选择器由 `assets/js/app.js` 注入到 `.lang-menu`（构建时该容器仍只含主题按钮）。zh/ja/en 跳转到对应静态页面；其余语言留在当前文档就地翻译。证据：`bindLangSelector` / `localeHref`。
- 可选语言来自 `assets/js/data.js` 的 `languages`（`ai: true` 项），必须与 `worker.js` 的 `AI_LANGUAGES` 保持一致；`npm run check` 的 `check:data` 会校验两者同步。证据：`scripts/check-data.mjs` 的 languages 段。
- 翻译范围：界面字典、静态正文、按钮、占位符 / `aria-label` / `title` / `alt`，以及每条留言正文。纯数字、日期与符号不发送。证据：`assets/js/app.js` 的 `collectTranslationItems` / `translateEligible`。
- 完整性：模型必须返回与输入条数一致的 JSON 数组，否则整批重试一次，仍失败返回 502；前端在**所有**条目到齐后才一次性替换（原子应用），失败则保留原文并提示。证据：`worker.js` 的 `translateBatch` / `translateBatchWithRetry`、`assets/js/app.js` 的 `startAiTranslation`。
- 评论晚于首次翻译到达时（慢网络 / 后续刷新），会单独补译缺失的留言正文。证据：`assets/js/app.js` 的 `translatePendingComments`。

## 缓存与清理

- 译文按内容哈希缓存在 D1 `translations` 表，相同文案跨页面、跨访客共享一行。证据：`worker.js` 的 `handleTranslate` / `saveTranslations`。
- 语言使用时间记录在 `translation_lang_usage`，同一实例内每种语言最多 10 分钟写一次 D1。证据：`worker.js` 的 `touchTranslationUsage`。
- 超过 **31 天**无人使用的语言，其**全部**缓存译文会被删除。Pages 无定时触发，清理沿用项目既有的 1/40 概率抽样模式；后台另有手动入口。证据：`worker.js` 的 `maybeCleanupTranslations` / `cleanupTranslations`、`assets/js/admin.js` 的 `translateCacheView` / `cleanupTranslations` / `purgeTranslation`。
- 翻译限流为纯内存固定窗口（12 次/分钟、60 次/10 分钟），不产生 KV 写入。证据：`worker.js` 的 `TRANSLATE_RATE_LIMITS` 与 `memoryRateLimitCheck` 调用。
