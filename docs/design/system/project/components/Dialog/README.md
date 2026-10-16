对话框：需要专心填写或确认的事，居中弹出，背景变暗。

## 结构

`<div class="ss-scrim" id="d-x" hidden><div class="ss-dialog" role="dialog" aria-modal="true">` 里放 `ss-dialog__head`（`ss-dialog__title`、关闭按钮）、`ss-dialog__body`、`ss-dialog__foot`。

- 宽度：`ss-dialog--sm`（`dialog-sm`，确认）、默认（`dialog-md`，表单）、`ss-dialog--lg`（`dialog-lg`）、`ss-dialog--settings`（`dialog-xl`，设置）。
- 打开：`data-dialog="#d-x"`；关闭：`data-close`、Esc、点背景（表单改过时给 scrim 加 `data-dirty`，点背景不关）。
- 打开后焦点落在第一个输入框或主按钮，Tab 在框内循环，关闭后回到触发按钮。

## 规则

- 确认框的标题就是问题，如「移除服务商「OpenCode Go」？」；正文一句话说后果；按钮写「取消」和具体动作。
- 测试连接这类结果直接显示在框里（Callout），不再另弹提示。
- 不在对话框里再开对话框。
