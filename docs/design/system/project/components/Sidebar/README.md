左侧栏：主导航、搜索入口、项目树和独立对话，宽度可以拖动。

## 结构

- `ss-sidebar` 分三段：`ss-sidebar__top`（`ss-nav-item` 导航和 `ss-search-trigger` 搜索入口）、`ss-sidebar__scroll`（`ss-side-section` 分组）、`ss-sidebar__foot`（用户、专家、设置），最后放 `ss-splitter--end`。
- 项目行 `ss-tree-row` 带 `aria-expanded` 和折叠按钮 `ss-tree-row__twisty`；项目里的对话用 `ss-tree-row--child`；独立对话用 `ss-tree-row--leaf`。
- 行尾 `ss-tree-row__end` 放时间或运行中的转圈；悬停时换成 `ss-tree-row__actions`（新对话、⋯）。

## 交互

- 每一行右键（`data-ctx`）和 ⋯（`data-menu`）打开同一份菜单。
- 独立对话可以拖进项目：对话行 `draggable="true" data-drag="chat"`，项目行 `data-drop-target`；放下后弹出带「撤销」的提示。菜单里也有「移到项目…」。
- 运行中的对话不能归档，菜单项禁用并写明原因。
- 新对话：当前在某个项目里就建在这个项目下，否则建独立对话。
- 没有内容的分组整组隐藏，不写「暂无置顶」。
- 宽度 `sidebar`，可在 `sidebar-min` 到 `sidebar-max` 之间拖动，双击分隔线恢复。
