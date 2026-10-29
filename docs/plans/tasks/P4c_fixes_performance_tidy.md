# P4c P4b 之后的修复：问题、后端性能、小整理和编辑台 Windows 实测（长程）

- 起草：Claude，2026-10-29。依据：P4b 报告 `handoff/reports/P4b.md`（热点意见 1–4、结构建议表 1–4）；Yui 2026-10-29 在决定卡片上选「问题加性能加小整理」；Yui 2026-10-28「先测后改」；Yui 2026-10-29 让编辑台转正（`DECISIONS.md` 界面与设计 2026-10-29），场景 1–9 的 Windows 实测仍欠着。
- 执行：Sol（Windows）；审阅：Claude。长程任务，约 4–5 天的工作量，分七部分按顺序做。每做完一部分，先把那一节写进报告，在分支上提交一次，再做下一部分。哪部分需要改接口形状（第 2 部分的新接口除外），就停在那一部分，写清原因再汇报。
- 同时进行：Claude 修 `desk-md`、`desk-tex` 两项公式编辑测试和 `research.browser` 切换范围测试（P4b 第三部分 1–3），并在第 2 部分完成后把界面接到新接口上。这几项不在本任务里。

## 目标

1. 打开或翻动一个长对话时，查资料和知识库改动的请求从每页约 90 个降到几个，界面上看到的内容不变。
2. 设置保存、工作站版本树打开时不再有一秒以上的长尾；启动时能推迟的工作推迟。热启动 6.5 秒里「HTTP 就绪到首屏」那 5.3 秒拆开，知道各段花在哪。
3. 相似边设置不能再存进会被拒绝的值；默认值、原子写入各只有一份；本地向量模型的 worker 协议有测试。
4. 编辑台的场景 1–9 在 Windows 安装版上实际走一遍，有结果和截图。

## 用户会怎么用

- 和 P4a、P4b 一样规模的项目。用户切到最长的对话、往上翻、离开再回来，回答下面的「本轮用到的资料」「本轮修改了知识库」照常出现，不慢。工作站打开 30 版的版本树，说明马上出来。改一个图视图偏好，不卡。
- 失败时：批量接口出错时界面要能退回单条接口（由 Claude 接）；批量接口本身返回清楚的错误，不吞掉单条消息的失败。

## 要做的

每一部分都「先量、改完再量」：用 `tools/perf/` 里 P4b 的脚本或补充的脚本，修前修后各报一次数字，写进报告。

1. **相似边设置校验**（P4b 结构建议第 1 条）：
   - 现状：`core/workspace/resources/settings.js` 的合并接受 `threshold: 2`、`maxPerPaper: -1`，`knowledge/derived.js` 的 similar 随后拒绝。
   - 改为：保存和使用共用一份参数规则，非法值在保存时返回能读懂的错误，保留旧值；合法值（包括 0 表示不建相似边）行为不变。不加新的产品上限。

2. **对话辅助信息批量接口**（热点意见第 1 条，只做后端）：
   - 现状：每条带 turn 的消息，界面分别请求 `GET /api/turns/:id`（`app/ui/actions.js` loadTurn）、`GET /api/messages/:id/citations`（`preview-actions.js`）、`GET /api/knowledge/versions?turnId=…&limit=1`，再取 `GET /api/knowledge/versions/:id`，并顺着 `restoredBy` 一条条取（`components/turn-knowledge.js` load）。一页约 90 个请求，组件重新挂载时再读一遍。
   - 改为：新增一个批量读取接口，界面一页一次调用。建议形状如下，确有更好的形状先在报告里说明理由：
     - `GET /api/meetings/:id/message-extras?ids=<逗号分隔的消息 id，最多 50 个>`
     - 返回 `{ items: { [messageId]: { turn, citations, knowledge } } }`：
       - `turn`：和 `GET /api/turns/:id` 返回的 `{ turn, toolCalls }` 一样；消息没有 turn 时为 `null`。
       - `citations`：和 `GET /api/messages/:id/citations` 返回的一样。
       - `knowledge`：这一轮没有已关闭的知识库版本时为 `null`；有就是 `{ ...GET /api/knowledge/versions/:id 的返回, lastId, withdrawn }`。`lastId` 是 `restoredBy` 链上最新一环的 id，`withdrawn` 表示链长为奇数（现在是撤回状态）。规则和 `turn-knowledge.js` 的 load 一致。
     - 不属于这个会议的消息 id，或不存在的 id，在 `items` 里给 `{ error: '…' }`，不让整次请求失败。
   - 原有的单条接口保留不动，详情和刷新还用它们。用 SQL 批量查，不要在服务里循环调用单条查询。
   - 测试：服务和路由测试，覆盖没有 turn、没有引用、有知识库改动、撤回、撤回后又恢复、混入其他会议的 id、超过 50 个 id。报告里写一页 30 条消息时，批量一次和单条 90 次的耗时对比。

3. **设置保存长尾**（热点意见第 2 条）：
   - 先补分段观测：一次 `PATCH /api/settings` 里，排队、文件读写、各消费者（`knowledge/jobs.loadSettings`、`card-queue.configure` 等）各花多少。用图视图偏好保存和设置页直接保存两种路径各量一次。
   - 再修：按变化的字段跳过无关的后台重配，同一 revision 不重复读。保留外部修改设置文件和凭据处理的现有行为。

4. **版本树说明批量读**（热点意见第 3 条）：
   - 现状：`services/versions/graph.js` 的 graph 每版单独查目录、读说明、查指令，30 版时首次约 1.0–1.3 秒。
   - 改为：元数据和指令一次批量查，说明文件受控并行读。接口形状不变。注意外部编辑说明、说明缺失、祖先被删和并发修订。

5. **启动**（热点意见第 4 条，以及启动拆分表）：
   - 先拆开「HTTP 就绪至首屏渲染（含 WebView）」那 5.3 秒（热）和 8.0 秒（冷）：WebView 创建、导航到页面、界面脚本下载、模块求值、首次渲染、首屏接口，各花多少。可以在 `src-tauri/` 和 `app/server/startup-client.js` 加观测标记。只加标记，不改窗口行为。拆完把意见写进报告：哪段能改、怎么改、收益、风险。原生窗口和界面上的改动先不做，界面部分归 Claude。
   - 再做后端能推迟的：PDF 解析依赖在第一次解析时才加载（`research/parsers/index.js`）；知识库任务恢复用持久的版本或 checkpoint 判断哪些真要恢复，分批让路（`knowledge/jobs.js` start/enqueue）。

6. **小整理**（结构建议第 2–4 条）：
   - 纪要和记忆的默认值只留一份：放在 core 里一个不依赖 services 的配置模块，`settings.js`、`memory/index.js`、`secretary/policy.js` 都引用它。保留原有导出，测试和调用方不用改。
   - 原子写入合并成一个小原语，放在 core 的文件模块：写临时文件再替换，复用现有的 `renameWithRetry`。`core/workspace/files.js`、`desk/storage.js`、`providers.js` saveKeys 都用它。凭据的串行合并和 0600 权限保留。
   - `knowledge/jobs.test.js` 的「enabling semantic indexing backfills cosine edges…」在完整检查并发下偶发失败（2026-10-29 Linux，第 280 行 `neighbours` 为 null）：`semantic.sourceNeighbors` 在 `progress.state !== 'ready'` 时返回 null，疑似 `semantic.idle()` 先于状态变为 ready 就返回。查清后修产品或测试，不要放宽断言。
   - 本地向量模型 worker 的协议测试：启动、并发请求的 id 对应、退出时拒绝未完成请求。用本地小型假 worker 测，不下载模型；需要真实 ONNX 资源的集成测试单独标明。

7. **编辑台场景 1–9 Windows 实测**：
   - 在全新安装的测试产品上，用 OpenCode Go 的 `deepseek-v4.1-flash`，按 `architecture/EDITING_DESK.md` §2 的场景 1–9 各走一遍。
   - 论文用可以公开的材料：开放许可的学位论文或长文，或自己写的五万字中文 docx，含表格、图片和公式；再准备一份 tex 和一份 md。不用 Yui 的稿件，也不提交这些材料。
   - 每个场景记下：通过或不通过、卡在哪一步、看到什么；涉及 AI 的写请求数和 token；关键画面截 100% 和 125% 两张。不修界面，界面问题列给 Claude；后端问题写意见，属于本任务第 1–6 部分范围内的可以顺手修，其余写进报告。

## 可以改的

- `app/services/`、`app/core/`、`app/server/` 及相应测试。
- `src-tauri/` 和 `app/server/startup-client.js`：只加启动观测标记。
- `tools/perf/`。
- 报告 `docs/handoff/reports/P4c.md`，`docs/log/IMPLEMENTATION_LOG.md` 加一条，`docs/product/FEATURES.md` 里和行为变化有关的句子。

## 不做的

- 不改 `app/ui/`，界面归 Claude，包括接入新的批量接口。
- 不做 P4b 结构建议第 5–10 条的大重整（路由下沉、知识库历史接口、文件列表副作用、后台错误类型、批注和记忆的拆分），这些留到 alpha 之后。
- 不改后台功能的产品行为；行为上的取舍写进报告让 Yui 定。
- 不改安装包和更新通道。
- 不动 `<预览安装目录>` 及其数据。仓库是公开的：不提交生成的数据、论文材料、个人路径、截图里的私人内容或密钥。

## 完成标准

- 报告 `docs/handoff/reports/P4c.md`：第 1–6 部分各有修前、修后的数字；启动 5.3 秒的拆分表和意见；场景 1–9 的结果表（通过与否、问题、请求数和 token、截图位置）。
- 每项修复都有测试。批量接口的测试覆盖「要做的」第 2 条列出的情况。
- 干净检出 `npm run check` 全部通过（含 Windows 测试），报通过数。已知的公式编辑不稳定测试如果 Claude 那边还没修好，如实报告，不要跳过或改成通过。
- `tools/perf/` 测试通过，`tools/perf/README.md` 写清新脚本怎么复测。

## 交付

- 分支：`codex/P4c-fixes-perf-20261029`，从 `main` 最新提交开始。每部分完成提交一次。最后报告不超过 15 行，给出远程分支与 SHA，详细内容在 `docs/handoff/reports/P4c.md`。不建 PR、不合并。
