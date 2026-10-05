# 文档索引与维护规则

> 最近整理：2026-09-25（Claude）。新增或废弃文档时，同步更新本索引。

## 每次开始工作前读
| 文件 | 作用 | 何时更新 |
|---|---|---|
| `AGENTS.md`（仓库根目录） | 开发准则：分工、边界、安全、交付方式、用户已确认的交互修订 | 用户提出新的长期规则时 |
| `docs/SYSTEM_SPEC.md` | **现状**：每个功能现在做什么、状态、实现、验证证据 | 功能的行为、接口、存储或验证状态变化时，在同一次提交里更新 |
| `docs/ROADMAP.md` | **方向**：alpha 目标、A / B / C 阶段进度、任务队列、分支状态、待用户决定的事项 | 任务开始或完成、分支合并、优先级变化时 |

## 产品意图（规定"应该怎样"）
| 文件 | 内容 |
|---|---|
| `docs/00_MASTER_FUNCTIONS.md` | 前端功能总说明（v0.3），部分条目已被后续修订覆盖，以 `02` 的修订节和 `SYSTEM_SPEC` 为准 |
| `docs/02_INTERACTION_CONTRACTS.md` | 交互契约；最前面是**按日期的用户修订**（2026-09-24、2026-09-19），优先于正文 |
| `ScienceScope.html` 与 `docs/pages/`、`docs/flows/`、`docs/page-manifest.json` | 已批准的视觉原型与页面清单（视觉基线，不直接修改） |

## 设计（规定"怎么做"）
| 文件 | 内容 |
|---|---|
| `docs/design/RESEARCH_BASE.md` | 研究资料库：统一数据后端、长期记忆、混合检索、文档解析、浏览器、最低配置 |
| `docs/design/RESEARCH_MEMO_2026-09-25.md` | 调研备忘：记忆系统、知识管理、检索、文档工具、浏览器（每项标明核实方式） |
| `docs/REVIEW_2026-10-05.md` | 整体复盘：流程、前端架构、代码风格、数据升级连续性、统一编辑、alpha 路线（S0–S5）与待用户决定的事项 |
| `docs/design/ARCHITECTURE.md` | **总纲（已确认）**：五个原语、关键决定、代码结构、重建阶段 R0–R6、协作方式、功能清单 |
| `docs/design/CORE_MODEL.md` | 核心模型：数据根、表、事件、工作区资源、参与者定义、发言规则、上下文组装、内置工具、接口 |
| `docs/CODE_STYLE.md` | 代码风格与检查工具（`npm run check`） |
| `docs/design/DATA_AND_ROLES.md` | 数据布局（安装目录 `data/`：文件 + 一个 SQLite）与角色模型（一套工具、修改即生效可撤销）；S2、S3 按此实现 |
| `docs/archive/` | 已被取代的旧规则与文档（如 2026-10-05 前的 AGENTS.md） |
| `docs/design/RUNTIME_PORT.md` | 运行时接口：产品代码对智能体运行时（当前 DSH）的全部依赖、契约测试与 DSH 限制表（初稿，T23 核对） |
| `docs/design/PYTHON_ENVIRONMENTS.md` | Python 运行环境：内置 3.14、uv 共享缓存、按任务分配 |
| `docs/design/EXPERT_CONTEXT.md` | 专家的长上下文：共享纪要 + 近期原文 + 按需回查（建议方案，待确认） |
| `docs/DSH_CONNECTION.md` | 与 DeepSeek Harness 的连接方式 |
| `docs/NATIVE_SETUP.md` | Windows 原生构建环境 |

## 任务（交给执行者的任务书）
`docs/tasks/`：T01–T03（早期原生验收）、`RB_COMMON.md`（研究资料库系列共同规则）、T04–T10（研究资料库）、T11（Python 环境）、
`LOCAL_VALIDATION_2026-09-25.md`（合并前本地验收）。任务状态统一写在 `ROADMAP.md` 的任务队列里。

## 记录（按日期，只追加）
| 文件 | 内容 |
|---|---|
| `docs/DESKTOP_IMPLEMENTATION.md` | 开发与验收日志，最新在最上面；**1.0.0-alpha 原始计划在其中"1.0.0-alpha 内测交付计划（2026-09-19）"一节，现已整理进 `ROADMAP.md`** |
| `docs/T24_LIMITS_REPORT_2026-10-05.md` | T24 长内容、模型上限继续、用户整理成本设置的 Windows 验证、三轮真实对照、来源审计与保留限制 |
| `docs/T24_SOURCE_AUDIT_2026-10-05.md` | T24 真实三轮论文回答的逐句来源审计：短摘录、页码/段落定位、无依据论断与计算错误 |
| `docs/T10_TRANSPORT_FOLLOWUP_REPORT_2026-10-04.md` | T10 传输补充交付的三轮结果、逐题历史对比与额外无依据论断审计；原回答、日志和论文证据留在 H 盘忽略目录 |
| `docs/REVIEW_CLAUDE_2026-09-23.md` | Claude 的深度审阅与路线建议（历史快照） |
| `docs/WEB_REVIEW_HANDOFF.md` | 2026-09-20 网页端审阅交接（历史快照） |

## 原型时期资料（仅供参考，不再维护）
`CODEX_START.md`、`README.md`（仓库根目录，描述原型交付包）、`docs/01_SOURCE_AND_DECISIONS.md`、`docs/03_DESKTOP_WINDOWS.md`、`docs/04_FEEDBACK_MATRIX.md`、`docs/05_RESEARCH_NOTES.md`。
其中仍有效的决定已经体现在 `02` 和 `SYSTEM_SPEC` 中。建议以后移入 `docs/archive/`，移动前要先改掉所有引用它们的地方（包括 `AGENTS.md` 中"Read CODEX_START.md"一句）。

## 维护规则
1. **一件事只写在一个地方**：现状写进 SYSTEM_SPEC，方向写进 ROADMAP，过程写进 DESKTOP_IMPLEMENTATION，规则写进 AGENTS，怎么做写进 design/，分配的工作写进 tasks/。其他文件引用它们，不复制内容。
2. 用户的新决定：影响交互的写进 `02_INTERACTION_CONTRACTS.md` 最前面的日期修订节；影响开发规则的写进 `AGENTS.md`；同时在 ROADMAP 的"待用户决定"中划掉对应项。
3. 任务书完成后不删除，在 ROADMAP 中标为完成，并注明分支和 SHA。
4. 实测数据必须写明来源（真实模型还是本地模拟模型、哪台机器、手写样本还是真实数据），推算值必须标明是推算。
