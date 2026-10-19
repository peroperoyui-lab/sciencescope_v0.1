# X2 MCP 服务器：添加、连接、工具接入和批准

- 起草：Claude，2026-10-19。依据：`plans/X_TOOLS_SKILLS_MCP.md` §1、§2、§4（用户 2026-10-19 已定）；`decisions/DECISIONS.md` 2026-10-19 MCP 批准一条。
- 执行：Sol（Windows）；审阅：Claude。约 2 小时，一步交付；超出就停下汇报。依赖：X1（`/api/tools`）、C1（批准规则）已合并。

## 目标

1. 用户添加一个 MCP 服务器后，它的工具出现在所有角色的工具表里，专家能直接调用。
2. 「请求批准」模式下 MCP 工具每次先问，「总是允许」可以按服务器放行。

## 用户会怎么用

- 用户在 MCP 服务器页添加（界面 Claude 做）：名称「Zotero」，命令 `npx -y 某某-zotero-mcp`，填一个密钥。保存后马上连接，显示「已连接 · 8 个工具」。让专家「从 Zotero 里找关于双重差分的文献」：卡片问是否允许「Zotero · 搜索文献」，用户选「总是允许 → Zotero 的所有工具」，以后不再问。
- 用户从 Claude Desktop 的配置里复制了一段 `{"mcpServers": {...}}` 粘进来：几个服务器一起被识别并添加，其中的密钥自动移到凭据文件。
- 服务器启动失败（命令不存在、密钥错）：状态显示可读原因，例如「启动失败：找不到命令 uvx」，其他服务器和对话不受影响。
- 用户关掉一个服务器或其中一个工具：之后的回答里工具表不再有它。

## 要做的

1. **客户端** `app/services/mcp/`：用官方 TypeScript SDK `@modelcontextprotocol/sdk`（MIT，从 npmmirror 装，写进 `package.json`；不要依赖 DSH 带进来的 `@modelcontextprotocol/client`，R5 会删）。支持本地命令（stdio）和网址（Streamable HTTP，旧服务器的 SSE 能接就接）。
   - 本地命令的 `PATH` 先放 ScienceScope 自带的 Node 和 uv，这样 `npx` / `uvx` 不用用户另装；`npx` 用设置里的 npm 镜像，`uvx` 用 pip 镜像（沿用现有镜像设置）。
2. **配置和密钥**：设置 `mcp.servers`：`[{ id, name, transport: 'stdio' | 'http', command?, args?, url?, env?, headers?, enabled, disabledTools: [] }]`。`env` 和 `headers` 里的密钥值存进 `secret/credentials.yaml`（`services/providers.js` 现有的凭据文件和引用方式），设置里只存引用。
   - 粘贴识别：接受 Claude Desktop / Cursor 的 `{ "mcpServers": { 名称: { command, args, env } | { url, headers } } }`，以及只有里面一个服务器对象的写法。
3. **连接**：程序启动时连接启用的服务器；断开后下次调用前重连一次；添加或修改后立刻连接并返回状态 `{ status: 'connected' | 'failed' | 'disabled', toolCount, error? }`。程序退出时关掉所有子进程（不留残留进程，这是 alpha 标准之一）。
4. **工具接入**：每个工具以 `mcp__<服务器 id>__<工具名>` 加进所有角色的工具表，说明和参数用服务器给的（JSON Schema 直接转给运行时；转换不了的参数结构在报告里列出）。工具结果里的文字照常返回，图片按 C2 的 `{ text, images }` 返回。`/api/tools` 加上这些工具（`source: 'mcp'`、`server`）。
5. **批准**：「请求批准」模式下 MCP 工具每次走 `approvals.request`，摘要写「服务器 · 工具」和参数；C1 的范围候选加一项 `server`（「这个服务器的所有工具」），规则同样按项目记。「常规」模式不问。
6. **接口**：MCP 服务器的列出（含状态）、添加、修改、删除、粘贴导入、重新连接。
7. **文档**：`docs/product/FEATURES.md` 加 MCP 一节；`docs/log/IMPLEMENTATION_LOG.md` 不超过 5 行。

## 可以改的

`app/services/mcp/`（新）、`app/services/tools.js`、`app/services/approvals.js` 及 C1 的规则文件、`app/services/providers.js`（只复用凭据读写，必要时抽出共用函数）、`app/core/workspace/resources/settings.js`、`app/server/routes/`（新 `mcp.js` 及注册处）、`app/runtime/pi/tools.js`（只在 JSON Schema 透传需要时）、`package.json`、`package-lock.json`、相关测试、`docs/product/FEATURES.md`、`docs/log/IMPLEMENTATION_LOG.md`。

## 不做的

- 不改 `app/ui/`；MCP 服务器页、工具页和时间线显示由 Claude 做。
- 不接 MCP 的资源、提示词、采样（alpha 之后）；不做把 ScienceScope 开放成 MCP 服务器（那是以后的 CLI 联动）。
- 不动 `<预览安装目录>` 及其数据。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）。
- 功能测试：用 SDK 自带的方式起一个测试用的本地 MCP 服务器（放在测试夹具里），添加 → 状态已连接、工具数正确 → 脚本模型调用它的工具拿到结果；请求批准模式下先弹批准，选按服务器总是允许后同服务器另一工具不再问；粘贴 Claude Desktop 格式 JSON 能导入且密钥进了凭据文件；启动失败时状态带原因；关掉服务器后工具表里没有它。
- 真实模型：OpenCode Go `deepseek-v4.1-flash` 接一个公开的只读 MCP 服务器（例如官方示例里的时间或抓取服务器，用 `uvx` 或 `npx` 起，走国内镜像），问一个要用到它的问题。报告请求数、token 和用的是哪个服务器。
- 退出程序后没有残留的 MCP 子进程（Windows 上核对，报告里写一句）。

## 交付

- 分支：`codex/x2-mcp-YYYYMMDD`，从集成分支最新提交开始（X1、C1 合并之后）。报告不超过 15 行，给出远程分支与 SHA，写明 MCP 接口字段。不建 PR、不合并。
