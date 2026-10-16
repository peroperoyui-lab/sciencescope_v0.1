数量、标签和状态点：小而安静，颜色只表达状态。

## 结构

- 数量 `ss-count`；需要提醒时用 `ss-count--accent`。
- 标签 `ss-tag`，状态版本 `ss-tag--ok`、`ss-tag--warn`、`ss-tag--danger`、`ss-tag--auto`；可以带 12px 图标。
- 状态点 `ss-dot`，版本 `--ok`、`--warn`、`--danger`、`--live`（运行中，缓慢扩散）。

## 规则

- 状态点后面总跟着文字，不能只靠颜色。
- 标签不超过四个字，不放句子。
- `ss-tag--auto` 只表示自动化。错误用 `danger`，不用 `auto`。
