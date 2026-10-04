# T24 · 智能体长度限制与可恢复输出

状态：实现、Windows 验证和三轮来源审计完成，已推送，停止等待 Claude 审阅。

远端分支 **`codex/t24-limits-20261004`**，功能提交 **`e5833e48a88bc4f39bd31bd1f965da6c749e86fe`**，已推送并用 `ls-remote` 完整SHA核验；本报告的交付收据补充由后续纯文档提交保存，最终分支HEAD在交付回复中报告。不开PR、不合并。

唯一工作区 `H:\ScienceScope_v0.1-desktop`，origin `https://github.com/peroperoyui-lab/sciencescope_v0.1.git`。分支 `codex/t24-limits-20261004`；产品基线 `18476bdeac101d466505c6bf8c8adc838336635e`，任务书与用户 A2 决定快进纳入至 `29e4cef746e7f5f8740053f47cabbd6f47f8b19a`。前置 T09 已合并，没有叠在未合并任务上。未开 PR、未合并共享分支。

## 行为与边界

- 模型发现、编辑、保存链路保留名称、上下文与输出容量。未知时显示 DSH 默认最大输出 32768，用户可改或清除覆盖；下一轮空闲时释放进程、恢复原会话应用配置。DSH profile 不区分发现值和用户覆盖的来源，不把保存配置冒称服务商确认。
- 主专家、私有助手与专家达到 `max-tokens` 时保留已生成内容，包括只有未完成工具参数、没有可见文本的情况。未完成工具不执行。用户可显式继续原会话；新回复追加保存，已有回答、草稿和材料保留。专家继续使用宿主持久化的子会话、角色、技能、工具与审批绑定；浏览器不能指定子会话。未完成审核不可采纳；继续完成后仍由用户决定。自动化回答也保留正常的模型上限状态，仍在运行的目标须先由用户暂停。
- 秘书提议、研究提议、纪要及复合引用去掉原语义长度/成员限制。内部 RPC 64 MiB 超限返回明确 413；研究记录等资源拒绝保持已有数据和提议完整。长标题显示折叠，原文本保留。
- 纪要输入、人设、简报、状态节点/待办与检索问法保持全文；超长 parser 段落无损分段，保持来源和可信字符偏移。原件/目录独立于 FTS、向量索引，可删除重建。阅读结果分页并说明如何继续；项目简报明确是概览，可用 `research_read` 获取全文。向量过滤分批后统一稳定排序，对话查阅使用稳定排序和 offset 分页。
- 默认模型提示和工具说明删除“简洁回答”等长度偏好；用户保存的自定义提示词与已绑定角色快照不改。
- T21 受保护路径、私有范围与审批不放宽。D 项仅盘点，数量及用户输入政策保持原状。没有新增依赖或修改 `ScienceScope.html`。

## A2 用户成本设置

每次整理的累计 `tokenLimit` 默认 **100000**，输入和输出均计入，可修改或关闭。请求前估算，包含完整输出预留；请求后优先使用服务商报告的实际总用量。缺失/全零用量保守估算并在状态注明。预算不足跳过后续请求，已生成输出和来源/决策检查点保留，未完成批次不推进游标，下次继续。来源或模型变化后重新规划过时检查点。每条候选仍进入收件箱，用户确认前不是有效记忆；网页/文献保留 external。

默认参考旧 T09 的 54 阶段已知用量：P50 **9969**、P95 **15641**、最高 **17084**，100000 约为最高的 5.85 倍，也可容纳两次 32768 输出预留加常见输入。这些旧样本受旧上限约束，是默认设置的参考下界，不是无上限成本预测。服务商价格缺失不能解释为免费；估算未精确涵盖 DSH 固定系统提示及全部历史开销，不构成严格账单或上下文窗口保证。

跨窗来源通过独立原文页生成带逐字引文、定位的观察，再分页比较。观察仍是待确认模型内容；逐字引文存在不证明整条推论正确。判断冲突或单条完整观察装不下时明确保留 pending，不推进候选/游标。解析或证据错误不自动刷分重做。

## Windows 验证

| 阶段 | npm test | smoke / 原生 | 证据 |
|---|---|---|---|
| 合并基线 18476bd | 333/333，0 fail/cancel/skip，474686.7684 ms | 32/32；原生冷启动首次保存服务商 200，重载保留 | `.sciencescope-local/temp/t24-validation/baseline/`；`baseline-native/run-v2eB3A/` |
| 首次候选验收，原失败保留 | 364/368；4 个旧断言与新设计不符 | 原 memory 标签断言及新 UI locale 夹具失败 | `final/suite-nf8hoh/` |
| 修复旧断言与夹具后 | 369/369，601060.4281 ms | memory UI、新 browser/native PASS | `final/repair-qQD1ZY/`；运行时 drain 修复同时改动 3 文件，因此不是最终冻结代码证据 |
| drain 后完整验证 | 369/369，602123.1551 ms | 31 既有 + 新 browser/native，34/34含npm | `verified/suite-f08CfM/`；后续纯词条及明确自动化/失败续写修复另验 |
| 最后完整代码，含自动化和失败续写修复 | 371/371，0 fail/cancel/skip/todo，672531.5857 ms | i18n、discussion、chat UI/API、goal、browser/native通过；额外 policy 旧 mock 修后单跑通过 | `final-frozen/affected-8cVNZ2/`；npm 起讫源码零漂移；原9项8pass/1mock失败记录保留 |

基线 308 源码哈希未变，96 个观测自有 PID 正常退出。原生首次保存测试在 provider GET 尚未结束时提交；这是实际 DSH 设置服务、本地 dummy 凭据，不是付费模型测试。未注入设置进程启动失败/下次重试，不能声称验证了该故障链。

新增验收使用**真实 DSH + 本地模拟 provider**，与真实模型评测分列：长/空 `length`、同 Main 会话、同专家子会话、审核完成后采纳、长秘书/研究提议、助手失败草稿保留、GUI 保存容量后下一请求实际应用、整理 token 设置持久化。`verified/suite-f08CfM/` 34/34（npm + 31 既有 smoke + 新 browser/native）；615 个周期观测自有 PID 正常退出，无强杀。自动化/失败专家续写修复的最终 npm 及受影响 smoke 已核对，不重复不受影响的检查；最后 affected 流水235个周期观测自有PID正常退出。

截图目录均位于 `H:\ScienceScope_v0.1-desktop\.sciencescope-local\temp\t24-validation\output-ui\`：

- browser `run-obV5Bp/`，native `run-SbsmGg/`：每组 18 次本地 provider 请求，真实 DSH。每组 16 图为 `main-output-limit`、`expert-review-continued`、`provider-output-settings`、`cost-settings` 的 `{zh,en}-{light,dark}.png`；Main 74815 字、秘书提议 76817 字、研究提议 76017 字完整保存，下一次模型请求实际 maxTokens=72000，成本设置 250000 重载保留。
- 原 `cost-settings` 全页截图未滚到 token 输入；另 `budget-visible-{zh-CN,en}-{light,dark}.png` 各四图复用已持久化的数据，只渲染，无 DSH 或模型请求，完整显示预算 250000 和“i”。render-only 夹具缺 `startSession/send` 使功能 flag 隐藏造成三次失败；修夹具声明并禁止模型调用，不修改产品 CSS。native 拍照后正常关闭窗口导致 evaluate 收到 Target closed、命令 exit1；截图/receipt 已保存，独立核实 shell 退出，未把它冒称完整进程树验证。
- root 人工复核英文深色 Main 继续、中文浅色模型容量和英文深色预算。截图等待有限 CSS 动画完成并保存 computed 颜色；此前过渡中间帧不冒称产品配色缺陷。

新增 T24 UI 验收累计13个 run 的 **148 次本地 provider 请求，paid=0**（早期失败76＋verified36＋最后36）；预算render-only0请求，不重复加算。单元套件内本地模拟模型调用不计入该 UI 专用总账，也不是付费请求。最后真实 DSH browser `run-27li1j/`、native `run-YvDHYG/` 各18请求及16截图通过，完整内容/同会话/采纳/容量/预算证据与前次一致；预算可见补图位于前次目录。最后313项源码起始、npm后、结束三点哈希一致；235个自有PID正常退出。结束后仅旧策略 smoke 脚本 mock 修复，root核 current-vs-end 唯一变化该脚本，产品代码没有变化；独立 `final-frozen/policy-repair.log` exit0保留，原失败不覆盖。截图、状态、dummy 凭据和生成资源不进 Git。

国际化：对 `18476bd` 实际提取新增 **52** 中文片段，新增 untranslated=0。项目既有全部 missing 单独记录，不冒称整个项目翻译已清零。证据 `audit/i18n-final-delta.json`、`audit/i18n-final.log`。

## 真实模型三轮对照

只用 `deepseek-v4.1-flash`。24 案例：旧/新各 3 轮，每轮 4 案例。论文为既有八篇语料中的 17 页真实文献，169 段、56852 原文字符，完整输入 63506 字符；A2 的 lumen、61 消息窗口、协议尾部修订是明确标注的合成语料。来源夹具 SHA `623f5606e3c895b5e125866f2941e18c09d0514bb643921f3d3ebb9bcdeb195f`，依赖锁 SHA `83aeb6edbc54bb529e43f5bcea727a1a43be4b8dfa01832153d149f9fec196e5`。

论文通过 direct noTools runtime 验证输出终态、原会话继续和逐句来源支持，**不是生产 Main UI 的付费验收**；UI/API 用真实 DSH 本地 provider 独立验证。A2 直接使用生产公开 consolidator/stores 与真实 DSH，候选由评测夹具逐条确认以观察后续历史；产品不会自动确认。

固定最多 174 有效模型步骤，传输重试另计；每案例 600 秒，最多 3 次有效论文调用，只在 typed `max-tokens` 后发送同一继续指令。新 A2 质量组将用户成本设置关闭，不用它遮盖长度问题；默认预算行为由确定性回归验证。

**评测修订与失败原样保留：**

1. 第一个 old-r1-science 持续返回 reasoning SSE，但代理绝对 120 秒截止切断；共 5 物理请求、1 有效步骤、4 自动重试，均未报告 usage。随后评测凭据扫描把 dependency junction 当普通文件读取触发 EISDIR。该案例作为基础设施失败保留、从未重发；修扫描并本地验证。共享代理增加可配置截止，默认仍 120 秒，旧 ledger 禁止改截止；余下案例统一 590 秒请求/600 秒案例。
2. new-r1 三个 A2 案例模型均 200/stop/DONE，但模型结束时本地交付队列未排空，宿主误报 MODEL_FAILED。保留完整 wire、应用失败/游标与原会话；修复 drain 后只继续未尝试案例，不重跑这些失败。
3. DSH 日志由多个串接 zstd 帧组成，初版评测解压只取首帧，误得到 header-only。实际原会话完整；用逐帧解压离线恢复，保存独立收据/全文派生文件，原记录不覆盖。不能据此声称 DSH 未持久化。
4. `manifest-frozen.json`、r2、r3 及前后候选镜像全部保留。r3 包含明确交付 barrier 修复和多帧 capture；已有 9 个案例不重发，只派发其余 15 个。不同冻结版本与截止修订使这是透明的修复过程验证，不能作为严格同版本因果实验。

**论文三轮已完成来源审计。** 统一预定 19 项事实、6 项限定：covered=1、partial=0.5、absent=0；字数不计分。运行完成=单次正常 completed，或模型上限后原会话继续到 completed。事实覆盖、限定覆盖、额外无依据论断各自记录，不能互相替代。

| 组 / 轮 | 运行完成 | 事实 covered/partial/absent → 分数 | 限定 covered/partial/absent → 分数 | 全部逐句 flags / 其中 material |
|---|---|---|---|---|
| 旧 1 | 基础设施失败，排除质量分母 | 无完整答案 | 无完整答案 | 不计 |
| 旧 2 | 0；provider length 无宿主终态，未继续 | 16/3/0 → 17.5/19 | 5/0/1 → 5/6 | 25 / 10 |
| 旧 3 | 0；provider length 无宿主终态，未继续 | 12/2/5 → 13/19 | 5/1/0 → 5.5/6 | 7 / 0 |
| 新 1 | 1；79 字 partial，原会话续写完成 | 18/0/1 → 18/19 | 4/1/1 → 4.5/6 | 26 / 8 |
| 新 2 | 1；22207 字 partial，原会话续写完成 | 19/0/0 → 19/19 | 5/1/0 → 5.5/6 | 24 / 8 |
| 新 3 | 1；单次正常完成，不需继续 | 18/0/1 → 18/19 | 3/2/1 → 4/6 | 18 / 8 |
| 旧均值（2 可评分轮） | 0% | 15.25/19，80.26% | 5.25/6，87.50% | 缺陷数量不是总论断准确率 |
| 新均值（3 轮） | 100% | 18.33/19，96.49% | 4.67/6，77.78% | 缺陷数量不是总论断准确率 |

运行完成和实质事实覆盖改善，限定覆盖没有改善，仍不能称回答全部有依据。新回答含未供给的 JCR 发布时间、WoS 类目、出版方政策及可靠性阈值；部分将原文“提及”改为“允许”、过强断言缺失信息或可复现性，并有数值复算错误。material 数量只是审核分层，旧 3 的 0 不表示被截断答案质量完美。旧 1 从未重发；对照存在上文版本/截止变化，不能作严格因果估计。

**A2 三轮 18 个案例终审完成。** 客观成功标准：lumen=游标6/纪要v2且当前UTC正确；window=游标61及全部6条明确事实保存；tail=当前21天且旧14天历史保持。额外错误单记提议质量，不能用产生提议数量代替核心事实覆盖。初始阶段失败原样保留，即使修订阶段接续检查点后成功。

| 组 / 轮 | lumen | window | tail | 客观成功 / 3 | raw 候选完整支持 | 实际提议完整支持 |
|---|---|---|---|---|---|---|
| 旧 1 | 初版完成；修订比较8192推理耗尽 | 只发22条；网络恢复后8192推理耗尽 | stop 的 fenced JSON 被拒绝 | 0/3 | 12/12 | 2/2 |
| 旧 2 | 成功6/v2，UTC supersede | 完成22/61，仅2/6事实 | 8192推理耗尽，零文本 | 1/3 | 6/7 | 5/5 |
| 旧 3 | 初版完成；修订8192推理耗尽 | 完成22/61，仅2/6事实 | 完整抽取后旧输入预算拒绝比较 | 0/3 | 11/12 | 3/4 |
| 新 1 | 应用流交付失败 | 61条/候选已返回，应用交付失败 | 应用交付失败 | 0/3，3项infra | 15/16（仅描述） | 0/0 |
| 新 2 | 初版无效证据；修订接续完成6/v2 | 完成61，5/6事实；frequency 被noop | 成功21/14历史 | 2/3 | 18/20 | 13/14 |
| 新 3 | 成功6/v2，UTC supersede | 成功61、6/6事实，含2额外错误 | 成功21/14历史 | 3/3 | 15/18 | 9/11 |
| 旧均值 / 汇总 | 同题1/3成功 | 同题0/3 | 同题0/3 | 平均0.33/3；1/9=11.11% | 29/31=93.55% | 10/11=90.91% |
| 新均值 / 汇总 | 同题2/3 | 同题1/3 | 同题2/3 | 平均1.67/3；5/9=55.56%；排infra后5/6=83.33% | eligible 33/38=86.84% | 22/25=88.00% |

新组 r1 没有可评分应用结果，不给模型质量填零；其候选全文质量单列描述，不加入 eligible aggregate。0/0 没有提议不是100%准确。整体核心任务完成改善，提议全文支持率没有提高，不能称记忆准确率提高。new-r2 窗口实际读61条但 noop 漏频率；new-r3 核心6事实都保存但“少数无新增”与55/61多数矛盾，另“不能推断常规周期”违背#1明确10分钟。new-r2 一个项目名被推成研究目标并接受；旧r3 一个未供给的英文别名轻微附加也按统一全正文标准计错。全部8个未支持候选、原消息定位、是否实际形成提议见 [来源审计](T24_SOURCE_AUDIT_2026-10-05.md)。

new-r2/new-r3 tail 确实比较完整4079字旧协议，尾部14天可见并正确 supersede 成21天、保存快照/链接。付费新候选正文均未超过3000字符，不能把本次付费实验当成>3000候选接收证据；该路径用确定性 provider 单独验证。new-r2 的初版失败后检查点恢复导致两阶段提议末尾统一确认，比较时 items 为空；旧r2/newr3 初版先确认再修订有 supersede 目标可见。这是真实时序差异，不冒称为检索故障或严格等条件实验。原始全文/wire/日志留忽略目录，逐句来源审计已附云端报告。

**真实用量总账已终结：**24 个案例，55 物理请求 = 49 有效模型步骤 + 6 自动传输重试，0 被预算拦截请求。48 次报告用量，7 次未知；prompt 351233 + completion 428428 = **779661 已知 token**。未知请求未估成 0；缓存/推理为上述用量子集，不另加算。没有手动重发已尝试案例，显式长度继续和任务书下一修订阶段分别保留。

| 组 / 轮 | 物理 / 有效 / 重试 | 已知 input / output / total token | usage 未知 |
|---|---|---|---|
| 旧 1 | 12 / 7 / 5 | 24286 / 26098 / 50384 | 6 |
| 旧 2 | 8 / 8 / 0 | 42471 / 49209 / 91680 | 0 |
| 旧 3 | 8 / 8 / 0 | 42420 / 64672 / 107092 | 0 |
| 新 1 | 6 / 6 / 0 | 70062 / 84562 / 154624 | 0 |
| 新 2 | 12 / 11 / 1 | 96027 / 118641 / 214668 | 1 |
| 新 3 | 9 / 9 / 0 | 75967 / 85246 / 161213 | 0 |

基础设施终结失败 4 案例：旧 1 论文代理截止、以及新 1 三个 A2 应用流交付。传输错误中旧 1 window 的 1 次 ECONNRESET、新 2 lumen 的 1 次 ECONNRESET 均自动恢复；旧 1 science 的 4 重试未恢复，不重复加成新案例。旧输出/输入预算、完成 JSON 格式错误、无效证据和 noop 丢事实属于产品/模型行为，不能归入传输失败剔除。首次扫描失败的进程树关闭回执缺失，如实留限制；之后 23 案例均有正常关闭证明。

所有模型 wire、逐题 ledger、原会话日志、reservation、清单和哈希收据保存在 `live/`、`audit/`。root 再次核对 r3 冻结文件、24 终态和实际 ledger 去重：`audit/final-paid-review.json`。本次没有预验额外付费调用；此前 T09/T10 账单不加入 T24。

## 发现 → 原因 → 修复 → 验证

| 发现 | 原因 | 最小修复 | 验证 |
|---|---|---|---|
| 达输出上限后抛无最终文本错误 | 宿主把只有工具片段或空文本的 length 视为失败 | typed max-tokens 正常终态，保留内容、不执行未完成工具 | 真实 DSH 本地输出回归 |
| 保存模型容量后实际请求仍旧值 | 保存白名单丢字段，已有运行进程保留旧配置 | 白名单容量字段；下轮空闲释放并恢复原会话 | provider capacity 单元＋GUI 下一请求实际 72000 |
| 继续失败覆盖主/助手已有草稿 | 恢复路径把继续指令当编辑草稿 | 继续分支不替换用户草稿或材料 | API 隔离＋真实 DSH UI 失败验收 |
| 专家继续按钮消失、审核完成不立即可采纳 | 通用 workspace 同步删除控件，旧 expert metadata 未刷新 | 按角色同步、回填 metadata、审核动作立即刷新 | UI/原生及 cold continuation |
| user receipt 显示“继续”、预校验拒绝却 HTTP 200 | 状态绘制未限定 assistant；过早写响应头 | assistant-only；accepted 后写头 | API stale/invalid 与 UI |
| 大量细粒度流 token 后误报交付失败 | `/prompt` 等 generation idle，未等 queued presentation delivery | 公开 Cordis service drain barrier，不增固定等待时间 | 1600 tiny SSE deltas + 每次 3 ms 持久化，积压 >4 秒，全量/终态/usage 通过 |
| 自动化 length 被标 failed，空 partial 丢记录 | 自动化独立 projection 未覆盖 max-tokens、只存 truthy 文本 | 正常 receipt，空 string 也持久化 | 旧代码先失败/修后通过，completed/cancel/error 对照 |
| 专家继续 error/aborted 后不能再恢复 | 无条件消费 predecessor.continued_to | 仅正常 completed/max-tokens 消费；失败尝试记录保留 | 旧代码先失败；修后 API 4/4，error→冷重开→aborted→冷重开→length→冷重开→completed，同子会话、客户端伪造身份无效、失败审核不可采纳 |
| 更多检索问法/结果仍被下游截断、分页重复漏项 | vector-store 残留 6/30，按分页深度 RRF 与距离 tie 重排 | 全问法，下游宽松资源拒绝，统一稳定排序后分页 | vector/context 回归 |
| 超长纪要纠正区间缺中间原文、观察 quote 拆分丢支持 | 区间引用未展开；来源页组合使证据碎片失配 | 完整区间原文、独立来源页精确 quote 及跨窗观察状态 | A2 43/43 确定性回归 |
| failed 整理流在状态不可见 | 未提交的 stream 与成功 output 共用推断 | 保留 committed:false 输出收据，timeout 不伪装提交 | A2 失败/恢复回归 |
| 首轮四单元断言/一个 smoke 失败 | 新设计移除 concise/8192；设置新增一列；新夹具 zh 与 zh-CN 不符 | 更新设计断言和夹具，保持原日志 | 后续完整套件 |
| 英文深色截图按钮白色 | 抓到 120 ms CSS 过渡中间帧，实际 computed 色正确 | 截图等待有限动画完成，记录 computed 色，不盲改 CSS | 最终四组合截图与颜色收据 |
| 初版真实评测终结及原会话 capture 错误 | 绝对代理截止、junction 扫描、串接 zstd 仅解首帧 | 可配置截止、常规文件扫描、逐帧离线恢复 | proxy 9/9、本地扫描回归、多帧哈希收据；不重发已失败付费案例 |
| 额外 dsh-policy smoke 在注册保护说明处失败 | 旧 mock 缺 systemPrompt/public setup 和 session append；脚本久未进入既有31套件 | 补公共SDK mock、保原goal/ask断言，验证sandbox事件、HTTP400必须拒绝和prompt drain，try/finally清理 | 独立修后exit0；产品策略不改，旧失败记录保留 |

## D 盘点，仅建议

| 保留限制 | 当前值 | 后续建议 |
|---|---|---|
| 主/助手问题及 Main 草稿 | 64000 字符 | 用户决定后放宽资源上限，独立验证输入/草稿流程 |
| 发送队列每条文本/总条数 | 20000 字符 / 20 条 | 用户决定，不在 T24 改数量 |
| 每轮专家 / 审核专家 | 8 / 8 | 用户决定数量及显示方式 |
| 附件/材料引用、对话引用、文件标记 | 8、16、32 | 用户决定；选中文本/备注各 8000、材料组合 128000 也列待审 |

上传 20 MiB、导入 100 MB、公开本地 API 资源限制、工具活动显示预览、安全参数格式、目标轮数 256、评测步骤预算保持。秘书模型提议草稿属于 A 的明确要求，已去语义限制，不能混作 D 的普通用户消息政策。

## 文件与任务差异

本次改动 66 文件（最终 Git 收口再次核对）：

| 文件 | 改动目的 |
|---|---|
| `adapters/runtime-dsh/assistant-stream-bridge.mjs` | committed terminal/usage、流交付 drain |
| `adapters/runtime-dsh/host.mjs` | 正常 length/空输出、usage、专家继续、64 MiB RPC |
| `adapters/runtime-dsh/provider-service.mjs` | 容量字段保存、默认值与来源 |
| `adapters/runtime-dsh/session-control.mjs` | 长输入、专家原子会话继续、工具提议、delivery barrier |
| `desktop/assistant-chat.mjs` | 私有助手继续及草稿保留 |
| `desktop/chat.css` | 模型上限状态样式 |
| `desktop/discussion.mjs` | 专家继续、审核采纳及按角色同步 |
| `desktop/i18n-en.mjs` | 所有新增中文片段的英文词条 |
| `desktop/live-chat.mjs` | Main 继续及草稿/材料保留 |
| `desktop/memory-consolidation.mjs` | token 设置、跳过原因、已保留输出 |
| `desktop/model-settings.css` | 容量表单现有布局内样式 |
| `desktop/model-settings.mjs` | 最大输出展示、编辑、发现、保存 |
| `desktop/provider-draft.mjs` | 容量白名单及正整数校验 |
| `desktop/research-base.css` | 长标题折叠显示，hover 展开 |
| `desktop/workspace.mjs` | assistant-only 继续状态、expert metadata 刷新 |
| `scripts/assistant-chat-service.mjs` | length receipt、继续身份/陈旧校验、下轮容量刷新 |
| `scripts/assistant-conversations.mjs` | 完整秘书提议/草稿、宽松资源拒绝 |
| `scripts/chat-minutes.mjs` | 完整消息输入和长纪要 |
| `scripts/chat-store.mjs` | additive `max-tokens` completionStatus |
| `scripts/context/research-tools.mjs` | 删除 concise 偏好 |
| `scripts/context/sources/conversation.mjs` | 全问法、稳定排序和分页 |
| `scripts/context/sources/status.mjs` | 完整节点/待办 |
| `scripts/context/sources/workspace.mjs` | 完整查询 |
| `scripts/context/tools.mjs` | 完整工具参数说明与证据规则 |
| `scripts/desktop-api.mjs` | 三种继续 API、终态、容量刷新、A2 模型容量 |
| `scripts/discussion-service.mjs` | partial、持久子会话绑定、继续/失败恢复、审核前文 |
| `scripts/dsh-policy-smoke.mjs` | 额外策略 smoke 的旧公共 SDK mock 补齐、HTTP失败必须拒绝、资源清理；产品策略不改 |
| `scripts/evals/hybrid-live-retrieval.mjs` | 评测代理可配置截止，旧 ledger 守护 |
| `scripts/execution-service.mjs` | 自动化 length/空回答正常持久化 |
| `scripts/expert-roster.mjs` | 长人设，资源拒绝 |
| `scripts/memory-consolidation-ui-smoke.mjs` | 新预算字段后的真实布局/标签断言 |
| `scripts/research-base/citations.mjs` | 完整复合成员及异常资源保留 |
| `scripts/research-base/consolidate.mjs` | A2 全文分批、成本、检查点、观察、失败输出 |
| `scripts/research-base/hybrid.mjs` | 完整问法 |
| `scripts/research-base/index.mjs` | 删除 concise 偏好 |
| `scripts/research-base/search.mjs` | 完整查询、宽松分页、概览全文回查 |
| `scripts/research-base/store.mjs` | 长提议、无损 parser 分段、记录资源拒绝 |
| `scripts/research-base/vector-store.mjs` | 下游完整问法和稳定排序 |
| `scripts/role-settings.mjs` | 长人设、默认长度措辞移除、保存快照不改 |
| `tests/context-access.test.mjs` | 全文/分页与跨页稳定性 |
| `tests/context-tools.test.mjs` | 新完整查询契约 |
| `tests/discussion-api.test.mjs` | partial 非失败及未完成审核不可采纳 |
| `tests/execution-service.test.mjs` | 自动化 length/empty/completed/cancel/error |
| `tests/expert-continuation-runtime.test.mjs`（新增） | 真 DSH cold child、角色/技能/工具/审批 |
| `tests/hybrid-live-proxy.test.mjs` | 截止可配置及 ledger 不可改 |
| `tests/hybrid-live-runtime.test.mjs` | 默认证据规则而无 concise |
| `tests/memory-consolidation-api.test.mjs` | 新设置 schema |
| `tests/memory-consolidation.test.mjs` | A2 分批/成本/缺用量/冲突/恢复/来源边界 |
| `tests/memory-eval.test.mjs` | 新真实请求容量，不再断言旧 8192 |
| `tests/model-output-runtime.test.mjs`（新增） | length/empty/usage/413/交付积压 |
| `tests/model-settings.test.mjs` | 容量设置与旧 provider 编辑契约 |
| `tests/output-continuation-api.test.mjs`（新增） | Main/助手/专家继续隔离、冷重开、失败恢复 |
| `tests/provider-capacity.test.mjs`（新增） | 发现/保存/清除/应用容量 |
| `tests/research-citations.test.mjs` | 长复合引用与未知原文 |
| `tests/research-hard-limits.test.mjs`（新增） | 长字段/纪要/parser、资源拒绝保持数据 |
| `tests/research-hybrid.test.mjs` | 超旧限制问法 |
| `tests/research-tools-runtime.test.mjs` | 真实 DSH 证据规则 |
| `tests/research-vector.test.mjs` | 多问法、更多结果、tie 稳定分页 |
| `tests/role-settings.test.mjs` | 新默认措辞、原绑定不重写 |
| `docs/DESKTOP_IMPLEMENTATION.md` | 顶部日期验收记录 |
| `docs/README.md` | 新报告索引 |
| `docs/ROADMAP.md` | T24 交付与后续顺序 |
| `docs/SYSTEM_SPEC.md` | 行为、状态、容量与整理限制同步 |
| `docs/design/RUNTIME_PORT.md` | additive 终态/usage/continueExpert/容量及上游限制 |
| `docs/T24_LIMITS_REPORT_2026-10-05.md`（新增） | 本报告 |
| `docs/T24_SOURCE_AUDIT_2026-10-05.md`（新增） | 各轮论文/整理逐条来源审计，供云端审阅 |

任务书范围外的最小必要扩展：`assistant-stream-bridge` 为明确交付缺陷；`execution-service` 为自动化输出 receipt 遗漏；`vector-store` 为下游硬限制和排序；`workspace` 为继续控件/metadata；`chat-store` completionStatus additive；`provider-draft`/model UI 为容量字段闭环；`scripts/evals/hybrid-live-retrieval` 为共享评测截止，仅可配置、默认行为不改；memory UI smoke 与旧测试断言随新设计更新。均有对应回归，无新架构/运行时 fork。

仍有限制：上游 pi-ai 会按可用上下文扣除 4096 输出安全余量，未 fork 依赖；真实 gateway 仅返回模型 ID，不能验证服务商真实容量；整理模型可能产生 unsupported 候选、noop 丢事实或语义重复，用户确认仍必要；本次直接 runtime/A2 验证不代表付费生产 UI 全链路、安装包、升级或签名。D 产品取舍、alpha 后操作系统出网控制和 T23/T06/T07 均未实施。

验收与来源审计完成，功能提交已在远端。暂存曾被0字节遗留index.lock阻止，确认没有活动Git进程后将锁保存到本地忽略目录，再提交；暂存前/后扫描均无真实key或本地产物入Git。源审计拼接的CRLF/末尾空行已清理，`git diff --check`通过。交付后停止，等待 Claude 审阅，未开始T23/T06/T07。
