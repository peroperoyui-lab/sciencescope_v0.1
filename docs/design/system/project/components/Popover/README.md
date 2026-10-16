浮层面板：筛选、模型选择这类二级设置贴着按钮弹出，改了立即生效。

## 结构

`<div class="ss-pop" id="p-x" hidden>`，按需放 `ss-pop__head`（标题和关闭按钮）、`ss-pop__body`（若干 `ss-pop__section`，每段一个 `ss-pop__label`）、`ss-pop__foot`（说明和「清除」）。短说明用 `ss-pop--note`。

触发按钮写 `data-pop="#p-x"`。

## 规则

- 一次只开一个浮层；点外面或按 Esc 关闭，焦点回到触发按钮。
- 面板里不放「确定」：选了就生效。需要确认、会改数据的操作用 Dialog。
- 贴着触发按钮出现，不固定在屏幕右上角。
- 宽度 220–360px。
