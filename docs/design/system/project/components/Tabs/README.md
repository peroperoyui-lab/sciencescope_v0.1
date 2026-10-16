页内标签：每页只有一行，放在 44px 页头里，用来切换同一类内容的不同部分。

## 结构

`<nav class="ss-tabs" role="tablist"><button class="ss-tab" role="tab" aria-selected="true">文献与资料<span class="ss-tab__count">8</span></button>…</nav>`

选中的标签文字变成 `ink`，下方有 2px 的 `accent` 线；数量用 `ss-tab__count` 写在文字右侧。

## 规则

- 每页只有一行标签，不在标签下面再放第二行。范围（当前项目、我的资料）放进页头左侧的轻量选择器。
- 没有内容的标签照常显示，进入后显示空状态；不禁用标签。
- 标签文字两到五个字。
