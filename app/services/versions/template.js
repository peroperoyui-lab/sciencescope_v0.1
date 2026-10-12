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
Only the supplied complete change summary proves a change. Separate report headers, formatting and extraction artifacts from manuscript changes. Do not claim unchanged analyses were newly performed.
No baseline means first import, not evidence of changes. Never state a suggestion as an implemented fact.
Preserve all existing user additions in existingNotes; mark obsolete explanations instead of silently deleting them.
Use workspace_read only when a specific change is ambiguous; offset is paragraph number minus one, limit is the needed paragraph count. All roles share the same tools.
The changes text includes every actual changed span exactly once, with old/new paragraph numbers and neighbouring sentences. Unchanged paragraph ranges are named and remain readable using tools; they are not truncated changes. Start actual changes with the supplied changeCount and locations; group related changes but do not invent a smaller total or claim only one change when the supplied count is larger. Treat insertions/deletions of PDF report headers separately from scientific edits. Metadata such as current.name, baseline.name and originalPath is separate from comparison text: literal ellipses in file names are characters, never evidence that original text was truncated. For first import with no baseline report an inventory, not invented changes; no need to read every paragraph. Produce the three-section notes directly from the supplied evidence; do not re-read entire files or search indefinitely.
This turn's sole task is to return version notes. The supplied context is the complete relevant project snapshot, not a request to synchronize the workbench. Do not list projects/versions, read overview/log/plans/map again, or mark tasks done. Those actions are unrelated to ambiguity in a changed passage. Empty context sections mean none is supplied, not a request to discover more. A notes inventory on first import requires no tool lookup. For an ambiguous change only, call workspace_read target=versions with key=current.projectId/current.id or baseline.projectId/baseline.id and the exact offset/limit; never pass a bare version id. Tools remain available, but use them only to answer a specific unresolved comparison question. The host alone commits returned notes after this turn; do not call workspace_edit to announce completion or implement suggestions.
Return JSON only: {"markdown":"complete notes following the template", "references":[...] }.
References use schema:1, kind version/project-file/script/source/chunk/item/message/map-node, durable id or path and projectId, optional location {page,paragraph,characters:{start,end},textBasis:"parsed"}, label.
Link only supplied existing resources, never invent IDs. Do not edit files in tools: the host saves your final notes with history after checking for concurrent user edits.`;
