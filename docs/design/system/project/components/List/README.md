对象列表：一行一个对象（资料、对话、收件箱条目），点一下在右侧预览。

## 结构

`<div class="ss-list" data-selectable role="listbox">` 里放 `ss-list-row`（`role="option"`、`aria-selected`）。

- 行内依次是：`ss-list-row__icon`（或转圈）、`ss-list-row__main`（`ss-list-row__title`，两行版加 `ss-list-row__sub`）、状态标签、`ss-list-row__meta`、时间 `ss-list-row__meta--time`、`ss-list-row__actions`。
- 两行版 `ss-list-row--2`（52px）；单行 36px（`h-row`）。
- 分组标题 `ss-list__group`（`data-toggle="next"` 折叠下一组）；已处理的行用 `ss-list-row--done`。
- 批量处理：用 `data-batch` 包住工具条和列表；行里放 `data-batch-item` 复选框，全选框 `data-batch-all`；工具条里只在有选择时显示的元素写 `data-batch-show`，没有选择时显示的写 `data-batch-hide`；已选数量填进 `data-slot="count"`；「取消选择」写 `data-batch-clear`。

## 规则

- 悬停只出现两个最常用的图标和 ⋯；整行右键打开同一份菜单。不在行里放一排文字按钮。
- 不做单独的详情页：单击在右侧面板预览，双击或 Enter 打开原件。
- 标题一行显示不下就截断，悬停看全称；不换行。
