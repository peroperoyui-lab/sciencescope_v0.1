# X1 技能：导入、启停、目录进提示词、读取工具和角色绑定

- 起草：Claude，2026-10-19。依据：`plans/X_TOOLS_SKILLS_MCP.md` §2、§4（用户 2026-10-19 已定）；`decisions/DECISIONS.md` 2026-10-19 技能两条。
- 执行：Sol（Windows）；审阅：Claude。约 2 小时，一步交付；超出就停下汇报（第 5 条工具清单可以拆出去）。

## 目标

1. 用户导入 `SKILL.md` 格式的技能后，所有角色（专家、秘书、全局助手）都知道它在，需要时自己读来用。
2. 角色定义里绑定的技能，在那个角色开口前就已经读好。
3. 程序能带内置技能，用户改的是复制品，更新不会覆盖。

## 用户会怎么用

- 用户从网上下了一个「文献综述写作」技能文件夹，在技能页导入（界面 Claude 做）：文件夹被复制进 `data/skills/literature-review/`。之后让主专家写综述，时间线里出现「使用技能 · 文献综述写作」，回答按技能里的步骤来。
- 用户在专家角色里给统计审稿人绑定这个技能：统计审稿人每次开口时正文已在它的提示词里，时间线里不会再有那一步。
- 用户关掉一个技能：所有角色的提示词里不再出现它，`use_skill` 也读不到。
- 技能文件夹格式不对（没有 `SKILL.md` 或 YAML 头缺 `name` / `description`）：导入失败，原因可读，例如「这个文件夹里没有 SKILL.md」。

## 要做的

1. **技能存储** `app/services/skills/`：
   - 两个来源：用户技能 `data/skills/<name>/`（`core/paths.js` 已有 `skills`），内置技能 `app/resources/skills/<name>/`（新目录，先放一个最小的示例技能供测试，正文 Claude 在 X0 写）。同名时用户技能优先。
   - 解析 `SKILL.md` 的 YAML 头（`name`、`description`，其余字段原样保留），正文不解析。
   - 导入：从一个文件夹或 `.zip` 复制进 `data/skills/`，名字冲突时报可读错误，不覆盖。「复制内置技能」：把内置技能复制到 `data/skills/` 同名文件夹。删除：只能删用户技能。
   - 启停：设置 `skills.disabled`（名称数组，默认 `[]`），存储值和读它的地方都要有。
2. **目录进提示词**：上下文组装（`app/services/context-assembly.js` 拼系统提示词的地方）给每个角色加一小节「可用技能」，每行 `名称：说明`，只列启用的；没有启用的技能时整节不出现。加一句用法：「需要时用 use_skill 读正文，再照着做」。
3. **工具 `use_skill`**：加进 `TOOL_SPECS`（所有角色共用），参数 `{ name }`，返回正文和技能文件夹的绝对路径（正文里提到的相对路径据此读）。名称不存在或已停用时返回可读的话，不报错。不需要批准。
4. **角色绑定**：角色定义（`core/agent-file.js`）里已有的 `skills` 字段接上：组装提示词时把绑定的、启用的技能正文放进该角色的系统提示词（放在「可用技能」一节之后，标明技能名）。绑定了但已停用或已删除的技能跳过，不报错。
5. **工具清单接口**：`GET /api/tools` 返回所有工具 `{ name, source: 'builtin' | 'sciencescope' | 'skill' | 'mcp', server?, description, needsApproval, enabled }`，技能也作为一项列出（`source: 'skill'`）。X2 会往里加 MCP 工具，接口形状这次定好。另加技能的接口：列出（含来源、启用、绑定它的角色）、读正文、导入、复制内置、删除、启停（或用设置读写，选一种并在报告里写明）。
6. **文档**：`docs/product/FEATURES.md` 加技能一节，删掉「`skills` 字段没有消费者」那句；`docs/log/IMPLEMENTATION_LOG.md` 不超过 5 行。

## 可以改的

`app/services/skills/`（新）、`app/resources/skills/`（新）、`app/services/tools.js`、`app/services/context-assembly.js`、`app/core/agent-file.js`、`app/core/workspace/resources/settings.js`、`app/server/routes/`（新 `skills.js`、`tools.js` 及注册处）、打包配置里把 `app/resources/` 带进安装包的部分、相关测试、`docs/product/FEATURES.md`、`docs/log/IMPLEMENTATION_LOG.md`。

## 不做的

- 不改 `app/ui/`；技能页、工具页、专家角色里的勾选由 Claude 做。
- 不写内置技能的正文（Claude 的 X0），不做 MCP（X2），不做插件包。
- 不给技能加批准；技能里的脚本照常走命令工具的批准。
- 不动 `<预览安装目录>` 及其数据。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）。
- 功能测试：导入一个测试技能 → 主专家的系统提示词里有它的目录行 → 脚本模型调用 `use_skill` 拿到正文；停用后目录行消失、`use_skill` 返回可读的话；给秘书绑定后秘书提示词里有正文；格式不对的文件夹导入失败并给出原因；用户技能与内置技能同名时用用户的。
- 真实模型：OpenCode Go `deepseek-v4.1-flash`，导入一个写明固定输出格式的小技能，问一个相关问题，确认模型调用了 `use_skill` 并按格式回答。报告请求数和 token。
- 打好的 Windows 包里 `app/resources/skills/` 在（报告里写一句）。

## 交付

- 分支：`codex/x1-skills-YYYYMMDD`，从集成分支最新提交开始。报告不超过 15 行，给出远程分支与 SHA，写明技能接口和 `/api/tools` 的字段。不建 PR、不合并。
