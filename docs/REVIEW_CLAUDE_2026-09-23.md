# ScienceScope 深度审阅与路线建议 · Claude · 2026-09-23

审阅基线：`origin/codex/real-provider-acceptance-20260920`（`abe0d08`），即 Codex 最新推送，
包含 Slice A（共享研究输入/精确引用）与真实 Provider 验收记录。本文件分三部分：

1. 已修复的缺陷（本分支提交，附测试）
2. 已发现但未修改的问题（按严重度，含位置与建议）
3. 设计层面的判断与功能灵感（对标成熟的 AI 科研 harness）

区分原则沿用 AGENTS.md：**已实现 / 已测试 / 仅建议** 分开写，不把建议写成交付。

---

## 0. 总体评价

优点很明确，值得保留：

- **边界清醒**。DSH 负责 agent loop、工具、会话历史；ScienceScope 只做应用编排、SQLite 展示记录与 UI。
  没有重复造 provider/agent 框架，这是最难得的一点。
- **诚实的验收文化**。文档把 fixture、本地回环和付费 provider 验证分开写，失败项（如宿主崩溃）直接记为 FAILED。
- **数据语义讲究**。草稿 revision、ACK 只清理已捕获的批注、重复 userMessageId 拒绝重发、秘书提案必须用户确认——
  这些是很多成熟产品都没做好的细节。
- **安全默认合理**。Markdown 经 DOMPurify 白名单过滤；API 校验 Host/Origin；密钥只进 DSH 凭据存储，
  补丁文件只含 `apiKeyEnv` 引用；技能目录与用户全局 `.agents` 隔离。

主要风险集中在三处：**运行时连接层的健壮性**（本次修了 4 个）、**多专家这一核心卖点尚未落地**、
**研究材料通道过于原始**（没有 PDF 解析、检索与引用核验）。第 3 部分围绕后两者展开。

---

## 1. 本次已修复（本分支）

| # | 问题 | 位置 | 修复 | 验证 |
|---|---|---|---|---|
| F1 | **宿主进程崩溃根因**：`controlReady` 在 `harness.start()` 等待期间可能被 `control-error` 拒绝，此时尚无处理器 → Node 22 的 unhandled rejection 直接终止整个应用宿主（即 09-20 验收中"未注册模型导致 API 宿主消失、窗口仍在"）。 | `adapters/runtime-dsh/host.mjs` startSession | 创建后立即 `controlReady.catch(()=>{})` 标记已处理，消费者仍各自 await 拿到拒绝；补丁写入失败时清理 receiver。 | 用 `node -e` 复现该机制确会退出进程；新测试覆盖未注册模型启动失败后宿主仍可用。Linux 上时序不同未能稳定复现原始竞态，因此属"根因修复 + 机制验证"，**Windows 原生验收仍待本地重跑**。 |
| F2 | **长任务 5 分钟必失败**：`/prompt` 请求带 `timeout: 300000`，这是 socket *空闲*超时；而 `/prompt` 要等整轮 agent idle 才回应，期间 socket 无数据。任何超过 5 分钟的工具循环（文献检索、跑分析脚本）都会被报告失败，**而 DSH 仍在后台继续执行**，界面与运行时状态分叉。 | `host.mjs` send | `/prompt` 去掉空闲超时；轮次由用户"停止"（`/interrupt`）与子进程退出（socket error）界定。其它控制请求保留超时。 | 现有真实 DSH 测试通过；长轮次需本地用真实模型再测一次。 |
| F3 | **流帧序号缺口导致整轮报废**：bridge 在 POST 出错/超时时静默丢帧且不重发；宿主要求 `sequence === prev+1`，之后*所有*帧都被 400 拒绝，`run-idle` 永远收不到 → "stream did not finish delivery"。 | `host.mjs` streamServer | 只拒绝重放（`<=` 已收序号），容忍缺口并计数 `receiver.gaps`。 | 全量测试通过。 |
| F4 | **Provider 错误全部被压成"运行时请求失败"**：用户选错模型 ID、上下文超限、404 都看不到原因。 | bridge / host / `desktop-api.mjs` publicRuntimeMessage | bridge 从 `assistant/attempt` 的 finish 失败中只转发 `code` 与截断的 message；宿主抛出带分类信息的错误；UI 仍只显示固定中文文案，新增"找不到模型""超过上下文"两类。原始 provider 文本不进 UI。 | 新增 `tests/provider-failure-surface.test.mjs`（真实 DSH + 404 fixture）。 |
| F5 | 删除对话后其 DSH 子进程仍驻留，直到被 LRU 裁剪。 | `desktop-api.mjs` `/api/chats/delete` | 删除后释放该对话的 live binding（删除前已校验空闲）。软删除恢复时仍可由已持久化 binding 重新 resume。 | 全量测试通过。 |
| F6 | `npm test` 默认并发在 Windows 上出现 30s 初始化超时（文档记录 101/103）。 | `package.json` | 默认 `--test-concurrency=2`，与文档实际使用的命令一致。未放宽任何超时。 | 104/104。 |

另：README / AGENTS.md 署名加入 Claude（AI 辅助审阅与开发）。

---

## 2. 已发现、未修改的问题（建议 Codex 下一轮处理）

### 高

**H1. 本地 API 没有调用者鉴权。** `desktop-api.mjs:149` 只校验 Host 与 Origin，能挡住网页与 DNS rebinding，
但本机任何进程（包括其它用户会话、恶意脚本、未来内嵌浏览器里跑的本地页面）都可以直接 POST `/api/chat`
且 `executionMode:'full'` → DSH `danger-full-access`，等于一个无口令的本地代码执行入口。
建议：沿用已有的 `shutdownToken` 模式，启动时生成 per-launch bearer token，经 Tauri 注入 WebView，所有 `/api/*` 校验。

**H2. Tauri capability 的 remote 范围过宽。** `src-tauri/capabilities/main.json` 允许 `http://127.0.0.1:*`，
任何回环端口页面（DSH 自己的 web profile、用户开发服务器）只要进入 ScienceScope 窗口就拿到窗口 IPC 权限。
建议运行时收窄到宿主实际端口，或在 Rust 侧校验 origin。

**H3. 研究材料以 JSON 转义字符串交给模型。** `scripts/research-input.mjs:116` 把整篇材料 `JSON.stringify` 后嵌入消息：
换行变 `\n`、LaTeX 反斜杠加倍、引号转义。模型阅读质量下降，且转义膨胀会让 64k 字符的 `.tex/.csv`
超过 `MAX_MATERIAL=128000`，**整条发送被拒绝**而不是截断。
建议改成带属性的标签块，正文保持原样：

```text
<material id="res-…" title="draft_v3.tex" path="…" truncated="false">
…原文…
</material>
<quote source-chat="…" message="…" speaker="assistant">…选中文字…</quote>
```

元数据仍可保留一份紧凑 JSON 作为回执；预算按原文长度计算。

### 中

**M1. 每个对话一个 DSH 子进程。** Main 保留 3 个、助手保留 2 个空闲进程（`desktop-api.mjs:80`、`assistant-chat-service.mjs:103`）。
Slice B 多专家若沿用"每位专家一个进程"，4 专家 × 数个对话会迅速吃满内存，冷启动也慢（Windows 上初始化已接近 30s 超时）。
见 3.1 的建议：专家用 DSH 进程内 subagent。

**M2. 会话补丁文件只增不删。** 每次启动会话都写 `session-patches/*.json|yaml` 和 `temp/research-context/*.json`，
从不清理。建议 `harness.start()` 成功或失败后删除本次补丁，或启动时清理超过 N 天的文件。

**M3. 路径重复嵌套。** `research-context.mjs` 默认 `instructionHome = join(home,'.sciencescope-local','dsh',…)`，
而 `home` 本身已是 `.sciencescope-local/dsh`，实际路径为 `.sciencescope-local/dsh/.sciencescope-local/dsh/research-instruction-home`。
`host.mjs` 的 `localRoot` 同理。不影响功能，但 Portable 单一根目录（Slice G）前应统一。

**M4. 非文本材料只给路径。** PDF/DOCX 未解析，模型只能靠文件工具读原件；而多数模型的文件工具读 PDF 得到的是乱码或无内容。
对学术工作站来说这是**使用路径上的第一道墙**，建议优先级高于多数设置页（见 3.2）。

**M5. 附件预算按顺序先到先得。** `chat-attachments.mjs` 共享 64000 字符预算，第一份长文会挤掉后续所有材料（后续只有"未提取"说明）。
建议按份均分或按用户标注的优先级分配，并在回执里显示每份实际进入上下文的字符数。

**M6. `/api/chat` 输入类型校验靠后。** `userMessageId`/`assistantMessageId` 在 `??=` 之后没有类型/格式校验就进入 SQL 与 DSH，
非字符串会变成 500。助手通道已有 `/^[A-Za-z0-9_-]{1,160}$/` 校验，Main 应一致。

**M7. "工作方式"切换只写一条系统消息。** `desktop-api.mjs:322` 明确说"尚未接入多专家调度"。
这是诚实的，但也说明产品名义上的核心（多模型交流）目前仍是单模型。

### 低 / 工程卫生

- 前端通过重新赋值原型全局函数叠加行为（`messageHTML = function…` 在 `markdown.mjs`、`research-input.mjs`、`turn-activity.mjs`
  各包一层）。顺序依赖隐式，某个模块漏加载就静默回到原型行为（AGENTS.md 已记录过这类事故）。
  建议保留视觉不变，但加一个显式的 `messageRenderers` 注册表，由一个入口按固定顺序组合。
- `DESKTOP_IMPLEMENTATION.md` 已 90KB，是按日期堆叠的日志。建议拆成 `CHANGELOG.md`（按日期）+ `docs/adr/`（决策）+
  一页"当前状态"，否则新 agent 每次都要读完全部历史才能判断哪条已被覆盖。
- 大量单行长函数（例如 `research-input.mjs` 的 `annotationEditor`）不利于 review 与 diff。可以在下次触碰时顺手格式化，不必单独大改。

---

## 3. 设计判断与功能灵感

对标对象（功能层面，不复制代码）：Google **AI co-scientist**（生成—辩论—进化的多智能体锦标赛）、
Stanford **STORM / Co-STORM**（多视角专家圆桌 + 主持人 + 动态思维导图）、FutureHouse **PaperQA2**（带引用核验的文献问答）、
Ai2 **OpenScholar / ScholarQA**、OpenAI / Gemini **Deep Research**、Sakana **AI Scientist**、**Agent Laboratory**、
**NotebookLM**（严格以来源为据）、**Elicit / Undermind**（系统综述式检索与数据抽取）、Zotero 生态。

### 3.1 多专家：把"交流"做成可审计的结构，而不是多个聊天框

ScienceScope 的差异化在"多模型交流"。成熟系统的共同经验：**多智能体的价值来自结构化分歧，而非并行发言**。建议：

1. **实现方式：DSH 进程内 subagent。** 已安装的 `@deepseek-ai/dsh-subagent` + `dsh-subagent-spawn-in-process` + `dsh-tool-subagent`
   支持 continuable child、按 child 覆盖 `provider/model/reasoningEffort`、中断与后代列表。每位专家 = 一个 continuable child，
   其 persona 即专家 prompt、模型可以不同（真正的"多模型"），在同一 DSH 进程内运行、历史独立。工具与工作区的继承规则需按该包 README 再核对。
   这比每专家一个 SDK 进程省一个数量级的资源，并天然满足"每位专家一个可复用子代理"。
2. **有序讨论 = 冻结输入 + 并行独立作答 + 固定展示**（已在交互契约中定义）。补一个关键环节：
   **盲评阶段**——每位专家先独立作答，再看到他人答案做一轮"质询/修正"。独立性是避免从众（anchoring）的关键，
   这是 co-scientist 与 debate 类研究的核心发现。
3. **分歧矩阵（Disagreement Map）**：由秘书抽取每位专家的主张 → 对齐成"论点 × 专家"表：同意 / 反对 / 未表态 / 证据引用。
   用户一眼看到共识和真正的分歧点，并可以就某一格追问。这是 ScienceScope 最能体现"发现盲点"的界面。
4. **标准化角色库**：方法学家、统计审稿人、领域专家、魔鬼代言人（Red Team）、可重复性检查员、写作编辑。
   每个角色附"必须检查的清单"（如统计审稿人：样本量、多重比较、效应量、前提假设），比泛泛的人设 prompt 稳定得多。
5. **锦标赛模式（可选、昂贵）**：多个假设/方案 → 两两对比由评审专家打分（Elo）→ 保留高分并让生成者改进。
   适合"研究问题/实验设计头脑风暴"场景，按需开启，显示预计调用次数与费用。
6. **模型多样性提示**：同一模型不同 persona 的分歧是"表演出来的"；不同厂商模型的分歧更有信息量。
   专家配置页可以提示"当前全部专家使用同一模型"。

### 3.2 文献与证据层（建议作为 Alpha 后第一优先）

1. **PDF/DOCX 解析管线**：本地优先（如 PyMuPDF / pdfplumber / GROBID 抽取标题、作者、章节、参考文献；DOCX 用 mammoth/pandoc）。
   解析结果作为资源的"派生文本"存入资料库，原件不变；页码/章节成为批注定位的真实坐标（替代现在手填的 location）。
2. **分块检索（RAG）而非整篇塞入**：SQLite FTS5 起步即可（零依赖，已在用 `node:sqlite`），之后再加向量。
   模型通过一个 `search_library` 工具按需检索，返回片段 + 资源 ID + 页码。这样 64k 预算不再是瓶颈。
3. **引用核验（PaperQA2 / OpenScholar 的核心）**：回答中的每个 `[资源ID:页码]` 引用，由秘书或规则回查原文片段是否支持该句；
   不支持的标红。对学术用户，"AI 引用了不存在或不支持的文献"是最大的信任杀手。
4. **学术检索 MCP**：DSH 已带 `dsh-mcp-client`。接 OpenAlex / Semantic Scholar / arXiv / Crossref / PubMed 的 MCP server，
   即可"找文献 → 一键入库 → 解析 → 可引用"。OpenAlex、Crossref、arXiv 都有免费访问层，适合作为默认数据源（具体配额以各自当前政策为准）。
5. **Zotero 双向集成**：读取用户 Zotero 库（本地 SQLite 或 Web API）、按集合导入、导出 BibTeX / CSL-JSON。
   研究者的文献早就在 Zotero 里，这比让他们重新上传更容易被接受。
6. **引用网络视图**：以项目资料为种子展示被引/施引关系（类似 Connected Papers / ResearchRabbit），用于发现漏读的关键文献。

### 3.3 研究过程的可追溯性（ScienceScope 已有的版本/日志思路可以再进一步）

1. **Claim–Evidence 台账**：项目级表格，每条主张记录"来源（文献/实验/专家讨论）、置信度、反证、状态"。
   专家讨论、秘书整理、用户批注都往这里汇总，研究导图的节点可以链接到台账条目。
2. **决策日志（Research ADR）**：每次"用户决定下一步"自动生成一条：备选方案、选择、理由、否决原因。
   半年后写论文方法部分或回复审稿人时非常有用。
3. **实验/分析可复现包**：DSH 执行的脚本、输入数据哈希、环境、输出，打包附到版本记录上。
4. **Checkpoint / 分支**：DSH 有 `session-checkpoint-policy`；把"从此消息分支"做成真正的运行时分叉，
   而不仅是展示层前缀复制。

### 3.4 写作与交付

- LaTeX/Markdown 数学公式渲染（KaTeX）——目前 Markdown 白名单里没有数学支持，理工科用户会立刻注意到。
- 审稿式反馈模式：按期刊审稿意见格式（主要问题 / 次要问题 / 需要的附加实验）输出，可逐条转成任务。
- 回复审稿人助手：把审稿意见拆条 → 每条关联修改位置与证据 → 生成回复信草稿。
- 引文格式化与参考文献检查（DOI 可解析、条目重复、预印本已正式发表的提示）。

### 3.5 成本、用量与可观测性

- 运行前预估：多专家/锦标赛展示预计请求次数与 token 区间；运行中显示累计费用；超预算暂停。
  DSH 已上报 usage（验收记录里有 input/cache-read/output），缺的只是聚合与预算闸门。
- 每轮的"谁用了什么模型、多少 token、调用了哪些工具"写入回执，方便复盘与论文中的 AI 使用声明。
  越来越多期刊要求披露 AI 使用方式，这可以成为一个导出功能："生成本项目的 AI 使用声明"。

### 3.6 建议的优先级（在现有 Slice B–G 基础上微调）

1. **先修 H1（API 鉴权）与 H3（材料格式）**——小改动，影响面大。
2. **Slice B 多专家**：采用 3.1 的 subagent 实现 + 盲评 + 分歧矩阵，这是产品的身份。
3. **PDF 解析 + FTS5 检索 + 引用核验**（3.2 前三条）——让"真实材料"通道可用。
4. Slice C–G 按原计划；Portable 前统一 M3 的路径。
5. 学术检索 MCP、Zotero、KaTeX——单项成本低、用户感知强，可穿插。

---

## 4. 本次实际运行

- `npm ci`；`node --test --test-concurrency=2 tests/*.test.mjs`：**104/104 通过**（含新增 1 项真实 DSH 测试），Linux x64、Node 22。
- 未运行需要 Windows/Tauri 原生窗口或 Playwright 浏览器的 smoke 脚本；未调用任何付费 Provider；仓库内未加入任何密钥。
- F1 的原始竞态在 Linux 上未能稳定复现（启动失败先于 control-error 返回），修复依据是机制验证与源码分析，
  请在 Windows 上用原先失败的"未注册模型"UI 路径重跑一次验收。
