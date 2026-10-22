左侧栏：主导航（新对话、知识库、工作站和它的简报按钮、编辑台）、搜索入口、置顶、项目树、独立对话和「全部对话」，宽度可以拖动。所有主窗口页面共用这一份（build/shell/gen.py 生成）。

## 结构

- `ss-sidebar` 分三段：`ss-sidebar__top`（`ss-nav-item` 导航和 `ss-search-trigger` 搜索入口）、`ss-sidebar__scroll`（`ss-side-section` 分组）、`ss-sidebar__foot`（个人资料、全局助手、设置），最后放 `ss-splitter--end`。
- 知识库导航的数字是收件箱里等确认的记忆条数，没有时不显示。
- 工作站一行是 `ss-nav-row`：右边的 `clipboard-list` 按钮打开工作站简报（ProjectSummary 同一个浮层），`aria-expanded` 跟着开关。
- 「编辑台」在工作站下面：`file-pen` 图标，行尾 `app-window` 小图标表示在独立窗口打开（DeskEntry ①）。
- 当前页面的导航项带 `aria-current="page"`；在全部对话页时 `ss-side-all` 也带。
- 项目行 `ss-tree-row` 带 `aria-expanded` 和折叠按钮 `ss-tree-row__twisty`；项目里的对话用 `ss-tree-row--child`；独立对话用 `ss-tree-row--leaf`。
- 行尾 `ss-tree-row__end` 放状态或最后更新时间：运行中 `ss-spin`；待批准、失败、排队用 `ss-tree-row__state`（`--warn`、`--danger`）加小图标和两字说明。折叠的项目里有对话在运行时，项目行也转圈。悬停时换成 `ss-tree-row__actions`（新对话、⋯）。
- 每个项目先列最近 5 个对话，其余收进 `ss-tree-more`「还有 N 个」。
- 列表末尾 `ss-side-all`「全部对话」（Ctrl Shift K），含已归档的对话。
- 底部 `ss-sidebar__foot`：个人资料、全局助手、设置。

## 交互

- 每一行右键（`data-ctx`）和 ⋯（`data-menu`）打开同一份菜单。
- 独立对话可以拖进项目：对话行 `draggable="true" data-drag="chat"`，项目行 `data-drop-target`；放下后弹出带「撤销」的提示。菜单里也有「移到项目…」，子菜单列出项目和「移出项目，变成独立对话」。
- 运行中的对话不能归档，菜单项禁用并写明原因。
- 新对话：当前在某个项目里就建在这个项目下，否则建独立对话。
- 没有内容的分组整组隐藏，不写「暂无置顶」。
- 宽度 `sidebar`，可在 `sidebar-min` 到 `sidebar-max` 之间拖动，双击分隔线恢复。
