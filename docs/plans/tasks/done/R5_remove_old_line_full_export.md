# R5 删除旧线，补全量导出

- 起草：Claude，2026-10-23。依据：用户 2026-10-23 选定 Sol 下一步做 R5；`ROADMAP.md` 阶段 3 之后 R5 一行（只删旧线，补全量导出，不导入旧原型数据）；`DECISIONS.md` 2026-10-18「R5 默认只删除旧线」；`DATA_AND_ROLES.md` 原则 4（数据库提供"全部导出"，Markdown 加 JSON，不用 ScienceScope 也能读懂）；现有 `app/services/export.js`（只有单个对话 Markdown 和项目快照 zip）。
- 执行：Sol（Windows）；审阅：Claude。约 3 小时，两段各自提交、一次交付；超出就停下汇报。

## 目标

1. 仓库里只剩新核心：旧原型的代码、测试、启动脚本和开发依赖都删掉，原生外壳只会启动 `app/main.js`。
2. 用户能把自己在 ScienceScope 里的全部数据导出到一个普通文件夹：对话、纪要、工作站、知识库、专家、技能和设置都是能直接打开的 Markdown 或 JSON，原件照原样复制；导出里不含任何密钥。

## 用户会怎么用

- 用户在设置里点「导出全部数据」（按钮和进度由 Claude 做），选一个文件夹。几分钟内在里面出现 `ScienceScope 导出 2026-10-23 1530/`，打开 `README.md` 就知道每个文件夹装了什么；对话能用记事本读，资料原件能直接打开。
- 导出期间照常对话，不卡。中途取消或失败，留下的是带 `（未完成）` 的文件夹，不会被当成完整导出。
- 选的文件夹在数据目录里面，或者磁盘写不进去，直接告诉用户原因，不开始导出。

## 要做的

### 第一段：删旧线（单独提交）

1. **删除**：`desktop/`、`scripts/`、`adapters/`、`src/`、`qa/`、`tests/`、`screenshots/`、根目录 `MANIFEST.sha256`、`Start-ScienceScope.cmd`。
   - **保留**：`ScienceScope.html` 和 `reference/`（视觉基线，打包用到 logo），`python/`（内置环境清单），`models/`，`tools/`，`src-tauri/`，`docs/archive/legacy/`。
   - 删之前在 `DECISIONS.md` 记下最后一个还带旧线的 main 提交 SHA，以后要查旧代码从那里找。
2. **`package.json`**：
   - 删掉 `desktop:prepare`、`desktop:preview`、`test`（旧测试）这几个脚本。
   - 删掉 `@deepseek-ai/dsh`、`@deepseek-ai/dsh-sdk-client`，以及只给旧线用的其他依赖。逐个用 `git grep` 确认 `app/`、`tools/`、`src-tauri/` 里没人用了才删。
   - 重新生成 `package-lock.json`，保持锁文件里现有的下载地址格式。
   - `tools/package/` 里只为 DSH 写的裁剪规则跟着删，对应测试一起改。
3. **原生外壳**：
   - `src-tauri` 去掉旧宿主启动路径：`SCIENCESCOPE_APP=legacy`、`SCIENCESCOPE_HOST_SCRIPT`、`--desktop` 那一支，以及 `is_new_app` 的分叉。启动时总是走 `NewAppLaunch`。
   - `tauri.conf.json` 的 `frontendDist` 不再指向旧线生成的 `desktop-dist`。改成新核心开发时实际能用的目录，打包时照旧由 `tools/package/windows.js` 覆盖。
   - Rust 测试同步改，`cargo test` 通过。
4. **配置和文档**：
   - `.gitignore`、`eslint.config.js`、`.prettierrc.json`、`.gitattributes` 里只为旧线写的条目删掉。
   - `README.md` 和 `README.zh-CN.md` 的目录表删去旧线一行。
   - `AGENTS.md` 里冻结旧线那条改为"旧线已在 R5 删除"，加上第 1 条记下的 SHA。
   - `FEATURES.md` 第 5 行同样改。
   - `architecture/` 里指向 `scripts/` 等旧路径的描述不逐段改写，在各文档开头加一行说明：旧线已删除，路径只作历史参考。
   - 删完后，`git grep -nE "(desktop|scripts|adapters|qa|tests|screenshots)/"` 在 `docs/` 以外只剩和旧线无关的匹配，报告里列出剩下的。

### 第二段：全量导出

5. **接口**：
   - `POST /api/export/all { target }` 开始导出，返回 `{ jobId, folder }`。`target` 是用户选的已有文件夹。
   - `GET /api/export/all/:jobId` 返回 `{ phase, done, total, bytes, folder, error? }`。
   - `DELETE /api/export/all/:jobId` 取消导出。
   - 同一时间只跑一个导出。第二次请求时返回正在跑的那个。
   - 进度变化节流后发 `export.progress`，每秒最多一次；结束发 `export.finished { jobId, folder, files, bytes, skipped, cancelled }`。
   - `app/ui/api.js` 的 `EVENT_TYPES` 只加这两项。
6. **文件夹规则**：
   - 先写到 `ScienceScope 导出 YYYY-MM-DD HHmm（未完成）/`，全部写完再去掉后缀。重名时加 ` (2)` 之类的序号，从不覆盖已有文件夹。
   - `target` 在数据目录里面、不存在、或写不进去时，直接返回 400 和原因。
   - 文件和文件夹名用 `safeFileName`。大文件用流复制，不整个读进内存。
   - 每个文件之间让出事件循环，导出期间检索和对话照常响应。
7. **导出内容**：文件夹下各部分如下，具体字段按现有表来定，写进 `README.md`。
   - `README.md`：导出时间、程序版本、数据库版本、每个文件夹装了什么，以及哪些东西故意没导出、为什么。
   - `对话/<项目名或「不属于项目」>/<标题>-<id>.md` 和同名 `.json`：
     - `.md` 沿用 `meetingMarkdown`，可读即可。
     - `.json` 放完整消息：发言人、时间、分支来源、附件和标记的引用、工具调用摘要。
     - 已归档的对话也导出。
   - `项目/<项目名>/`：
     - `项目.json`，写名称、项目文件夹路径、Python 环境等设置。
     - 工作站：计划、日志、导图，导图同时给 JSON 和 Markdown 大纲。
     - 纪要 `.md`。
     - 编辑台的稿件版本（每个版本一份原文件，加 `版本.json` 写父版本、时间、说明）、批注与索引 JSON。
     - 项目文件夹本身在数据目录内时，整个复制到 `项目文件夹/`。在数据目录外（用户自己的文件夹）时不复制，只在 `项目.json` 里写路径。
   - `知识库/`：
     - `资料.json`：每条资料的元数据和所属项目。
     - `正文/<资料 id>.md`：解析出的正文。
     - `原件/`：全局资料库导入的原件按原文件名复制。项目文件夹里的文件用户本来就有，默认不复制；请求带 `includeProjectCopies:true` 时才复制。
     - `条目/` 每条一个 `.md`。论文卡片也在这里，用 `.md` 加 JSON。
     - `实体.json`、`关系.json`，关系带证据出处。
   - `专家/<名字>.md` 和 `.json`：设定、模型、工具；专家记忆各一份 `.md`。
   - `技能/` 原样复制。`MCP.json` 只放公开配置，`keyRef` 原样保留，不解出值。
   - `设置.json`：`settings.json` 加上服务商列表，不含密钥。
   - `数据库/sciencescope.sqlite`：用 `VACUUM INTO` 做的一致副本，给需要完整记录的人。
     - 2026-10-23 Sol 提问，用户确认：服务商自定义 headers 可能存着明文密钥。导出时，`设置.json` 和数据库副本里所有自定义 header 的值一律换成 `<已移除>`，名字保留。数据库副本里设置的修订历史、事件记录等凡是存过这些值的地方都要一起处理。原数据库不动，副本的表行数不变。MCP 配置里如果也有明文 header 或环境变量，按同样规则处理。把 header 值改存进 `secret/` 是另一件事，不在本次范围内，报告里列出所有存过明文的位置即可。
   - **不导出**：`secret/`、`logs/`、`backups/`、`runtime/`、`python/` 环境本身（只在 `设置.json` 里写环境清单）、`models/`、webview 数据。
8. **不挡别的事**：导出放在后台跑，应用关闭时取消，留下 `（未完成）` 文件夹。下次启动不自动续传。

## 可以改的

- 第一段：上面列出的目录和根文件；`package.json`、`package-lock.json`；`src-tauri/`；`tools/package/`；`.gitignore`、`eslint.config.js` 等根配置；`README.md`、`README.zh-CN.md`、`AGENTS.md`。
- 第二段：`app/services/export.js`（可拆成几个文件放进 `app/services/export/`）；`app/server/routes/` 里导出相关路由；`app/ui/api.js` 的 `EVENT_TYPES`（只加两项）。
- 两段都可以改：各自的测试；`docs/product/FEATURES.md`、`docs/decisions/DECISIONS.md`（一条）、`docs/architecture/` 的开头说明和 `DATA_AND_ROLES.md` 的导出一节、`docs/log/IMPLEMENTATION_LOG.md`（不超过 5 行）。

## 不做的

- 不导入旧原型数据，也不做从导出文件夹导回。
- 不做界面：设置里的按钮、文件夹选择、进度都由 Claude 做。
- 不改现有的单对话导出和项目快照 zip 的行为。
- 不删 git 标签和远程分支，这些由用户自己删。
- 不动 `<预览安装目录>` 及其数据。不提交任何真实数据、个人路径或截图（仓库是公开的）。

## 完成标准

- 干净检出 `npm ci` 后 `npm run check` 全部通过（含 Windows 测试），`cargo test` 通过。
- 用测试产品名打一次安装包，全新安装能启动、能对话（只做冒烟）。报告写安装包体积，以及和 R6a-6 相比的文件数。
- 导出测试用合成数据目录，覆盖下面几项：
  - 有一个内部项目和一个外部项目、带分支的对话、已归档对话、知识库资料（全局导入一份、项目文件一份）、实体和关系、专家和记忆、技能、MCP 和服务商的假密钥。
  - 断言：
    - 导出文件夹全文搜不到假密钥，数据库副本也要逐表搜一遍。假密钥要覆盖三处：服务商密钥、自定义 header 值、改过一次 header 后留在修订历史里的旧值。
    - 所有 `.json` 都能解析。
    - `数据库/` 副本能打开，表行数和原库一致。
    - 外部项目文件夹没被复制。
    - 取消后留下的是 `（未完成）` 文件夹。
    - 重名时加序号。
    - `target` 在数据目录里时返回 400。
    - 进度事件已节流。
- Windows 实测：在 KB-2c 那份两万文件的数据上导出一次，报总耗时、导出体积，以及期间检索一次的延迟。材料放 `.sciencescope-local/temp/r5/`。

## 交付

分支 `codex/r5-remove-old-line-YYYYMMDD`，从 `main` 最新提交开始。第一段和第二段各自提交。报告不超过 15 行，写明：

- 远程分支和 SHA；
- 删了什么（目录、依赖）；
- 第 4 条 `git grep` 剩下的匹配；
- 安装包冒烟和导出实测的数字。

不建 PR，不合并。
