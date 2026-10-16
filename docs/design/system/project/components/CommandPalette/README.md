搜索与命令：Ctrl K 打开，一个输入框搜对话、资料和命令。

## 结构

`<div class="ss-scrim ss-scrim--top">` 里放 `ss-cmd`：`ss-cmd__input`（搜索框和 Esc 提示）、`ss-cmd__list`（`ss-cmd__group` 分组，`ss-cmd__item` 结果，右侧 `ss-cmd__meta`）、`ss-cmd__foot`（键盘提示）。

## 交互

- 输入即筛选，没有结果的分组隐藏，第一条自动选中；匹配的文字用 `<mark>`。
- ↑ ↓ 选择，Enter 打开，Esc 关闭并回到原来的位置。
- 其他二级窗口都照它的方式开关：出现在视线中央或触发点旁边，Esc 关闭，焦点回到原处。
