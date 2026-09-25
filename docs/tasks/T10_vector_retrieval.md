# T10 · 向量检索、上下文前缀与重排（检索 S2 / S3）

共同规则见 `docs/tasks/RB_COMMON.md`。前置条件：T09 的评测集可以运行（用它证明检索确实变好了，而不是凭感觉）。

## 内容
1. **向量存储**：`sqlite-vec`（MIT / Apache；备忘录 §3 已实测可在 node:sqlite 中加载，注意 rowid 要用 BigInt 绑定、加载后关闭扩展加载），
   新表 `rb_vec_chunks` / `rb_vec_items`（vec0）。Windows 打包时要把 `sqlite-vec-windows-x64` 的 DLL 放进 Tauri 资源并签名；加载失败时自动退回纯 FTS，并在状态中说明。
2. **嵌入来源**（设置中选择，默认关闭）：
   - Provider 的 embeddings 接口（OpenAI 兼容 `/embeddings`，模型名由用户填写）；
   - 本地模型：`@huggingface/transformers` + multilingual-e5-small（MIT）。**首次下载必须由用户在设置中点击触发**，模型文件放在应用数据目录。
   - 嵌入在后台增量计算，并显示进度；更换嵌入模型后需要全部重算。
3. **融合**：`search.mjs` 增加一个可选的 `vectorRanker` 注入点（这是唯一允许对框架做的改动，需要先与 Claude 确认接口），用 RRF(k=60) 融合 FTS 与向量结果。
4. **上下文前缀（Contextual Retrieval）**：导入时用便宜模型为每段生成 50–100 字的上下文前缀，同时写进 FTS 和向量索引；结果缓存，可在设置中关闭。
5. **重排**（可选）：用便宜模型对前 20 条结果做列表式重排。

## 验收
- 使用 T09 的评测集和一个检索评测集（在夹具文献上人工标注 50 个查询的相关段落），报告 Recall@5 / @10：纯 FTS、FTS + 向量、再加前缀、再加重排，逐项对比。
- 没有提升的步骤就不默认开启；把结论如实写进 DESKTOP_IMPLEMENTATION。
