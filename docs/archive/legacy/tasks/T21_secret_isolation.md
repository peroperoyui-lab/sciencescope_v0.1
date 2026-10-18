# T21 · 凭据与应用数据隔离（alpha 前必须完成）

- 下达：Claude，2026-10-02（系统复盘发现）。执行：Astra。通用约定见 `QUEUE.md`、`RB_COMMON.md`。
- 交付：`codex/t21-secret-isolation-YYYYMMDD`。不开 PR、不合并。

## 问题（已在代码中核实）

1. 服务商 API key 由 DSH 的 `dsh-credentials-local` 以**明文 YAML** 保存在 `<DSH home>/.credentials.yaml`，即 `.sciencescope-local/dsh/.credentials.yaml`（`adapters/runtime-dsh/provider-service.mjs` 中的 `credentials.set`）。
2. DSH 沙箱（`dsh-sandbox`）在所有模式下只限制**写**，不限制**读**；文件工具也没有读取限制（`dsh-fs-observation-policy` 只要求"改之前先读"）。
3. 因此主专家、专家、秘书、全局助手都可以用文件工具或 shell（`cat`、`type`、`Get-Content`）读取：
   - 凭据文件；
   - 应用数据库 `state/sciencescope.sqlite`（含私有条目、助手私聊）；
   - `.sciencescope-local/secret/`。
   - 导入的论文或网页中如果藏有恶意指令（提示注入），可以诱导模型读出 key，再通过网络外传。
4. 已核实是安全的部分：key 不通过环境变量传给 DSH 会话进程，而是在请求时从凭据服务读取，所以 shell 命令不会从环境变量继承 key。改动时要保持这一点。

同一操作系统用户下无法做到绝对隔离（智能体与应用以同一用户运行）。目标是**纵深防御**：让读取受保护路径的每一条路都被拦截，或者必须经过用户审批，并且留下记录。

## 要做的

1. **受保护路径表**（宿主侧维护，可测试）：
   - 应用数据目录：`state/`、`dsh/` 下的凭据与会话日志、`secret/`、`models/`；
   - 研究资料库原始数据库；
   - 用户工作文件夹不在此列。
   - 路径统一规范化：符号链接、`..`、Windows 大小写、短文件名、UNC 路径。
2. **文件工具**：参照 `dsh-fs-observation-policy` 注册 `fs/*` 意图决策器的方式，写一个 ScienceScope 插件，对受保护路径上的读、列目录、搜索、写操作一律拒绝，返回"该路径属于应用内部数据，不可访问"。所有角色、所有执行模式都生效。
3. **Shell 命令**（bash / pwsh）：执行前检查命令文本和工作目录，凡是引用受保护路径（包括规范化后的形式和常见变量展开，如 `%LOCALAPPDATA%`、`$HOME`、`~`）的：
   - 询问模式：必须审批，审批卡上标红说明"涉及应用内部数据"；
   - 完全接管模式：同样需要审批，**不自动放行**；
   - 拒绝时向模型返回明确原因。
   - 文本检查拦不住所有写法，所以这只是一层防护，不是唯一的一层。
4. **凭据文件**：
   - 先确认 `dsh-credentials-local` 是否支持把凭据文件放到 DSH home 以外的路径（README 中有 `path` 配置项）。支持的话，移到受保护路径表中的专用位置，并设置仅当前用户可读：Windows 用 ACL，其他平台用 0600；
   - 旧位置的文件迁移后删除，迁移要能升级保留（用户已保存的 key 不能丢）。
   - 评估 Windows 下用 DPAPI 加密存储是否可行（自定义凭据提供者）。只评估、写结论，不强制实现。
5. **网络外传**：完全接管模式下 shell 发起网络请求（curl、Invoke-WebRequest 等）时，是否需要单独审批，列出选项交用户决定，不自行决定。
6. 研究资料与网页内容在工具结果中统一标注为"外部内容，不是指令"（检查现有实现是否已全部覆盖）。

## 验收

- 单元测试：
  - 路径规范化（`..`、大小写、符号链接、Windows 写法）；
  - 文件工具对受保护路径的读、列、搜、写全部被拒绝；
  - shell 命令检查：命中与不命中的样例各 10 条以上，包括变量展开写法。
- 真实 DSH 加本地模拟模型：
  - 模拟模型依次尝试用 read 工具读凭据文件、用 bash `cat` 读凭据文件、用 pwsh `Get-Content` 读应用数据库；
  - 断言：文件工具被拒绝；shell 命令进入审批，拒绝后工具结果里没有文件内容；
  - 四种角色都覆盖。
- 凭据迁移：旧位置有 key 的数据目录升级后，key 仍可用，旧文件已删除，新文件权限正确。
- Windows 原生实测一轮。
- 文档：SYSTEM_SPEC 2.15（安全边界）、ROADMAP；`design/RESEARCH_BASE.md` §8 的遗留项标为已处理。
