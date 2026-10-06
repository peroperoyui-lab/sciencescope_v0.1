# R4-1b 资料库界面与本地混合检索

- 起草：Claude，2026-10-06。接 R4-1a（已合并，`app/services/research/`）。队列见 `docs/design/UI_RESTORE.md`。
- 执行：Sol；审阅：Claude。约 2 小时；超出就按"拆分"一节先交前半，停下汇报。

## 目标

旧界面里的资料库入口按原样回到新界面，接上 R4-1a 的接口；再把旧版本地混合检索（关键词 + 本地向量模型）移植到新核心，AI 工具和界面检索都走它，模型不可用时退回关键词检索。

## 界面（按旧版结构复刻，类名沿用 `styles/legacy/research-base.css`）

参照旧 `desktop/research-base.mjs`（最终版，覆盖了 `library.mjs`）与原型 P18–P21、P33：

- 侧栏：项目区的"数据库"入口（旧 `data-route="database"`）。路由 `#/database/<projectId>`（当前项目材料）、`#/library`（我的资料，个人范围）、`#/sources`（外部资源，复用欢迎页的学术站点列表与菜单）。三者顶部用旧版的三个标签切换。
- 研究资料库页：标题与 i 提示；"我的资料 / 当前项目材料"切换；导入材料（多文件，base64 上传，进度与失败原因可见）；搜索框（结果按条目 / 文献与资料 / 段落分组，高亮命中词，点段落打开材料详情并定位到该段）。
- 标签页：文献与资料、知识、模型与公式、主张与证据。记忆、记忆收件箱、项目简报属于 R4-4，不显示。
- 文献表：旧版列（标签、标题、作者、年份、期刊或来源、类型、解析状态、阅读状态、标签、操作）；筛选（类型、阅读状态、标签）、排序、分页。操作：材料详情、默认程序打开原件、编辑元数据、重新解析。
- 材料详情（P20）：来源信息、解析状态与错误、按页 / 节列出段落（段落带引用标签，可复制）。文件预览器属于 R4-2，这里只列文字。
- 条目卡片：子类型、修订号、正文（Markdown）、模型与公式的 LaTeX 与变量表、主张的状态；操作：编辑、取代、修订历史、置顶、归档；新建条目表单（标题、子类型、正文、可见性：共享 / 私有）。状态筛选含已取代（折叠显示）。
- 设置 P33：在"目录与运行时"页加旧版"本地混合检索"一节：状态、模型名、硬件是否满足、索引与下载进度、开启 / 关闭、下载或修复模型、重新检查索引（参照 `desktop/semantic-settings.mjs`；进度用事件推送，不要每秒轮询）。
- 收到 `research.changed` 事件时刷新当前页；所有新文字在 `app/ui/i18n/en.js` 有英文。

## 后端补齐

- 接口：`PATCH /api/research/sources/:id`（标题、类型、作者、年份、来源、标签、阅读状态，存进 `metadata_json`，标题同步进全文索引）、`POST /api/research/sources/:id/reparse`、`POST /api/research/sources/:id/open`（用 `services/system.js` 打开原件）、`GET /api/research/sources` 支持 kind / readStatus / tag / sort / direction 筛选。
- 本地混合检索：移植旧 `scripts/research-base/` 的 `embedding*.mjs`、`model-assets.mjs`、`vector-store.mjs`、`hybrid.mjs`、`semantic-service.mjs` 到 `app/services/research/semantic/`，按 `docs/CODE_STYLE.md` 重写。保留已验证行为：模型清单 `models/default-embedding.json`（multilingual-e5-small int8 384）与 sha256 校验、首次下载必须由用户点击、硬件检测、工作线程推理、对话运行时暂停建索引、索引版本不一致或向量阶段超时整次退回关键词检索、结果标明本次用的是哪种检索。
- 向量存进同一个 SQLite（新迁移 `004-research-vectors.js`；可沿用旧版 `sqlite-vec`），模型文件放 `dataPaths()` 下的模型目录，不进项目文件夹。开关存设置（有真实消费者）。
- `research_search` 工具与 `/api/research/search` 共用混合检索；返回里带 `mode: 'hybrid' | 'keyword'`。

## 可以改的

`app/ui/`（新组件如 `components/research-*.js`、路由、侧栏、设置页、样式补充放 `styles/app.css`）、`app/ui/i18n/en.js`、`app/services/research/`、`app/server/routes/research.js`、`app/core/db/migrations/`、`app/core/paths.js`、`app/core/defaults.js`（设置默认值）、相关测试、`docs/SYSTEM_SPEC.md`、`docs/design/CORE_MODEL.md`、`docs/design/UI_RESTORE.md`（R4-1 标为已复原）、`docs/DESKTOP_IMPLEMENTATION.md`。

## 不做的

- 不做记忆、收件箱、项目简报、记忆整理（R4-4）；不做文件预览器、输入框附件与"项目材料与引用"右栏（R4-2）。
- 不改旧线代码；不改旧样式表，必要的补充写进 `styles/app.css`；不加安全测试或硬上限；单个文件不设导入大小上限（旧版 14 MB 的限制去掉）。
- 测试里不下载真实模型：向量部分用假的嵌入函数注入，真实模型只在 Windows 验收时手动走一遍。

## 完成标准

- 浏览器测试 `app/ui/research.browser.test.js`（每条用户路径一个）：从侧栏进入数据库 → 导入 PDF → 表里出现且解析完成 → 搜索到句子 → 打开材料详情看到带页码的段落；新建条目 → 编辑 → 取代 → 修订历史可见；编辑文献元数据后表格更新；切到我的资料与外部资源。
- 服务测试：注入假嵌入时检索结果为 `hybrid` 且语义相近的段落排进前列；模型缺失时为 `keyword`；迁移在已有数据库上升级成功。
- `npm run check` 通过；Windows 上浏览器测试通过，并真实下载一次模型、开启混合检索走一遍，截一张资料库页和一张设置页的图，与旧界面对比。

## 拆分（如超时）

先交界面与后端补齐（1b-1，关键词检索），再交本地混合检索（1b-2），各自一个分支、各自可合并。

## 交付

分支 `codex/r4-1b-research-ui-20261006`（拆分时加 `-1` / `-2`），报告 ≤15 行（改了什么、文件、测试结果、遗留问题），给出远程分支与 SHA。不建 PR、不合并。
