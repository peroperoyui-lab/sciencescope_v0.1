# T09 · 记忆整理（会话摘要、空闲整理）与记忆评测集

共同规则见 `docs/tasks/RB_COMMON.md`。借鉴：Mem0 的抽取 → 对照 → ADD/UPDATE/NOOP；Letta 的空闲时后台整理；Generative Agents 的反思；LongMemEval 的题型（备忘录 §1）。

## 目标
不需要用户或模型主动说"记住"，系统在后台整理出候选记忆，**仍然全部经过用户确认**；同时建立一个能衡量"记忆有没有用"的评测集。

## 后端 `scripts/research-base/consolidate.mjs`（新模块）
1. **触发**：对话空闲超过 N 分钟（默认 10，可在设置中调整或关闭），或用户点击"整理这段对话"。每个对话每次只处理新的消息区间（记录已处理到哪条消息），不常驻进程。
2. **会话摘要**（情景记忆）：用便宜模型（设置中选择，默认与主专家相同的 Provider）生成 ≤ 300 字的摘要，包括做了什么决定、还有什么未决问题、用到了哪些资料的引用标签，
   写为 `memory/episode`，链接到对话（ref `chat`）。这一类**低风险**，可按设置自动接受，但界面上保留"撤销"。
3. **候选抽取**：从同一区间抽取候选（决定、约定、偏好、目标、未决问题、经验；知识、主张、模型只抽取有原文依据的），
   对每条候选用 `retrieval.search`（仅 item）找出 top-5 相似条目，再由模型判断 `create | supersede(targetId) | update(targetId) | noop`，
   对非 noop 的调用 `store.propose`，origin 记为 `{role:'consolidator', chatId, range}`，并附上证据（消息 ref）。
   **来自网页或文献的内容必须标为 external**，在 payload 中注明来源，防止记忆投毒。
4. **提示词与解析**：结构化输出（JSON Schema），解析失败时丢弃并记录日志，不重试刷费用；每次整理的 token 预算有上限。
5. 路由：`POST /api/research/consolidate {chatId}`、`GET /api/research/consolidate/status?chatId=`；设置中增加开关、空闲时间和使用的模型。

## 评测 `scripts/evals/memory-eval.mjs`
- 构造 30–50 题的项目记忆评测集（存放在 `tests/fixtures/memory-eval/`，内容为虚构项目）：
  题型包括单次会话事实、**知识更新**（先定 A 后改 B，问现在是什么）、时间推理（"改之前是什么"）、跨会话、拒答（从未提过的事）。
- 流程：用本地夹具生成若干会话 → 执行整理 → 自动接受 → 新开对话提问 → 用规则或便宜模型判断答案对错。报告准确率，以及简报命中数、检索命中数、拒答是否正确。
- 同时报告"不整理"的基线分数，用来证明整理确实有价值。真实模型的分数单独写进 DESKTOP_IMPLEMENTATION。

## 验收
- 单元测试：用本地模拟模型返回固定 JSON，验证触发、区间推进、去重、supersede 目标正确、外部内容被标记、预算上限。
- 评测脚本能跑通并输出报告；smoke：空闲整理后收件箱出现提议，接受后下一轮简报中出现。
