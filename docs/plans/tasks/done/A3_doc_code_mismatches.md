# A3 修正与规则不符的三处后端行为

- 起草：Claude，2026-10-19。依据：2026-10-18 文档整理时核对代码发现的不符（`archive/ROADMAP_2026-10-18.md` 末条）；`AGENTS.md` 原则 1（应用不在用户的项目文件夹里放自己的文件）、下载走国内镜像的规则、验证规则；路线图阶段 1 的 A3。
- 执行：Sol（Windows）；审阅：Claude。约 1 小时，一步交付；超出就停下汇报。界面那几处（设置里的文件夹标签、纪要设置的勾选项、主输入框选模型、技能目录）由 Claude 做，不在本任务。

## 目标

1. 秘书写纪要时不再往用户的项目文件夹里写 `minutes/*.md`；纪要只存在 ScienceScope 的 `data/` 里。
2. 打开本地语义检索时，模型默认从 ModelScope 下载。
3. 打包脚本的测试（`tools/package/*.test.js`）随 `npm run check` 一起跑。

## 用户会怎么用

- 用户在绑定了外部项目文件夹的对话里讨论，秘书更新纪要后，项目文件夹里不会多出 `minutes/` 文件夹；在对话纪要窗口里照常看到和编辑纪要。
- 用户第一次在设置里打开本地语义检索，模型从 ModelScope 下载；用户手动选了「官方」或「HF 镜像」的照旧按所选来源下载。

## 要做的

1. **纪要不再导出到项目文件夹**：
   - 现状：`app/services/secretary/publish.js` 的 `exportMinutes` 在 `settings.saveMarkdown` 为真（默认真）时，把纪要写进 `meeting.workFolder ?? project.folder` 下的 `minutes/<会议 id>.md`。外部项目文件夹违反原则 1；内部项目目录本来就有正本（函数里已跳过同一路径）。
   - 改为：删除 `exportMinutes` 及其调用；删除秘书设置里的 `saveMarkdown`（`app/services/secretary/policy.js`、`app/core/workspace/resources/settings.js` 默认值）；`store.patchStatus` 不再写 `exportPath`、`exportError`，状态接口不再返回这两个字段。数据库里的两列可以留着不读，也可以在新迁移里删掉（正式版前不需要兼容），二选一，报告里写明。
   - 已经写进用户项目文件夹的旧文件不动（那是用户文件夹里的内容，不替用户删）。
2. **语义模型默认从 ModelScope 下载**：
   - 现状：`app/core/defaults.js` 的 `DEFAULT_SEMANTIC_SETTINGS.downloadSource` 是 `'official'`，`model-assets.js` 里 `official` 先试 huggingface.co 再试 hf-mirror.com。
   - 改为：默认值改成 `'modelscope'`（ModelScope 的五个文件已按清单 SHA-256 核对过，见 `model-assets.js` 注释）。已存过来源的用户设置不改。`official` 的行为不变。
3. **打包测试进检查**：
   - 现状：`package.json` 的 `check` 只跑 `app/**/*.test.js`，`tools/package/` 下的三个测试（`installer-hooks`、`notices`、`prune`）不在里面。
   - 改为：`check` 同时跑 `tools/package/*.test.js`；这些文件也纳入 Prettier、ESLint 检查（不需要的话说明原因）。只能在 Windows 跑的测试照现有写法跳过。
4. **文档**：`product/FEATURES.md` 里纪要导出和语义模型来源的描述随之改；`log/IMPLEMENTATION_LOG.md` 一行。

## 可以改的

`app/services/secretary/`、`app/core/defaults.js`、`app/core/workspace/resources/settings.js`、`app/server/routes/minutes.js`（如果状态字段在这里组装）、`app/core/db/migrations/`（只在选择删列时）、`package.json`、`tools/package/` 的测试与格式、相关测试、上面两份文档。

## 不做的

- 不动 `app/ui/`：纪要设置里的「同时保存为工作文件夹中的 Markdown 文件」勾选项和纪要窗口里的导出错误显示，由 Claude 在同一时间删掉。界面先于后端合并也不会出错（多传的 `saveMarkdown` 后端忽略即可）。
- 不改 Python 下载源的默认值（那是用户在设置里选的）。
- 不动旧线（`desktop/`、`scripts/`）。
- 不动 `<预览安装目录>` 及其数据。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试），并且输出里能看到 `tools/package` 的测试。
- 功能测试：绑定一个外部项目文件夹的会议生成纪要后，该文件夹里没有 `minutes/`，纪要窗口能读到内容。
- 功能测试：全新数据目录的默认语义设置是 `modelscope`，下载地址指向 modelscope.cn。
- 报告里写明数据库两列是留着还是删了。

## 交付

- 分支：`codex/a3-doc-code-mismatches-20261019`，从集成分支最新提交开始（可以接在 A2-2 之后）。报告不超过 15 行，给出远程分支与 SHA。不建 PR、不合并。
