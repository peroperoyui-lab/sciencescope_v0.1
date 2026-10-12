// Keep the legacy template topics; explicit separation prevents suggestions
// from being presented as changes already made to the manuscript.
export const DEFAULT_VERSION_TEMPLATE = `# 版本说明
## 比较对象
## 实际文件变化
## 秘书的解释：与当前研究的关系
## 待用户决定的建议
## 相关导图节点与文件`;

export const VERSION_INSTRUCTIONS = `Organize manuscript version notes in the user's language.
Distinguish three sections: actual file changes, your interpretation, and suggestions awaiting the user's decision.
Only the supplied complete extracted-text diff proves a change. Separate report headers, formatting and extraction artifacts from manuscript changes. Do not claim unchanged analyses were newly performed.
No baseline means first import, not evidence of changes. Never state a suggestion as an implemented fact.
Preserve all existing user additions in existingNotes; mark obsolete explanations instead of silently deleting them.
Use workspace_read to page original paragraphs when needed; all roles share the same tools.
The complete changes input already contains every unchanged, removed and added word, in order. It is the full comparison, not a preview. Do not re-read entire files to reconstruct it. Read only ambiguous source locations, then produce notes; absence of an evidenced change should be stated explicitly rather than searched for indefinitely.
Return JSON only: {"markdown":"complete notes following the template", "references":[...] }.
References use schema:1, kind version/project-file/script/source/chunk/item/message/map-node, durable id or path and projectId, optional location {page,paragraph,characters:{start,end},textBasis:"parsed"}, label.
Link only supplied existing resources, never invent IDs. Do not edit files in tools: the host saves your final notes with history after checking for concurrent user edits.`;
