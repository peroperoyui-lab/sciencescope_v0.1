# KB-4 知识库工具：读图、写图、写资料库

- 起草：Claude，2026-10-20。依据：`architecture/KNOWLEDGE_BASE.md`（已定稿）§1a、§3.2、§3.6、§6、§10 KB-4；`decisions/DECISIONS.md` 2026-10-18（`research_write`）、2026-10-19（只存知识、建边保守）、2026-10-20（结果轻量）。接在 KB-3 之后。
- 执行：Sol（Windows）；审阅：Claude。约 2 小时，一步交付；超出就停下汇报。

## 目标

所有角色（主专家、专家、秘书、全局助手）用同一组工具读写知识库：查一个节点的邻域，建实体和带证据的边，改条目和资料元数据，撤回一轮修改。写入立即生效、记修订，一轮发言的修改归入一个 `ai-turn-end` 版本（KB-1 已在 6 处发言结束位置关版本）。

## 用户会怎么用

设计稿 §2 场景 4：用户让方法专家「整理一下项目里 QCA 相关的文献和代码」。专家先 `research_search` 找段落，再 `kb_graph` 看「fsQCA」周围已有什么，然后一次 `kb_write` 新建 3 个实体、9 条边，每条边带原文引文；回答末尾说一句改了什么。用户不满意，说「撤回刚才的修改」，专家用 `workspace_versions` 撤回这一版。本任务没有界面（对话里的显示是 Claude 的 KB-12）。

## 要做的

1. **`kb_graph`**（新）：参数 `ref?` 或 `query?`、`depth?`（默认 1）、`relations?`、`layers?`、`projectId?`、`limit`、`offset`。`query` 先按名称和别名找实体、再用 `research.search` 找资料，取最相关的当中心。结果 `{nodes, edges, paths?, remaining}`：节点只给 `{ref, name, kind, degree}`，边只给 `{from, relation, to, layer}`；`depth ≥ 2` 先返回路径和节点清单，邻域详情分页（§6「结果轻量」）。只读 `active` 边；`in-folder` 边按 `folder_path` 即时生成（只在项目范围），不存表。`mode: gaps` 不做（KB-14）。
2. **`kb_write`**（新）：`ops[]`，支持 createEntity、updateEntity、createEdge、updateEdge、remove {ref}、merge {into, from[]}、label {ref, add?, remove?}、member {projectId, ref, remove?}。全部调 KB-1 的存储服务（`app/services/knowledge/store.js`），`origin='ai'`，记 `created_by`、`meeting_id`、`turn_id`。整批一个 `versionId`；一项失败不影响其他项，结果逐项给新 id 或错误原因。不允许写 `derived` 层。
3. **`research_read` 扩展**：`type` 加 `entity`，返回字段、别名、标签和相连边（分页，边同样轻量）；说明超过一行时只给开头一行并写「还有 N 字」，`full: true` 读全文。
4. **`research_write`**（新）：`op` 为 createItem / updateItem / supersedeItem / updateSource；`args` 照现有 `research/items.js` 和 `store.updateSource` 的参数。条目修订照旧走 `rb_revisions`。`importUrl` 不做（没有网页导入服务，等网页检索定了再加）。私有条目不能读也不能写。
5. **`workspace_versions` 扩展**：`resource` 加 `knowledge`，list / read / restore 调 KB-1 的 `versions.list`、`changes`、`restore`；restore 的结果写明跳过了哪些「之后又被改过」的记录。
6. **工具说明**：写进各工具的 `description`，英文，内容照 §6「提示词指导」：用户没要求整理或修改时只读不写；每条边必须附依据（资料段落引文 `chunk:` 或用户消息 `message:`），没有依据就不写；不写自己的推断和评价；不从数据文件和编辑台文稿里抽实体；建实体前先查同名和别名；关系优先用内置键；写完在回答里说清改了什么；`similar-to` 和 `cites` 是线索不是结论。靠说明引导，不做硬拦截（产品原则 4、5）。
7. **批准**：这几个工具只写 ScienceScope 自己的数据，「请求批准」模式下不询问（产品原则 5 只对命令、项目文件夹写入和装包询问）。

## 可以改的

`app/services/tools.js`、`app/services/knowledge/`（新增工具实现文件及测试，例如 `tools.js`、`graph.js`）、`app/services/research/`（`search.js` 里读实体的部分、`items.js` 只在需要导出现有方法时）、`docs/product/FEATURES.md`、`docs/log/IMPLEMENTATION_LOG.md`（不超过 5 行）。

## 不做的

- 不改 `app/ui/`（设置 → 工具页的中文说明和时间线显示由 Claude 加）。
- 不做 `kb_build`（KB-6）、检索的图扩展和 `research_search` 的 `via`（KB-7）、接口路由（KB-5）、`gaps`（KB-14）。
- 不加参数上限或硬校验来拦 AI 写图；结果大时分页并写明剩余数。
- 不动 `<预览安装目录>` 及其数据。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）。
- 脚本运行时的功能测试：专家一轮里 `kb_graph` → `kb_write`（2 个实体、3 条带 `chunk:` 证据的边、1 个标签）→ 发言结束后有一个 `ai-turn-end` 版本，边的 `origin`、`created_by`、`meeting_id`、`turn_id` 都对；下一轮 `workspace_versions` restore 后这些边是 `removed`；`research_read {type:'entity'}` 读到别名和相连边；`research_write` 改一条条目后 `rb_revisions` 多一行。
- 真实模型（`deepseek-v4.1-flash`）跑一次场景 4（项目里放 3 篇带方法描述的论文），报告请求数和 token，并人工看一遍写出的边：是否都有原文依据、有没有模型自己的推断。抽查结果写进报告。

## 交付

- 分支：`codex/kb-4-tools-YYYYMMDD`，从集成分支最新提交开始。报告不超过 15 行，给出远程分支与 SHA。不建 PR、不合并。
