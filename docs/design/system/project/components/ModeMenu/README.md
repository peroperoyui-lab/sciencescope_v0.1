执行方式菜单：在输入框底栏切换请求批准和常规两档。自动化已在 2026-10-18 取消。

## 结构

触发按钮是 `ss-btn--ghost ss-btn--sm`，里面是图标、`data-slot="value"` 和 chevron-down，用 `data-menu` 打开一份 `ss-menu`。

- 菜单里每一项是 `ss-menu__item--rich`（`role="menuitemradio"`），带四个属性：`data-label`、`data-icon`、`data-mode`、`data-trigger-class`。
- 选中一项后，组件脚本把它的文字、图标和按钮样式写回触发按钮，并把 `data-mode` 写到所在的 `ss-composer` 上。

## 三档的意思

- 请求批准（shield-check）：运行命令、写入数据目录以外的文件（如项目文件夹）、安装包之前先停下来问用户，见 ApprovalCard。资料库和工作站的改动不用问，它们有历史版本。新对话默认用这一档。
- 常规（play）：直接执行，不逐条询问，随时可以停止。

## 规则

- 不做「记住本次选择」。想长期放行，就切到「常规」。
- 切换只影响当前对话。
