# 成熟 Agent / Harness 交互参考

核对日期：2026-09-17。以下为官方文档／官方仓库的功能事实及本轮取舍；没有复制其源码、品牌图形或整套应用。界面外观继续采用用户已认可的 ScienceScope 方案。星数随时变化，本稿不以星数作质量排名。

| 项目与一手资料 | 确认的功能/思路 | ScienceScope 本轮吸收 |
|---|---|---|
| OpenAI Codex：命令与快捷键 https://developers.openai.com/codex/app/commands （当前重定向至 https://learn.chatgpt.com/docs/reference/commands） | 对话置顶、归档、重命名、未读；跨对话搜索与对话内查找分开；深链接；浏览器操作快捷键 | 同对象省略号／右键菜单；固定“浏览全部”；消息位置、查找、日期及快捷键显示。具体快捷键是本原型选择，不宣称全部与 Codex 默认相同 |
| OpenAI Codex：审阅 https://developers.openai.com/codex/app/review | 查看变化，在具体差异位置留意见，接续工作指令 | 保留文件预览、差异和多条意见一次发送；用户截图决定摘要浮层的位置和风格 |
| Claude Code Desktop https://code.claude.com/docs/en/desktop | 可调整的工作面板；面板独立弹出并回接；Normal/Verbose/Summary 信息密度；会话用量与账户用量的入口不同 | 非模态窗口与侧栏、侧栏宽度调整、执行记录密度切换；占用／缓存独立悬停 |
| OpenCode TUI https://opencode.ai/docs/tui/ | 文件引用、命令和快捷键、模型/会话切换、工具细节切换、会话导出 | 搜索与命令入口、输入附件、轻量的选项菜单；不在本轮仿做 terminal UI |
| DeepSeek Harness 官方用户指南 https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/user/guide/index.md | 完整 Web UI 中配置模型、选择工作目录与启动会话；现成完整应用是起点 | 保留模型与 API 页面、项目入口、消息／工具输出。正式接线尽量复用完整 DSH 已有能力，而非按原型重新发明后端 |
| Goose 官方仓库 https://github.com/aaif-goose/goose | 桌面与 CLI，模型服务和 MCP 扩展接入，自定义发行版 | 设置中的模型／扩展入口按真实连接状态呈现；本轮不扩大插件管理架构 |
| OpenHands 官方仓库 https://github.com/OpenHands/OpenHands | 开源 Agent 应用与执行环境组合，面向实际任务的开发入口 | 用“能开始工作、看到执行与结果”检验入口完整性；没有据 README 推断细节控件，也没有替换 DSH |
| Cline Checkpoints https://docs.cline.bot/core-workflows/checkpoints | 工作状态/文件快照比较与恢复；大型仓库的检查点有成本 | 比较变化与是否恢复分开；轻量删除撤销；完整版本回退沿用项目记录，不为了模仿另建全仓快照系统 |
| Gemini CLI 快捷键 https://geminicli.com/docs/reference/keyboard-shortcuts/ | 输入编辑、剪贴板、快捷操作及平台差异说明 | 粘贴附件、输入法不误触、快捷键说明；终端专属快捷键不照搬至桌面 |

## 本轮取舍

采用的是可发现的操作、一致的菜单、清晰的上下文读数、不中断主工作的面板、搜索／跳转和可撤销的轻量修改。用户原有的三个一级入口、研究工作站下部布局、秘书与导图是 ScienceScope 自己的产品设计。

没有为了吸收亮点新增独立权限后台、跨模型调度平台或扩展注册框架。专家的工作侧重继续通过 system prompt 表达，项目日常整理主要由会议秘书承担，用户决定研究下一步。每位专家一个可复用子代理的要求继续保留。

原型的示例占用是 46,080 / 128,000（36%），最近请求输入 12,800，其中缓存读取 10,240（80%），输出 640。它们只是测试展示不同指标的计算关系，不能解读为真实模型或订阅数据。
