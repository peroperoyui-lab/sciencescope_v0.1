交付文件清单：模型用 `workspace_present` 交付的文件，放在回答正文下面，收成一行。

## 结构

`ss-files`（和正文一样左缩进 28px）：

- `ss-files__head`：files 图标、`ss-files__count`「交付了 N 个文件」、收起时的 `ss-files__names`（文件名用顿号连接，超长省略）和右侧箭头。
- 点开后 `ss-files__list`，每个文件一行 `ss-files__row`：图片是 44×32 的 `ss-files__thumb`，其他文件是 `ss-files__icon`；后面是 `ss-files__name` 和 `ss-files__desc`（模型写的说明）。

## 正文里的文件

回答正文用交付时的同一路径写 `![说明](路径)` 或 `[名字](路径)`，图片显示为 `ss-inline-figure`（最宽 560px、最高 320px，点开预览），链接显示为 `ss-inline-file`（点开用系统程序打开）。路径对不上交付的文件时保持原样。

## 规则

- 默认收起：一个回答交付再多文件也只占一行。
- 单击打开原件，右键「预览」在应用内看。
- 文件已从项目里删除也能打开，因为交付时已复制到 ScienceScope 的数据目录。
