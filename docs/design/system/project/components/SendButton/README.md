发送和停止是同一个按钮：空闲时是向上箭头，回答进行中变成方形停止键。

## 结构

- 空闲：`<button class="ss-send" aria-label="发送" data-tip="发送" data-kbd="Enter"><i data-i="arrow-up"></i></button>`
- 进行中：`data-state="running"`，内容换成 `<span class="ss-send__stop"></span>`，`aria-label` 和提示改成「停止」，快捷键 Esc。
- 输入框为空、也没有进行中的回答时，按钮 `disabled`。

## 规则

- 点停止后立刻中断请求，界面马上可以继续输入；已经生成的内容保留，状态行写「你停止了这次回答，已保留到目前的内容」。
- 不在旁边另放一个停止按钮。
- 底色用 `primary`，停止时不变色，只换图形。
