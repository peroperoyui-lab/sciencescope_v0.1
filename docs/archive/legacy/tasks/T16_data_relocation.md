# T16 · 更改数据目录与迁移

共同规则见 `docs/tasks/RB_COMMON.md`；开关机制见 `docs/tasks/FEATURE_FLAGS.md`（开关 `dataRelocation`）。交付分支：`codex/t16-relocation-YYYYMMDD`。
与 ROADMAP 阶段 B（安装、数据生命周期、升级）相关，先读 `docs/ROADMAP.md` 阶段 B。

## 现状
- 设置 → 运行环境 / 数据库与文件：列出实际使用的目录（`valueRow`），可"打开文件夹"。路径只读。
- 已删除原来的"更改目录和迁移数据尚未开放"说明。

## 目标
用户可以把默认项目目录、资料库原件目录，以及整个应用数据目录移动到别的磁盘，数据完整、可回退。

## 宿主
1. 目录配置：新增 `paths.json`（放在固定的引导位置，例如 `%APPDATA%/ScienceScope/paths.json`；开发环境在 `.sciencescope-local/`），
   宿主启动时读取，没有时使用当前默认值。现有 `settingsPaths` 从这里取值。
2. `POST /api/settings/relocate {id, target}`（流式返回进度）：
   - 校验目标：必须是空文件夹或不存在（会新建）；复用 `scripts/workspace-folders.mjs` 的禁止规则；检查剩余空间 ≥ 数据大小 × 1.2；
   - 停止并释放全部运行时会话，暂停写入；
   - 复制并逐文件校验（大小 + SHA-256）；SQLite 用在线备份接口复制，而不是直接拷文件；
   - 写入迁移记录 `relocation-<时间>.json`（源、目标、文件数、校验结果），更新 `paths.json`，重启宿主；
   - 旧数据保留，界面提示用户确认后再删除（`POST /api/settings/relocate/cleanup {recordId}`）；
   - 任何一步失败：恢复原配置，目标中的部分拷贝删除，返回错误。
3. `GET /api/settings/relocate/status` 返回进行中的迁移与最近记录。
4. `capabilities.features.dataRelocation = true`（配置文件机制就绪时）。

## 前端（`desktop/settings.mjs`）
- 开关打开时每个可迁移的路径旁显示"更改…"；选择目标（用 T11 的原生文件夹选择框，或粘贴路径）→ 确认窗口（大小、预计时间、需要重启）→ 进度条 → 结果。
- 说明放进"i"；错误和警告直接显示。

## 验收
- 单元测试：目标校验、空间检查、校验失败时回退、SQLite 备份一致性。
- Windows 真实演练：把资料库目录迁到另一个盘，迁移后打开旧资料、导入新资料、重启后路径保持；再迁回来。记录耗时和数据量。
