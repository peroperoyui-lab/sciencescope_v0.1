---
name: edit-workspace
description: 修改工作区并留版本：读写研究导图、计划、日志、纪要和笔记，改错时撤销或恢复历史版本。用户要求更新项目材料或记录进展时使用。
metadata:
  title: 修改工作区并留版本
---

# 修改工作区并留版本

工作区是用户在界面里看到的项目材料。你的修改立即生效，本轮结束时自动留一个历史版本，用户随时能恢复，所以不用先请示，但要改得准、改完说清楚。

## 先读再改

用 `workspace_read` 看当前内容，再决定改哪里：

| 内容                     | target     | key                                |
| ------------------------ | ---------- | ---------------------------------- |
| 所有项目和对话           | `overview` | —                                  |
| 一个项目（含对话和笔记） | `project`  | 项目 id                            |
| 研究导图                 | `map`      | 项目 id                            |
| 计划                     | `plans`    | 项目 id，或 `global`               |
| 研究日志                 | `log`      | 项目 id                            |
| 对话纪要                 | `minutes`  | 会议 id                            |
| 笔记                     | `notes`    | 项目 id 或名称；列出笔记用 `scope` |
| 最近的修改               | `changes`  | 可选会议 id                        |

## 怎么改

用 `workspace_edit {resource, key, op, args}`：

- **文字类**（计划、日志、纪要、笔记）：小改用 `replace {find, with}`，`find` 要从刚读到的原文里原样复制；追加用 `append {text}`；整篇重写才用 `write {text}`，会覆盖用户的手工修改，慎用。
- **导图**：`addNode {node:{parent, text}}`、`updateNode {id, changes}`、`removeNode {id}`、`addEdge {edge:{from, to, label}}`、`removeEdge {id}`。节点 id 从 `workspace_read` 的结果里取。
- **日志引用文件**：在日志条目里加 `<!-- sciencescope:references [...] -->`，格式见工具说明，用户点一下就能打开对应版本或项目文件。

改完在回答里用一两句话说改了什么、在哪里，不要把改后的全文再贴一遍。

## 改错了

- 本轮刚做的修改：用 `workspace_undo {revisionId}`，revisionId 在 `workspace_edit` 的结果里。
- 更早的内容：`workspace_versions {action:'list'}` 找到版本，`read` 看内容，`restore` 恢复。恢复前当前内容会先存成一个版本，所以恢复也能再恢复。

## 不要做

- 用户没要求时不重写整篇计划或日志；用户手改过的内容以用户为准。
- 不要为了「整理」删除用户写的条目。
- 不要改其他项目的数据，除非用户明确要求（全局助手按用户的要求跨项目整理是正常的）。
