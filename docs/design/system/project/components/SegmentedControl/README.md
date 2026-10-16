两到四个互斥选项的分段切换，点了立即生效。

## 结构

`<div class="ss-seg" role="group" aria-label="主题"><button type="button" aria-pressed="true">浅色</button>…</div>`

- `ss-seg--sm`：输入栏、浮层、表头里的紧凑版本。
- `ss-seg--icons`：只有图标时用，每个按钮带 `aria-label` 和 `data-tip`。

## 何时用

主题、列表或表格视图、思考强度、阅读状态、发送快捷键。超过四个选项改用 Select。

## 规则

- 每段文字不超过四个字，长度尽量接近。
- 不用它做导航；页面之间的切换用 Tabs。
