表格：只用于需要横向比较的字段，如变量表、模型上限表。

## 结构

`<table class="ss-table">` 配 `<colgroup>` 固定列宽。

- 表头吸顶；可排序的表头里放按钮，当前排序列加 `aria-sort`。
- 数字列 `ss-num` 右对齐、等宽数字；变量名、模型名用 `ss-mono`。
- 选中行 `tr[aria-selected="true"]`；行操作放 `td.ss-table__actions`，悬停才出现。

## 规则

- 资料、对话这类对象用 List，不用表格。
- 空值写「—」，不写 null 或 undefined。
- 需要提醒的数值只改文字颜色（如缺失率超过 10% 用 `warn-ink`），并在提示里写原因。
