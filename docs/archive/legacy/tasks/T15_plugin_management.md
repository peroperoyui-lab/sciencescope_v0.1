# T15 · 插件管理（安装、更新、启停、移除）

共同规则见 `docs/tasks/RB_COMMON.md`；开关机制见 `docs/tasks/FEATURE_FLAGS.md`（开关 `pluginManagement`）。交付分支：`codex/t15-plugins-YYYYMMDD`。

## 现状
- 设置 → 插件与技能：本地技能可添加、编辑、启停、移除（已实现）；"DSH 插件组成"只读显示宿主清单（`GET /api/plugins/inventory`）。
- 已删除原来的"依赖包安装、更新及插件启停管理尚待接入"说明，插件区目前只读，没有任何假按钮。

## 先调研，再动手
1. 确认已安装 DSH 版本支持的插件管理方式（CLI 子命令、SDK 接口或配置文件 + 重启）。把结论和证据（包名、版本、README 段落）写进交付报告。
2. 如果 DSH 没有受支持的方式，**停下报告**，不要自己写 npm 安装逻辑绕过 DSH。

## 宿主（在确认受支持方式之后）
- `POST /api/plugins/install {package, version}`、`/update {package}`、`/remove {package}`、`/enable {package}`、`/disable {package}`；
  返回操作结果和是否需要重启运行时。
- 安全：只接受 npm 包名加版本（校验格式，拒绝 URL、路径、git 地址）；安装时禁止运行安装脚本；显示包的发布者、版本、完整性校验值；每次操作写日志。
- 需要重启运行时的操作：空闲会话立即释放，运行中的会话在本轮结束后生效（与 T11 相同的原则）。
- `capabilities.features.pluginManagement = true`（确认方式可用时）。

## 前端（`desktop/extensions.mjs`）
- 插件区在开关打开时显示"添加插件…"和每项的"更新 / 停用 / 移除"；添加前显示确认窗口（包名、版本、发布者、将获得的能力）。
- 说明文字放进"i"；操作失败直接显示错误。

## 验收
- 单元测试：包名校验、参数拦截、日志。
- 在 Windows 上安装一个官方示例插件并启用、停用、移除；确认模型工具列表随之变化。
