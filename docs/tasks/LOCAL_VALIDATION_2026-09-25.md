# 本地完整验收：`claude/determined-pasteur-jxpzw8` 合并前

- 下达：Claude，2026-09-25；执行：Codex，在用户本机 Windows 上执行。
- 目的：在真实 Windows 原生客户端上验证这条分支的全部改动，再做 T04 和 T10，**由用户根据结果决定是否合并到 main**。你不开 PR、不合并。
- 先读：`AGENTS.md`、`docs/SYSTEM_SPEC.md`（重点 2.2、2.4、2.5、2.16、2.17）、`docs/DESKTOP_IMPLEMENTATION.md` 顶部 2026-09-24 和 2026-09-25 的几节、`docs/tasks/RB_COMMON.md`。
- 交付分支：`codex/local-validation-YYYYMMDD`，从 `claude/determined-pasteur-jxpzw8` 新建；分阶段提交，每个阶段结束推送一次，报告分支名和 SHA。
- 工作区：先确认 H 盘的实际工作区和远端（AGENTS.md）；外接盘不可用时停下报告，**不要改用 D 盘备份**。
- 付费测试用便宜模型（OpenCode Go 的 flash 系列），key 放在 Git 忽略的 `.sciencescope-local/secret/`。真实模型结果与本地模拟结果分开记录。
- **停止条件**：某一阶段出现失败时，如实记为 FAILED，写清复现步骤、截图和日志摘要，然后停下报告；不要为了过关而删减功能、跳过测试或改测试预期。
  如果修复很小（一两行）、原因明确，而且只在本阶段范围内，可以修复后注明；否则停下。

## 阶段 0 · 同步与基线（只测不改）
1. `git fetch origin`，检出 `claude/determined-pasteur-jxpzw8`，记录 SHA（应不早于 `12b305e`）。
2. `npm ci`，然后 `node scripts/build-desktop.mjs`、`npm test`。记录通过数和失败数；已知 `expert-discussion-runtime` 在满负载时偶发失败，失败时单独重跑一次并注明。
3. 用已安装的 Edge 跑浏览器 smoke：chat-ui、discussion-ui、marks-ui、research-input-ui、settings-ui、workspace-ui、desktop-navigation、failed-send-draft、workbench-ui、shortcuts-ui、extensions-ui、background-chat。
4. `desktop-interaction-smoke` 在 main 上本来就失败（夹具缺少口令和 research-input 路由）。请修好它的夹具，让它通过，并在报告中单列。
5. `cargo build`（或项目现有的原生构建脚本），启动原生客户端。

## 阶段 1 · 原生客户端验收（这条分支的界面与交互）
每项都在**原生窗口**中操作，截图保存在 `.sciencescope-local/temp/local-validation/`，浅色、深色各一张（能切换的项目）。

**界面刷新（2.16）**
1. 主页、对话、设置各页、命令面板、右键菜单、数据库页、工作站和导图、任务秘书栏、全局助手窗口、悬浮球：布局没有溢出或截断，深色模式没有白色块。
2. 设置中的正文字号、代码字号、减少动画仍然生效。
3. Esc 可以停止正在运行的回复；复制消息后显示"已复制"；底部状态栏显示运行时是否已连接。

**专家讨论（2.5）**
4. 工作模式中输入 `@` 出现专家菜单，回车只插入名字不发送；发送后只有被 @ 的专家回答。回答中专家能正确说出自己的身份。
5. 有序讨论：切换参加的专家、选择审核专家；发送后各专家并行作答，状态标签依次变化；审核专家在最后作答。
   点"加入后续上下文"后，下一轮主专家的回答能引用审核结论。
6. 工具前导语：让主专家读取一个项目文件。正文里不应出现"我先读取……"之类的话，这句话应显示在工具记录卡片上。
7. 工作方式菜单里已经没有"自由讨论"和"互相质询"。

**标记（2.4）**
8. 在对话里连续划选三处文字并写备注，每次都不弹对话框；输入框出现"标记 3"，点开后能定位、修改、移除。
9. 在右侧文件预览（md 或 txt 文件）中划选文字添加标记，定位能打开预览并高亮。
10. 发送后，回答确实用到了这些标记；消息下方显示可读的回执。

**研究资料库（2.17，后端，暂无界面）**
11. 导入 1–2 个 md 或 tex 文件，调用 `POST /api/research/sync {"projectId":null,"wait":true}`，然后问主专家资料里的内容。
    回答中应出现 `[S1]` 这类引用；`GET /api/research/usage` 能看到 brief、search、read 的记录。
    可以参考 `scripts/evals/research-base-live.mjs`，也可以在原生客户端里操作。
12. 让主专家"把 X 记为本项目的约定"，确认 `GET /api/research/proposals` 中出现了提议，并且模型**没有**用 bash 去翻应用数据目录（查看工具记录）。

**关闭与进程**
13. 关闭应用后，宿主和 DSH 的子进程全部退出（按 AGENTS.md 的进程树要求观察 PID），并且没有残留的命令行窗口。

报告：逐项写"通过 / 失败 / 未测"，附截图路径。**阶段 1 有任何失败，就停下报告，不要进入阶段 2。**

## 阶段 2 · T04 文档解析与阅读器
按 `docs/tasks/T04_document_parsers_and_viewers.md` 完成。验收时额外要求：
- 用用户下载的真实论文（至少 5 篇，中英文都要有；**不要提交论文原件**）检查解析效果：页码、章节、公式、参考文献是否被正确识别，以及扫描件是否被正确标为"不支持"。
- 在原生窗口中截图：PDF 阅读器、定位高亮、在 PDF 上添加标记、聊天中的公式渲染。

## 阶段 3 · 导入真实论文并做检索评测（T10 的评测部分，先不实现混合检索）
1. 把用户下载的论文全部导入（按项目或个人资料库），记录每篇的解析状态和总耗时。
2. 按 `docs/tasks/T10_vector_retrieval.md` §5 建立评测集：至少 50 个问题，覆盖中文问英文论文、同义词或缩写、公式或变量名、换说法、记忆类问题。
   **标准答案由用户确认**（可以先由你起草，再请用户审核），标注放 `tests/fixtures/retrieval-eval/`。
3. 先只测**现有的关键词检索**：直接检索的 R@1、R@5、R@10，以及"由模型检索"时最终引用是否正确（便宜模型）。
4. 然后在本机运行 `scripts/evals/embedding-bench.mjs` 的方法（按脚本头部说明安装依赖，用 `--ignore-scripts`），用同一批论文和问题测：
   multilingual-e5-large 与 bge-m3（能下载到哪个就测哪个，把下载来源写清楚），每种都测单问法和双语问法。
   记录每段嵌入耗时、500 篇规模的推算时间、查询 P50 / P95、内存峰值，以及本机 CPU、内存、系统版本。
5. 把结果写进 DESKTOP_IMPLEMENTATION，形成数据表格，并明确哪些是实测、哪些是推算。**不要实现 T10 的混合检索**，等用户和 Claude 看过数据再决定。

## 最终报告（写在 DESKTOP_IMPLEMENTATION 顶部，同时回复用户）
- 分支名和各阶段的 SHA。
- 阶段 0–3 的结果汇总表（通过、失败、未测），以及失败项的复现步骤。
- 真实模型调用次数、使用的模型、大致费用。
- 你对"是否可以合并到 main"的意见和理由。**合并与否由用户决定。**
