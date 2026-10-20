知识库的零件：节点种类、文件索引状态、三种关系线、AI 和缺证据标记、悬停卡片、拖线选关系、合并确认、图的空状态、删除后的撤销。

## 结构

- `ss-kind`：种类图标或 `ss-kind__dot` 加名称。颜色由 `data-node-kind` 设到 `--kind`，取 kg- 令牌：文献 kg-source、方法与变种 kg-method、数据集 kg-dataset、变量与指标 kg-variable、软件与代码 kg-software、概念与自定义种类 kg-concept、人物与机构 kg-agent。
- 索引状态：`ss-dot--ok` 已解析、`ss-spin` 解析中、`ss-dot--ring` 仅索引文件名、`ss-dot--danger` 失败。
- `ss-ai`：AI 添加且之后没人改过；`ss-ai--missing`：AI 写的但没有引文或消息依据。
- `ss-graph__float`：浮在画布上的卡片（中心节点、深度、工具、图例、缩放、悬停卡片）。
- 拖线后弹出关系菜单（ss-menu）：顶部搜索框可以输入自定义关系，常用关系在前，最后一项是反向。
- 合并用确认对话框，写清改挂几条关系、别名怎么处理、可以撤销。

## 规则

- 关系名存英文键（cites、uses、implements……），中英文显示名放 i18n 同一张表；自定义键直接显示。
- 删除、合并立即生效；页内 Ctrl+Z / Ctrl+Shift+Z，离开后成为一个历史版本。
- 用户和模型写的内容不翻译。
