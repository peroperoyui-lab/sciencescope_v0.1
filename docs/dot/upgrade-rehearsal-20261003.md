# C · 数据保留升级演练 · 2026-10-03

**PASS（已测 Linux 代表性数据范围）；未发现数据丢失或迁移阻塞。** 五个精确节点通过旧宿主 API 造数据，再由固定最新产品代码 `edf02f33ccb720c1e0d9178cb03a11ea28f47052` 打开**原数据目录**。270 条基线记录、26 个原件/项目文件、67 个 API 视图保留；SQLite integrity/FK 检查通过；迁移/后台错误 0。不是 Windows 安装包、WebView2、签名或完整 alpha 发布验收。

| 旧节点 → edf02f3 | 基线记录 / 表 / 文件 / API 视图 | 结果 |
|---|---:|---|
| 98e560a | 40 / 29 / 4 / 10 | PASS |
| 7eaa4aa（第 1 批） | 49 / 38 / 4 / 13 | PASS |
| a3e79e2（第 2 批） | 52 / 41 / 6 / 13 | PASS |
| 46f4e8f（第 3 批） | 60 / 46 / 6 / 15 | PASS |
| edf02f3（当前重启控制） | 69 / 46 / 6 / 16 | PASS |

- 数据：Unicode 项目/归档项目/置顶、主与独立对话和真实 DSH 历史、专家人设/讨论/审核采纳、两版用户权威纪要、标记/引用草稿、原件/已采纳旧知识及来源关系、三角色自定义提示词、偏好、系统 Python 项目/对话绑定及设置、当前版真实分支谱系/草稿。不存在的旧功能明确 `unsupported-old-version`，不是失败或假造。
- 升级后：逐条原主键/原列值核验，文件哈希核验，API 原有效载荷核验；主/独立对话续聊和隔离、标记/引用/原件实际消费、专家实际运行、当前分支上下文隔离通过。最终矩阵 64 次 localhost 请求，付费 0。
- 合法变化限定：重启将 outbox 置暂停（`scripts/chat-outbox.mjs:37–39`）；Python resolve revision 是进程内计数（`scripts/python-env/environments.mjs:106,110`）；仅新增停用默认审核人（`scripts/expert-roster.mjs:78–96`）、已有原件的 source catalog 与旧 knowledge 的 mirror（`scripts/research-base/index.mjs:21–43`）。自定义角色/所有用户纪要版本保持原值；未放宽任意内容差异。

## 凭据迁移

**合成 localhost 认证迁移 PASS，不是实际 OpenCode key/远端模型验收。** 精确 46f4e8f 的真实 DSH API 保存并使用随机 dummy；最新代码与再次重启在同一 home/session 使用同一引用与 Provider 配置，旧 `.credentials.yaml` 删除，`secret/credentials.yaml` 全文语义/字节相同，Linux 0700/0600。重复 2 轮、6 次认证；日志/事件/模型正文/压缩历史无 dummy 泄漏。凭据回归 4/4。证据只记录结果/存在状态，不含凭据或凭据摘要。

## 复跑与证据

分支 `dot/upgrade-rehearsal-20261003`；无产品改动、PR 或合并。历史 GitHub Git API 原始对象经 blob/tree/**含签名 commit** 哈希逐项匹配，装入独立普通仓库，真正 detached worktrees；不是完整历史 clone。每节点自己的锁文件 `npm ci`/`npm ls`/API import 通过（448/505/505/531 包，Node 24.19.0）。当前依赖链接到相同锁文件的现有本地安装，不交付依赖链接。

- 全矩阵：`node scripts/rehearsal/run-upgrade-matrix.mjs`
- 小范围：`node scripts/rehearsal/credential-upgrade.mjs`（真实旧/新/重启 localhost 认证）
- 历史对象重建：`python3 scripts/rehearsal/materialize-historical.py --git-dir <普通仓库.git> --metadata-dir <已获授权GitHub对象JSON> --sources-dir <项目.sciencescope-local/temp下路径>`；先供应 hash 验证的 blob batches；没有 Git CLI 认证或完整远端 clone 的假设。
- 最终矩阵：`.sciencescope-local/temp/dot/upgrade/matrix-pvnA2U/summary.json`（各节点 baseline/API/SQL/模型上下文/日志在同目录）
- 历史来源/依赖：`.sciencescope-local/temp/dot/upgrade/source-metadata/historical-sources.json`、`logs/`
- 凭据：`.sciencescope-local/temp/dot/upgrade/credentials/summary.json`
- 机器结果：`docs/dot/upgrade-rehearsal-20261003.json`
- 原失败未删除：遗漏 localhost 配置 patch 所需 session header；把安全暂停/进程计数/合法新增记录误当差异；旧分钟摘要尚未静止而 API/停机 SQL 快照不同；关闭未完摘要导致旧运行时无最终文本。只修演练夹具：分钟 refresh/readiness 后再用户编辑、停机视图与 SQLite 最新版本相等断言；不忽略纪要版本。详情路径在机器结果。

未测：Windows 安装包/原生 ACL；真实远端 key；托管 Python 安装/包升级；排队/在途 outbox；秘书/全局助手历史/工具回执；任意生产用户数据或所有历史提交。结论只覆盖这五个节点的代表性数据。
