# T11 · Python 运行环境（内置 3.14、共享缓存的多环境、按任务分配）

- 下达：Claude，2026-09-25；执行：GPT / Codex，在用户本机 Windows 上执行。
- 设计：`docs/design/PYTHON_ENVIRONMENTS.md`（**先读**）。通用规则与 `docs/tasks/RB_COMMON.md` 相同（基线分支、交付方式、许可、测试目录、文档更新）。
- 基线：`claude/determined-pasteur-jxpzw8`（如已合并则用 main）。交付分支：`codex/t11-python-env-YYYYMMDD`。不开 PR、不合并。

## 后端 `scripts/python-env/`（新模块）
1. `uv.mjs`：调用内置的 uv（路径来自应用资源目录；开发环境下可以用 `SCIENCESCOPE_UV` 指定）。
   固定 `UV_CACHE_DIR=<数据目录>/python/cache`、`UV_PYTHON_INSTALL_DIR=<数据目录>/python/interpreters`、`UV_LINK_MODE=hardlink`（失败时退回 copy），
   以及 `UV_INDEX_URL`（设置中的镜像源）。**不读取、也不修改**用户全局的 uv 或 pip 配置（`UV_NO_CONFIG=1`、`PIP_CONFIG_FILE` 置空）。
2. `environments.mjs`：表 `python_envs`（id、名称、Python 版本、清单 JSON、锁定 JSON、创建时间、状态）和 `python_env_bindings`（范围 project/chat、目标 id、环境 id）。
   操作：创建（venv）、复制、删除、安装或移除包（`uv pip install/uninstall -p <env>`）、同步到清单（`uv pip sync`）、导出清单、统计大小、检测系统 Python。
   同一个环境的写操作串行执行；每次操作都写日志（谁、什么时间、装了什么、结果）。
3. `resolve(chatId)`：按"对话 → 项目 → 新任务默认 → 系统 Python"解析，返回 `{envId, kind:'managed'|'system', pathPrepend, env:{VIRTUAL_ENV,…}}`。
4. 在 `desktop-api.mjs` 的 `ensureMainBinding` / `restoreExecution` 中调用 `resolve`，把 env 传给 `host.startSession`。
   在 `host.mjs` 中增加一个**可选**的 `sessionEnv` 参数，并入第 185 行的 env。这是允许的最小改动，改之前先告诉 Claude。
   更换环境时：空闲会话立即释放并在下次使用时重启；运行中的会话标记为"本轮结束后生效"。
5. **内置环境**：首次启动时创建"内置 · 科学分析"（Python 3.14，清单见设计文档 §5）。版本由仓库内的锁定文件 `python/builtin.lock` 决定，要把实际解析出的版本提交进去；安装在后台进行，显示进度。
6. 路由：`GET /api/python/envs`、`POST /api/python/envs`（create|copy|rename|remove）、`POST /api/python/envs/packages`（add|remove|sync）、
   `GET /api/python/resolve?chatId=`、`POST /api/python/bind`、`GET /api/python/system`、`POST /api/python/cache/prune`、`GET/POST /api/python/settings`。

## 智能体工具
在 `session-control.mjs` 中注册 `python_env_install {packages: string[], reason: string}`。**工具定义与调用方式请先交给 Claude 确认**，因为这个文件属于框架。
- 走现有的 `/host-call` 通道。宿主在界面上弹出审批卡片；用户同意后安装到当前任务的环境，拒绝则返回原因。
- 包名按 PEP 508 校验，只允许名称加版本约束；禁止路径、URL、`-e`、`--index-url` 等参数。系统 Python 不允许通过这个工具安装（提示用户改用托管环境）。
- 在工具说明和会话的运行时上下文中告诉模型："当前 Python 环境是 X；需要新包时用 python_env_install，不要直接用 pip"。

## 界面
- 设置 → 运行环境：按设计文档 §8 实现（保留现有的路径信息）。
- 项目设置和对话的工作区菜单：增加"Python 环境"小菜单，选项为环境列表、"不分配（系统 Python）"和"跟随项目"。
- 审批卡片：沿用现有执行审批的样式，列出包名、原因和目标环境。
- 浅色和深色截图。

## 验收
- 单元测试：解析顺序、绑定持久化、包名校验与参数拦截、写操作串行、不读取全局配置（用临时的 `HOME` 或 `APPDATA` 验证）。在测试中用一个假的 uv 脚本，**不联网**。
- 真实验收（用户的 Windows 电脑）：
  1. 首次启动创建内置环境：记录耗时、占用空间、失败的包。
  2. 新建环境 B，复制内置清单并加一个包：确认 numpy 等在缓存中只有一份（Windows 上用 `fsutil hardlink list` 查看）。
  3. 对话 1 用内置环境、对话 2 用 B、对话 3 不分配：让模型分别运行 `python -c "import sys; print(sys.executable)"`，结果符合预期。
  4. 询问模式下让模型需要一个没有的包（例如 `tabulate`）：出现审批卡片，同意后装好并继续，拒绝后模型正常收尾。
  5. 切换镜像源后安装仍然成功。
- 更新 `docs/SYSTEM_SPEC.md`（新小节"Python 运行环境"）和 `docs/DESKTOP_IMPLEMENTATION.md`。
