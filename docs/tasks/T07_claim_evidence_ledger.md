# T07 · 主张–证据台账

共同规则见 `docs/tasks/RB_COMMON.md`。借鉴：Micropublication、SEPIO、Toulmin 模型、Scite 的支持 / 反驳分类（备忘录 §2）。

## 数据（已有，不改表）
- 主张：`rb_items` type=`claim`，`payload`：`statement`、`claimStatus`（hypothesis / supported / contested / refuted / uncertain / retracted）、`qualifier`（适用范围和条件）、`warrant`（推理依据，可选）。
- 证据：`rb_links`，from 为证据（chunk / source / item / message），to 为主张，relation 为 supports / contradicts / qualifies，带 `quote`、`locator`、`strength`（0–1）和 `note`。
- 规则：**只有用户能把主张设为 supported / refuted**；模型只能通过 `research_propose` 提议状态变化，并必须附上证据。

## 界面（`desktop/claims.mjs`，挂在 T05 的"主张与证据"页）
1. 主张列表：状态标签、支持与反驳的证据数量、最近变化时间；按状态和标签筛选。
2. 主张详情：左栏为陈述、限定条件、推理依据、状态流转（每次变化记录理由，写入修订历史）；右栏分"支持 / 反驳 / 限定"三列列出证据，
   每条证据显示引文和来源标签，点击后在预览栏定位。
3. 添加证据：在消息或文件上划选文字时，标记小窗增加"作为证据挂到主张…"（在原小窗上加一个次要按钮，不另开窗口），选择主张和关系。
4. **从讨论登记**：有序讨论的审核结论和普通专家回答的消息操作中增加"登记为主张"，预填陈述与来源消息，由用户确认后创建（直接写入，因为是用户的操作）。
5. 导出：一个项目的"主张–证据表"（Markdown 或 CSV：主张、状态、证据、引文、来源、页码），用于写作。

## 验收
- 单元测试：状态流转（模型提议 → 用户接受）、证据的方向和关系、导出内容。
- smoke：从讨论的审核结论登记主张 → 从 PDF 或 Markdown 段落添加支持证据 → 从另一段添加反驳证据 → 状态改为 contested → 导出表中有这三条。
- 浅色和深色截图。
