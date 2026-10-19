# 文档索引

> 2026-10-18 重新整理（Claude）。新增、移动或归档文档时同步更新本索引。路径都相对于 `docs/`。

## 第一次来，按顺序读

1. 根目录 `AGENTS.md`：产品原则、工程规则、分工。
2. `product/VISION.md`：ScienceScope 是什么、给谁用、alpha 的范围。
3. `product/FEATURES.md`：新核心现在能做什么，代码在哪里。
4. `plans/ROADMAP.md`：主线、任务顺序、当前进度。
5. `process/WORKFLOW.md`：谁做什么、一个任务怎么走完。
6. 当前任务的 `plans/tasks/*.md`。

## 目录

| 目录            | 放什么               | 主要文件                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product/`      | 产品定位和现状       | `VISION.md` 定位与 alpha 范围；`FEATURES.md` 现有功能（取代旧的 `SYSTEM_SPEC.md`）                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `architecture/` | 技术框架             | `ARCHITECTURE.md` 总纲（五个原语、代码结构、知识库与编辑台的位置，2026-10-19 第二版）；`CORE_MODEL.md` 数据、事件、发言规则、上下文、工具、接口；`RUNTIME_PORT.md` 运行时接口；`DATA_AND_ROLES.md` 数据布局与角色；`CONTEXT_ACCESS.md` 查阅层；`EXPERT_CONTEXT.md` 专家长上下文；`RESEARCH_BASE.md` 资料库；`KNOWLEDGE_GRAPH.md` 知识图谱（部分被取代）；`KNOWLEDGE_BASE.md` 知识库设计（alpha，2026-10-18）；`EDITING_DESK.md` 编辑台设计（alpha，2026-10-18）；`PYTHON_ENVIRONMENTS.md` Python 环境 |
| `design/`       | 界面与交互           | `DESIGN_SYSTEM.md` 设计系统（令牌、图标、组件、交互模式）；`system/` 设计画廊源文件；`INTERACTION_CONTRACTS.md` 用户确认的交互决定（按日期修订）                                                                                                                                                                                                                                                                                                                                                      |
| `process/`      | 怎么干活             | `WORKFLOW.md` 协作方式；`BRIEF_TEMPLATE.md` 任务书与提示模板；`REVIEW_CHECKLIST.md` 审阅清单；`ACCEPTANCE.md` 验证与验收；`CODE_STYLE.md` 代码风格；`NATIVE_SETUP.md` Windows 原生构建环境                                                                                                                                                                                                                                                                                                            |
| `decisions/`    | 用户做过的决定       | `DECISIONS.md` 按领域分类，最新在上，带理由和来源                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `plans/`        | 往哪走               | `ROADMAP.md` 路线图；`C_PERMISSIONS_RUNTIME.md` C 组方案；`IDEAS.md` 还没排期的想法；`tasks/` 进行中的任务书；`tasks/done/` 已完成的任务书（写新任务书时可参考）                                                                                                                                                                                                                                                                                                                                                                           |
| `reviews/`      | 复盘                 | 每次首测或阶段评审一份：`REVIEW_2026-09-23`（Claude 首次深度审阅）、`10-05` 整体复盘、`10-06`、`10-07`、`10-16` 首测、`10-18` 第二轮首测                                                                                                                                                                                                                                                                                                                                                              |
| `log/`          | 发生了什么           | `IMPLEMENTATION_LOG.md` 新核心的开发与验收日志，最新在上                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `research/`     | 调研                 | `RESEARCH_MEMO_2026-09-25.md` 记忆、知识管理、检索、文档工具、浏览器；`RESEARCH_NOTES_2026-09.md`；`KNOWLEDGE_BASE_RESEARCH.md` 知识库调研（2026-10-18）；`EDITING_DESK_RESEARCH.md` 编辑台调研（2026-10-18）                                                                                                                                                                                                                                                                                         |
| `handoff/`      | 给用户的测试指南     | `PREVIEW_TEST.md` 预览版首测指南                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `archive/`      | 已被取代的文档，只读 | `AGENTS_2026-10-05.md`、`ARCHITECTURE_2026-10-05.md`、`ROADMAP_2026-10-06.md`、`ROADMAP_2026-10-18.md`（R4、P1–P4、R6a 表格与 10-06 起的进度）；`legacy/` 是旧原型（`desktop/`、`scripts/`、`adapters/`）时期的全部文档：旧 `SYSTEM_SPEC`、旧实施日志、T01–T24 任务书和报告、P01–P49 页面说明、流程说明、`page-manifest.json`、`UI_RESTORE.md` 等                                                                                                                                                     |

## 维护

谁在什么时候更新哪份文档，见 `process/WORKFLOW.md` 第 5 节。几条要点：

- `product/FEATURES.md` 和代码在同一个提交里更新。
- `plans/ROADMAP.md` 每条进度不超过 3 行；`log/IMPLEMENTATION_LOG.md` 每条不超过 5 行。
- 用户的新决定写进 `decisions/DECISIONS.md`。
- 过时的文档移到 `archive/`，不删。
