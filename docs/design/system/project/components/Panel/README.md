右侧面板：预览、任务秘书、属性都用它，从右侧推开主区域。

## 结构

`ss-panel`（默认宽度 `panel`）里放 `ss-splitter--start`、`ss-panel__head`（44px：`ss-panel__title` 和至多三个图标按钮，最后一个是关闭）、`ss-panel__body`，需要提交时再加 `ss-panel__foot`。

面板里的内容块：

- 属性表 `<dl class="ss-props">`：左列名称用 `muted`，右列值用 `ink`；值里可以放标签和小号图标按钮。
- 小节标题 `ss-section-title`：12px、500 字重，用 `muted`。
- 正文 `ss-prose`：14/22，段落之间 8px，行内代码用等宽字体。
- 引文 `ss-quote`：左侧 2px `line-strong` 竖线，下方 `ss-quote__src` 写出处（谁、在哪条消息），旁边放「定位到消息」。

## 规则

- 面板推开主区域，不盖在内容上。
- 同一时间只开一个右侧面板；页头里打开它的按钮用 `aria-pressed` 表示状态，再点一次关闭。
- 面板头和页头一样高，底边对齐。
