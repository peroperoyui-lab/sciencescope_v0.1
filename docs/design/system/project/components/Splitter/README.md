分隔线：每个侧栏和右侧面板都能拖动调宽，双击恢复默认，宽度会记住。

## 用法

在要调宽的面板里（面板需要 `position: relative`）放 `<div class="ss-splitter ss-splitter--end" data-min="200" data-max="360" data-default="248" data-key="sidebar"></div>`。面板在左边用 `--end`，在右边用 `--start`。

- 拖动跟手：指针捕获，每帧更新一次宽度。
- 双击恢复 `data-default`；聚焦后 ← → 每次 16px，按住 Shift 每次 64px。
- 宽度按 `data-key` 记在本机。

## 规则

- 所有侧栏和面板都可以拖，范围用 `sidebar-min`–`sidebar-max`、`panel-min`–`panel-max`。
- 收窄时内容跟着收窄，不能露出空白；拖动时面板内容不重新加载。
- 分隔线平时是 1px 的 `line`，悬停 0.15 秒后变成 3px 的 `accent-line`，拖动时是 `accent`。
