复选框、单选框和开关，用 `ss-check` 包住输入和文字。

## 结构

- 复选框：`<label class="ss-check"><input type="checkbox" /><span>文字</span></label>`
- 单选框：同样的结构，`type="radio"`。
- 开关：`<input class="ss-switch" type="checkbox" role="switch" />`，可以放进 `ss-check` 带文字。
- 全选框支持半选：脚本设置 `indeterminate = true`。

## 何时用

- 开关：设置里立即生效的开或关。
- 复选框：筛选条件、批量勾选、表单里提交才生效的选项。
- 单选框：表单里两到五个互斥选项；不需要提交的切换用 SegmentedControl。

## 规则

- 复选框边框用 `muted`，保证和底色至少 3:1。
- 点文字也能切换。禁用时文字一起变淡，并说明原因。
