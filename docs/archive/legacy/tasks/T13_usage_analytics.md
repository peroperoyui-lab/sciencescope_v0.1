# T13 · 用量分析（设置 → 用量分析）

共同规则见 `docs/tasks/RB_COMMON.md`；开关机制见 `docs/tasks/FEATURE_FLAGS.md`（开关 `usage`）。交付分支：`codex/t13-usage-YYYYMMDD`。

## 目标
让用户看到模型在各项目、各角色、各模型上用了多少 token，数据来自服务商实际报告的用量，不做估算冒充。

## 宿主
1. 记录：每个完成的模型步骤写一行 `usage_events`（应用数据库，新模块 `scripts/usage-store.mjs` 中 `CREATE TABLE IF NOT EXISTS`）：
   `time, chat_id, project_id, role（main / expert:<id> / secretary / assistant / organizer）, provider_id, model_id, input_tokens, output_tokens, cached_tokens, reported（1=服务商报告，0=缺失）`。
   数据来源：运行时事件中服务商返回的 usage（先在 `adapters/runtime-dsh/host.mjs` 中确认事件里有哪些字段；需要改该文件时先告诉 Claude）。服务商没有返回用量时记 `reported=0`，不要用 token-meter 的估算填充。
2. `GET /api/usage?from=YYYY-MM-DD&to=YYYY-MM-DD&groupBy=day|project|role|model` → `{rows:[{key,label,inputTokens,outputTokens,cachedTokens,turns,unreported}], totals}`。
3. 不计算费用（各服务商价格不同且会变）；以后如果做，价格由用户在模型服务设置中填写。
4. `capabilities.features.usage = true`（记录模块创建成功时）。

## 前端（`desktop/usage.mjs`，由 `settings.mjs` 的 `settingsContent('usage')` 调用）
- 标题"用量分析" + "i"说明（数据来源、未报告的步骤不计入）。
- 时间范围：近 7 / 30 / 90 天；总计（输入、输出、缓存 token，轮数）；按项目 / 角色 / 模型 / 日期切换的表格；
  日期视图用简单的 CSS 条形图（不引入图表框架），深浅色都要协调。
- 有未报告用量时显示一行状态："有 N 个步骤服务商未返回用量"。

## 验收
- 单元测试：聚合、分组、时间范围、未报告计数。
- 界面 smoke：用模拟宿主发出带 usage 的事件，页面数字一致；开关关闭时设置导航中没有"用量分析"。
- 真实模型（便宜模型）跑 3 轮，对照服务商控制台的数字，误差写进报告。
