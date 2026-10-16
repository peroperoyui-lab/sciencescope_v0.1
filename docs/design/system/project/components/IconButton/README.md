只有图标的按钮，用在页头、列表行、时间线和工具条里，必须带提示。

## 结构

`<button class="ss-icon-btn" type="button" aria-label="名称" data-tip="名称"><i data-i="图标名"></i></button>`

- 尺寸：默认 28px；`ss-icon-btn--sm` 24px，用在列表行、侧栏行和时间线里。
- 有快捷键时加 `data-kbd="Ctrl J"`，提示里一起显示。
- 开关型按钮（如打开任务秘书面板）用 `aria-pressed="true"` 表示已打开，底色变成 `hover`。
- 角标：`<span class="ss-icon-btn__badge">2</span>` 显示数量（如已选的筛选条件）；`data-dot` 只表示有新内容。

## 规则

- `aria-label` 和 `data-tip` 写同一个名称，名称来自 Icons 卡片里的含义表。
- 一行里最多两个图标按钮，其余收进 ⋯（`data-menu`）。
- 不要用图标按钮做危险动作的唯一入口；删除放在 ⋯ 菜单最后，并确认。
