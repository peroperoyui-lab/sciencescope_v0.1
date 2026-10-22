主窗口标题栏，所有主窗口页面共用（build/shell/gen.py 生成）。

## 结构

- `ss-titlebar`：`ss-titlebar__brand`（矢量标志 + ScienceScope）、四个 `ss-titlebar__menu`（文件、编辑、视图、帮助）、`ss-titlebar__spacer`、`ss-titlebar__title`（当前项目名）、窗口置顶 `ss-winctl ss-winctl--pin`、最小化、最大化、关闭。
- 窗口置顶按钮用 `aria-pressed`；按下时图钉是主色并填充 `accent-soft`。

## 菜单

- 文件：新对话（Ctrl N）、独立快速对话（Ctrl Alt N）、新建项目；导出当前对话（Markdown）、导出项目快照。
- 编辑：查找当前对话（Ctrl F，只在对话页可用）、搜索与命令（Ctrl K）；复制选中文字。
- 视图：全部对话（Ctrl Shift K）、工作站、编辑台；全局助手、窗口置顶；显示滚动条、简洁执行记录；中文、English。
- 帮助：键盘快捷键、关于 ScienceScope。

## 规则

- 窗口置顶是设置，标题栏按钮和「视图」菜单两处同步，重启后保留。
- 编辑台窗口有自己的标题栏（文稿标签页），同样带窗口置顶。
