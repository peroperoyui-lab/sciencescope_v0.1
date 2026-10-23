import { planProjects } from './projects.js';
import { planMeetings, planKnowledge } from './content.js';
import { planConfiguration } from './configuration.js';
import { planDatabaseRecords } from './records.js';

/** @param {any} context */
export async function planExport(context) {
  context.projectFolders = new Map();
  await planProjects(context);
  await planMeetings(context);
  await planKnowledge(context);
  await planConfiguration(context);
  planDatabaseRecords(context);
  context.writer.json('脱敏记录.json', context.statistics);
  context.writer.json('未复制文件.json', () => context.writer.skipped);
  context.writer.text(
    'README.md',
    `# ScienceScope 全部数据导出

导出时间：${context.createdAt}
程序版本：${context.appVersion}
数据库版本：${context.db.prepare('PRAGMA user_version').get().user_version}

## 文件夹

- 对话：全部对话（包括归档、临时和分支）的 Markdown 与完整 JSON。JSON 保留 meeting 原表列、成员、完整消息、发言人、时间、refs_json 标记/附件引用、交付文件、研究输入、turns 和 tool_calls。分支保留 parent_meeting_id/fork_message_id。
- 项目：项目设置、Python 绑定、工作站、计划、日志、导图 JSON/Markdown、纪要和笔记。项目名附 ID 避免同名混淆。编辑台含每个版本原文件、版本说明、版本.json（父版本/时间/说明及 export_path）、索引和批注。
- 项目文件夹：只有实际位于数据目录内的项目文件夹会复制。外部文件夹只在项目.json 保留路径及 export_project_folder 说明。
- 知识库：资料元数据、带 chunk ID/页码的正文、原件、全部条目及论文卡片的 Markdown/JSON、实体与含 evidence_json 证据的关系。
- 专家：每位 AI 的原始设定 Markdown、模型/工具/技能 JSON 和独立记忆 Markdown；参与者.json 供对话中的 author_id 对照。
- 技能：已安装技能的原文件。
- 设置.json：设置和服务商列表，以及 Python 环境清单/绑定。服务商自定义 header 值统一替换为“<已移除>”，名称保留；MCP 的明文 header/env 同样处理，keyRef 对象原样保留，不解析凭据值。
- 全局：不属于项目的计划和纪要。对话/附件保留交付文件与图片。
- 数据库/sciencescope.sqlite：后台线程通过 VACUUM INTO 创建的一致副本，包含向量；读取向量表需要 sqlite-vec。数据库/记录 中各 JSON 是同一快照的非索引表，包含完整修订、历史版本、标签、关联、批注、附件索引等。

## 字段与复制规则

JSON 沿用现有数据库列名；以 _json 结尾的列转换为 JSON 值，其他值原样保留。引用 ID 不变。原件按资料 ID 分目录保留原文件名。本文所列结构是可读导出，不提供导回功能。

数据库以 VACUUM 快照时刻为准；仅导出副本移除当前/历史 header/env 明文值，以及这些值在事件、修订、嵌套 JSON 等处的副本，重算修订和历史快照哈希，再 VACUUM 清除旧页。原数据库不修改，行数保持不变。脱敏记录.json 列出发现和处理的表/列及数量，不记录值。用户文件按实际复制时刻保存。导出期间可继续使用应用。名称冲突会加序号，不覆盖已有文件。

默认不复制项目文件的库内副本（includeProjectCopies=${context.includeProjectCopies}）；用户自己的外部项目文件夹始终不复制。secret/ 凭据、logs/、backups/、runtime/、Python 环境本体、models/ 和 webview 数据均不导出。符号链接不跟随。原文件缺失或不在允许范围内的明细见 未复制文件.json。

完成前目录保留“（未完成）”；取消、关闭应用或失败时也保留该后缀。下次启动不会自动续传。
`,
  );
}
