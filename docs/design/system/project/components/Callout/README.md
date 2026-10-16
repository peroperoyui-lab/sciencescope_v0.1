页面里的提示条：一句话说结果和影响，细节收起，可以关掉。

## 结构

`ss-callout`（版本 `--warn`、`--danger`、`--ok`、`--auto`）里放图标、`ss-callout__body`（`ss-callout__title` + 正文，细节放 `ss-callout__details` 并默认 `hidden`）和 `ss-callout__actions`（「查看」用 `data-toggle` 展开细节，✕ 关闭）。

## 规则

- 同一批的问题合成一条，如「2 篇材料解析时有提示」，不要一篇一条堆在页面上。
- 解析器的原始报错翻译成人话放进细节，例如「跳过了 3 种无法识别的样式（目录、页眉）」。
- 关掉后不再出现；同样的问题再发生才重新出现。
- 需要确认的事用 Dialog，一闪而过的结果用 Toast。
