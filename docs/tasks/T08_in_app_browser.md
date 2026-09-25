# T08 · 应用内浏览器（替换原型的演示浏览器）

共同规则见 `docs/tasks/RB_COMMON.md`。安全要求参见备忘录 §5 与 AGENTS.md（"Never expose native execution commands to external web content"）。

## 目标
在应用内浏览真实网页，把网页保存为可引用的来源，并对网页文字添加标记。

## 原生（`src-tauri`）
1. 远程页面使用独立的 `WebviewWindow`（标签 `browser-*`），**不出现在任何 capability 中**、不配置 `remote.urls`、不注入 API 口令与全局 Tauri 对象；
   使用单独的数据目录；关闭 DevTools 和浏览器右键菜单。
2. 用 `on_navigation` 只允许 http / https，并拒绝回环地址和私有网段（127.0.0.0/8、::1、10/8、172.16/12、192.168/16）、`file:`、`tauri:` 以及自定义协议；下载一律拦截，交给宿主确认。
3. 从主窗口通过已有的原生窗口命令打开、前进、后退、刷新，并取得当前 URL 和标题（只能由主窗口发起，远程页面不能调用）。

## 宿主 `scripts/research-base/web-capture.mjs`（新模块）
1. `POST /api/research/web/capture {url, projectId}`：由 Node 按 URL 重新抓取（限制大小 5 MB、超时 20 秒、只跟随 http/https 跳转，同样拒绝内网地址），
   用 `@mozilla/readability` + `linkedom` 提取正文，经 DOMPurify 净化后保存 HTML 快照（放在 library 目录，登记为 resource）。
   同时读取元数据：`citation_*` → JSON-LD `ScholarlyArticle` → Dublin Core → DOI 正则；有 DOI 时交给 T06 补全。
   最后创建 `rb_sources`（kind `webpage`）并入队解析：正文作为 Markdown 块，保留标题结构。
2. 只读取公开页面；需要登录或由 JS 渲染的页面如实提示"无法离线抓取"，不去读取远程窗口的 DOM（除非另开安全评审）。

## 前端
- 右侧浏览器栏（取代 `browserPanel` 的演示页面）：地址栏、前进、后退、刷新、"在独立窗口打开"、**"保存为来源"**；
  保存后显示阅读模式（使用 T04 的 Markdown 阅读器），可以标记和引用。
- 原型中的"引用页面"改为：保存为来源并把来源加入当前输入框的附件。

## 验收
- 单元测试：内网地址拦截（包括 DNS 解析到回环的情况）、跳转到内网被拒、大小和超时限制、元数据提取顺序（使用本地 HTTP 夹具）。
- 原生验证（Windows，需要 Codex 本机执行）：远程页面中调用 `window.__TAURI__` 为 undefined；远程页面向宿主 API 发送的 fetch 请求被拒（401 或 CORS）；截图。
