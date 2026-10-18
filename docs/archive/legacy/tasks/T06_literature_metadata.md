# T06 · 文献元数据：查询、导入导出、citekey、去重

共同规则见 `docs/tasks/RB_COMMON.md`。

## 目标
让文献有完整、规范的书目信息（字段采用 CSL-JSON），并能与 Zotero 和 BibTeX 生态互通。

## 后端 `scripts/research-base/metadata.mjs`（新模块）
1. **标识符查询**（每个主机单独做令牌桶限流，按标识符缓存到表 `rb_metadata_cache`，失败时指数退避并如实报告原因）：
   - DOI → Crossref `/works/{doi}`（请求带 `mailto`，邮箱由用户在设置中填写）；OpenAlex 作为补充（**2026-02 起需要 API key**，同样在设置中填写）。
   - arXiv ID → arXiv API（每 3 秒不超过 1 个请求）；PMID → NCBI E-utilities；ISBN → Open Library。
   - 输出为规范化的 `source` 补丁：`title, authors[{given,family}], year, venue, doi, abstract, url, csl`。
2. **导入**：BibTeX、RIS、CSL-JSON（`@citation-js/core` 及对应插件，MIT），批量创建来源，并按 DOI 或"标题 + 年份 + 第一作者"去重；遇到重复时返回冲突列表，由用户选择合并或跳过。
3. **导出**：BibTeX / RIS / CSL-JSON，支持选中项或整个项目；**citekey** 采用 Better BibTeX 风格的 `{第一作者姓}{年份}{标题首个实词}`，冲突时加 a/b，生成后固定写入 `rb_sources.citekey`。
4. **自动补全**：解析器找到 DOI 或 arXiv 时（T04 的 metadata），入队查询，只补空字段，不覆盖用户填写的内容。
5. 路由：`POST /api/research/metadata/lookup {identifier}`、`/metadata/apply {sourceId, patch}`、`/import {format, text, projectId}`、`GET /api/research/export?format=&ids=`。
6. 设置：Crossref 联系邮箱、OpenAlex API key（**只写入不回显**，存放在与 Provider key 相同的受保护位置，不进被跟踪的文件，不出现在任何 API 响应中）。

## 前端
- 文献页中"从 DOI / arXiv 添加"、"导入 BibTeX / RIS"（文件或粘贴）、"导出"；元数据编辑表单中有"从 DOI 补全"。
- 重复项对话框：并排比较字段，选择保留或合并。

## 验收
- 单元测试：使用录制好的 Crossref / arXiv 响应（本地 HTTP 夹具）测试解析、限流、缓存、去重、citekey 冲突、BibTeX 往返（导出后再导入，字段不丢失）。**测试中不访问外网**。
- 可选的付费或联网验证单独写成 `scripts/evals/metadata-live.mjs`；如果云端网络拦截（Crossref 曾被拦），如实报告"未验证"。
