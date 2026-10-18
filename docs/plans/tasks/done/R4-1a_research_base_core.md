# R4-1a 资料库后端（移植到新核心）

- 起草：Claude，2026-10-06。队列见 `docs/archive/legacy/UI_RESTORE.md`（R4-1 拆为 1a 后端、1b 界面与语义检索）。
- 执行：Sol；审阅：Claude。约 2 小时，超出就停下汇报。

## 目标

把旧版研究资料库（`scripts/research-base/`，已在旧线验收）移植到新核心：资料导入、解析、分段、条目、关键词检索，以及 AI 可用的 `research_search` / `research_read` 工具。只做后端，界面在 R4-1b。

## 做法

- 代码放 `app/services/research/`，按 `docs/process/CODE_STYLE.md` 重写，不要整份复制：保留旧版已验证的行为（解析、分段、引用格式 `[S3 p.4]`、被取代的记录保留、私有条目不进入 AI 候选），去掉旧线特有的接线（宿主 RPC、旧 chatStore、功能开关）。
- 数据库：`rb_*` 表进新的编号迁移 `app/core/db/migrations/003-research-base.js`（表结构可沿用旧 `schema.mjs`，删掉新核心用不上的列）。原件存 `data/library/originals/`（`dataPaths().library`）。
- 解析器：PDF、DOCX、Markdown、LaTeX、纯文本，沿用旧 `parsers/` 的依赖（`pdfjs-dist`、`mammoth` 等已在 `package.json`）。不设长度上限（AGENTS.md 原则 4），分段大小沿用旧版。
- 工具：在 `app/services/tools.js` 的工具表里加 `research_search`（问法、项目范围、返回数量）和 `research_read`（来源 / 条目 / 段落，分页并说明还有多少），所有角色共用。
- 接口（给 R4-1b 用）：`GET /api/research/sources?projectId=`、`POST /api/research/sources`（导入文件，base64）、`GET /api/research/sources/:id`、`GET /api/research/search?q=&projectId=`、条目的增改（`POST/PATCH /api/research/items`）。路由文件 `app/server/routes/research.js`。
- 每次导入和条目修改发事件（`research.changed`），界面据此刷新。

## 可以改的

`app/services/research/`、`app/services/tools.js`、`app/server/routes/research.js`、`app/server/server.js`（注册路由）、`app/core/db/migrations/`、`app/core/paths.js`（如需新目录）、相关测试、`docs/architecture/CORE_MODEL.md`（补一节资料库）、`docs/archive/legacy/SYSTEM_SPEC_2026-10-18.md`。

## 不做的

- 不做界面（R4-1b），不做语义 / 向量检索与本地模型（R4-1b），不做记忆整理（R4-4）。
- 不改旧线代码，不加安全测试或硬上限。

## 完成标准

- 功能测试（每条用户路径一个）：导入一份 PDF 和一份 DOCX → 能检索到其中的句子并读到带页码的段落；AI 通过 `research_search` / `research_read` 在会议里引用资料（脚本化运行时）；条目修改后旧版本保留。
- 迁移在已有数据库上升级成功（备份后迁移）。
- `npm run check` 全部通过，Windows 上同样通过。

## 交付

分支 `codex/r4-1a-research-core-20261006`，报告 ≤15 行（改了什么、文件、测试结果、遗留问题），给出远程分支与 SHA。不建 PR、不合并。
