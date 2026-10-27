# P4a Windows 性能与后台用量体检 — 2026-10-27

基线 `081fce143f0e46a97cf8a264f6dc53e1fb2b13dd`；修复与工具提交 `4bd7961b7c0b272b21c3a5dce632aba54ee5f51e`。本轮重新生成数据、全新安装测试产品并实测。干净检出完整检查：562/563，失败 1，跳过 0，退出码 1；Windows 内存和 NSIS 覆盖安装两项通过。修复定向测试 27/27，测量工具测试 2/2。所有者同意按实际结果交付，图谱界面测试交 Claude；尚未达到完整检查全部通过，原始失败与诊断见末尾。

## 数据与方法

- Windows 11 26100、Core Ultra 9 275HX、约 32 GB 内存，测试安装及数据位于 USB 机械盘。Node 22.22.2；沿用相同锁文件、原生构建选项与数据，测试包采用已有 Install Test 产品身份。安装器和更新通道源码未变。
- v2 生成器创建 100 PDF、100 DOCX、100 Markdown，实际解析 5060 块；12 个对话共 1000 条消息（最长 180 条），总计 12 个本地工具调用记录、12 个图片附件和 12 个资料附件。长稿件有 50213 个汉字、表格、图片和公式，两个版本有受控修改。生成和相同种子复用都已验证，无模型调用。
- 图操作使用既有全局图，实际显示 100 个论文节点、0 条边。编辑台的真实版本树按钮打开后等待两个版本可见。每个样本通过实际页面操作，写回后通过撤销恢复原 DOCX 字节并核对哈希。
- 正式操作各取 3 次中位数；热测前有一次不计时启动。冷测使用微软签名 RAMMap 清系统文件缓存和 standby list，保存每次清理前后计数。启动计时从原生进程发起到 DOM 就绪，包含 CDP 最早可观察就绪时刻的影响。
- 首次修前热测期间额外连接了 CDP 并截图/检查页面，该组三次结果和全部 profile 保留为 `native-warm-baseline-inspected`；正式修前热测重新独立执行三次。首次修后冷测三次都在 UAC 等待 60 秒后超时、没有启动应用，保留为 `native-cold-after-uac-timeout`；补测在完整检查结束后进行。所有失败或异常样本均保留。
- 补测又有一次 UAC 超时，只补跑缺失样本。修后三个有效冷启动为 18.915、16.014、15.810 秒，来源为 `native-cold-after-retry-attempts` 的第 1/3 次及 `native-cold-after-supplement` 第 1 次；规范汇总逐项保留原始来源、真实清缓存回执和正常退出记录。没有启动应用的超时尝试不进入启动分位数。
- 修前 UI 写回触发一次错误索引，把内部编辑台工作副本作为额外资料导入，形成 301 个来源/5137 块。其中原始 300 个文件仍为 5060 块。修复保留已有目录记录及引用，后续扫描不再重复解析内部副本；外部用户目录中的 `desk/` 仍正常索引。

## 基线表

单位均为毫秒。操作行是三次中位数；HTTP 行来自同一操作时间窗口内的服务端计时，去掉 SSE、静态资源、查询串和具体 ID。最慢十个接口按修前/修后较大的 p95 排序；样本列为修前/修后请求数。请求总数：717/681。

| 操作或接口                               | 修前中位数 / p50 | 修后中位数 / p50 | 修前 p95 | 修后 p95 |    样本 |
| ---------------------------------------- | ---------------: | ---------------: | -------: | -------: | ------: |
| 操作：冷启动：主窗口能输入               |         23737.25 |         16013.91 |        — |        — |   3 / 3 |
| 操作：冷启动：首页数据就绪               |         23747.53 |         16046.59 |        — |        — |   3 / 3 |
| 操作：热启动：主窗口能输入               |          6597.53 |          6859.73 |        — |        — |   3 / 3 |
| 操作：热启动：首页数据就绪               |          6643.60 |          6880.46 |        — |        — |   3 / 3 |
| 操作：切换最长对话                       |           433.47 |           428.22 |        — |        — |   3 / 3 |
| 操作：加载更早消息                       |           358.98 |           423.66 |        — |        — |   3 / 3 |
| 操作：打开项目资料库                     |            66.88 |            65.42 |        — |        — |   3 / 3 |
| 操作：资料库搜索                         |           282.32 |           251.61 |        — |        — |   3 / 3 |
| 操作：全局图：100 个论文节点             |           409.21 |           392.38 |        — |        — |   3 / 3 |
| 操作：打开 5 万字 DOCX                   |           849.92 |           846.75 |        — |        — |   3 / 3 |
| 操作：打开版本树：2 个版本               |           120.70 |           116.81 |        — |        — |   3 / 3 |
| 操作：中间输入一句至写回完成             |           380.32 |           369.12 |        — |        — |   3 / 3 |
| 操作：两个版本比较就绪                   |           310.99 |           321.28 |        — |        — |   3 / 3 |
| HTTP：`GET /api/research/search`         |           119.32 |           137.88 |   121.65 |  2020.59 |   3 / 3 |
| HTTP：`PATCH /api/settings`              |           200.35 |           184.03 |   484.10 |  1255.93 |   6 / 6 |
| HTTP：`GET /api/activity`                |             3.14 |             3.05 |   130.62 |   235.95 |   6 / 6 |
| HTTP：`GET /api/settings`                |             4.29 |             4.12 |   192.19 |    85.52 | 17 / 16 |
| HTTP：`POST /api/desk/sessions`          |            66.87 |            69.71 |    66.97 |   183.66 |   3 / 3 |
| HTTP：`POST /api/desk/sessions/:id/save` |           154.59 |           167.41 |   165.43 |   168.51 |   3 / 3 |
| HTTP：`GET /api/versions/:id/diff`       |           142.87 |           150.90 |   150.69 |   158.71 |   3 / 3 |
| HTTP：`GET /api/participants/:id`        |             9.14 |             6.32 |    80.63 |   156.82 | 48 / 48 |
| HTTP：`POST /api/knowledge/viewport`     |             3.23 |             5.98 |   117.98 |    85.08 | 16 / 10 |
| HTTP：`GET /api/knowledge/layout`        |             2.74 |            55.42 |    78.87 |    89.75 |   4 / 4 |

慢样本照实保留：修后搜索首轮页面耗时约 2418 ms，其余两轮约 240/252 ms。三次热启动中位数从 6.60 s 到 6.86 s，冷启动从 23.74 s 到 16.01 s；后端队列函数的收益单独以配对微基准验证。启动阶段进一步拆分见本地 `startup-phase-comparison.json`：冷启动 createApp 中位 4913.82 → 3076.11 ms，HTTP 监听就绪到首屏绘制 13732.97 → 8564.81 ms，该阶段包含 WebView、资源读盘及调度。

## 后台用量表

全新安装的独立空配置，通过设置页添加实际 OpenCode Go 预设和 flash；20 次发言均由原生输入框发送。原触发设置保持不变。为实际运行记忆提取与核对，通过既有设置把该验收配置的记忆预算从 100000 改为 500000；产品默认值不改。耗时为模型请求累计工作时间，并发请求可重叠；输入含服务商报告的缓存读取/写入 token。

| 类别                   | 请求数 | 输入（含缓存） |  输出 | 总 token |  累计秒 | 结果/观察                                                      |
| ---------------------- | -----: | -------------: | ----: | -------: | ------: | -------------------------------------------------------------- |
| 连接测试               |      1 |             37 |    11 |       48 |   3.306 | 设置页单独统计                                                 |
| 主回答                 |     20 |         157261 |  3303 |   160564 |  79.163 | 同一对话 20 轮，20/20 完成                                     |
| 版本说明               |      2 |          12109 |  3131 |    15240 |  25.698 | 两个导入版本各 1 次；两次都在前台忙碌时启动                    |
| 纪要                   |      2 |           4499 | 12958 |    17457 | 104.305 | 2 次，覆盖全部 40 条消息；1 次与前台时间重叠，启动时前台空闲   |
| 知识库论文卡片         |      1 |            719 |  4119 |     4838 |  27.463 | 1 个新来源整理 1 次，完成                                      |
| 记忆整理               |      4 |          34826 | 36424 |    71250 | 243.295 | 提取/核对各 2 次，44 个待确认候选；验收预算 500000             |
| 安装版合计             |     30 |         209451 | 59946 |   269397 | 483.231 | HTTP 失败 0，缺失用量 0                                        |
| 补充让路验证：原夹具   |      3 |          13588 |  3438 |    17026 |  27.342 | 顺序断言通过；服务未接齐及额外内容断言导致原脚本失败，记录保留 |
| 补充让路验证：修正夹具 |      3 |          14140 |  3680 |    17820 |  37.381 | 一次通过；前台占用时 0 请求，释放后纪要和版本说明完成          |
| 全部真实请求           |     36 |         237179 | 67064 |   304243 | 547.954 | 均为 OpenCode Go deepseek-v4.1-flash                           |

- 安装版四类后台功能全部运行；没有一项按每轮用户发言触发。记忆按原有 10 分钟空闲规则自然启动，纪要更新会重新开始空闲计时；候选全部留待用户确认，验收未接受候选。
- 可重建输入上下文 24/30 次（主回答 14/20，全部 10 次设置/后台请求均覆盖）。相同完整前缀及相同最后输入哈希重复均为 0。安装版没有工具重读：两个版本各一个说明请求，29 条 thinking 活动未算作工具调用。
- 记忆按两次不同纪要修订提取与核对：第一批输入 29 行新增纪要及 6 条原文；第二批为 61 行新增、12 行移除及 40 条原文，前 6 条标为 `evidenceOnly` 复用作证据。对应核对再次读取原文及候选。这些来源复用和完全相同请求分开记录；第二批输入更大，记忆四次请求总量 71250 token。
- 默认预算问题已定位：服务商模型元数据的最大输出 384000 被整体预留，默认每次记忆预算 100000 会在请求前跳过。需要所有者决定预算/预留策略，本轮未更改。
- 修复后的补充验证使用当前源码服务及脚本化前台占用，后台为真实 flash。原夹具遗漏编辑台服务，又要求首版说明复述输入中未提供的数值，导致附带语义断言失败；其 `workspace_read manuscript` 参数符合公布的工具格式。补齐夹具服务并按实际输入契约验证后，新的独立单次验证通过。原有 3 次请求仍计入总用量。修正验证的版本说明使用一次成功读取及一次正常模型续接，完整上下文不同。

## 修复、原因与验证

1. 启动队列逐来源提交并重复汇总 → 同一事务恢复整批任务，最后发布完整状态 → Node 22 三组交替配对微基准：300 来源/6000 块，101.760 → 42.531 ms（-58.20%），通知 301 → 2，任务完整保留。原生计时独立列在上表。启动、重启和单来源增量回归通过。
2. 纪要在异步准备后漏查前台 → 请求前重查并保留待更新任务 → 强制并发回归证明旧代码会抢跑、修后等待再只更新一次；真实补充验证前台占用时 SDK 请求为 0。
3. 版本说明没有前台门控 → 准备前及发出前等待，发言结束唤醒 → 安装版实测两次抢跑，修后脚本覆盖等待、准备中竞争、关闭与不同项目后台并发；真实请求在释放前台后完成。
4. 内置项目扫描包含编辑台工作目录 → 仅内置项目的内部 `desk/` 加入排除项 → 修前受控回归复现额外来源，修后测试证明内部副本不解析、外部用户同名目录仍可读。既有错误目录记录保留，未手动清理验收库。

## 界面与原生交接（Claude）

- 对话：打开最长对话，滚至最后消息并向上加载一页。修后抽样的产品帧为 `actions.js:106` 匿名函数 31.93 ms、`renderMarkdown` 4.56 ms；原生几何 getter 的父调用需在 DevTools 检查，自动化就绪检测也会产生几何读取。
- 图：打开全局知识库的图视图，100 节点。`components/knowledge-graph.js:173` 匿名帧最高 7.83 ms，Cytoscape 绘制帧在本地 profile 保留。
- 编辑台：打开 5 万字 DOCX，产品函数 `countWords`（`desk-blocks.js:337`）最高 7.33 ms，`mountEditor` 3.24 ms；打开版本树的 `formatTime` 最高 4.81 ms。比较两版的 `renderComparePage` 2.02 ms，`topIn` 1.68 ms。
- 用户补充的图标模糊：当前 Cargo.lock 锁定 tauri-codegen 2.6.3，`CachedIcon::new_ico` 取 ICO 第一帧作为窗口 RGBA。项目 ICO 第一帧 16×16，随后才是 20/24/32/40/48/64/256，造成窗口图标小图放大。建议指定合适的高分辨率窗口图标或调整生成入口；本轮只定位。
- 用户补充的任务栏多页：`src-tauri/src/main.rs` 的助手面板和浮球分别创建两个顶层窗口，均未设置 `skip_taskbar`。需由 Claude 协调其任务栏行为；本轮未改原生窗口或 UI。

## 复测与证据

方法见 [tools/perf/README.md](../../../tools/perf/README.md)。参考既有 Node diagnostics_channel/Chromium Profiler 接口；合成文档沿用 PDF-lib、JSZip 和 canvas（均 MIT），没有新增依赖或复制第三方实现。源码改动为知识队列/扫描、纪要、版本说明及各自测试；测量工具在 `tools/perf/`，界面与原生源码未改。

本机原始证据位于工作区忽略目录 `.sciencescope-local/temp/p4a/`：正式四组 native 报告及 HTTP 日志/CPU profile、版本树截图；`live-baseline/` 安装版逐轮及逐请求记录；`priority-live/` 原失败与 `priority-live-corrected/` 修正验证；`check-final.log` 完整检查。后端定向测试和配对基准在相邻 `p4a-backend/`。生成资料、截图、日志及密钥均未提交；测试凭据已移除，用户预览安装及其数据未触及。测试产品与合成数据保留用于复测。

## 完整检查唯一失败：交 Claude

所有者决定：按 562/563 的实际结果交付，保持 app/ui 白名单。Windows 两项测试通过；整套检查用时 1973.394 秒。以下是原始完整检查的失败段，路径仅做公开仓库脱敏。

```text
# Subtest: the knowledge graph centres, connects, merges, pins, filters and undoes
not ok 486 - the knowledge graph centres, connects, merges, pins, filters and undoes
  ---
  duration_ms: 50298.139
  type: 'test'
  location: '<clean-checkout>\\app\\ui\\knowledge-graph.browser.test.js:71:1'
  failureType: 'testCodeFailure'
  error: |-
    locator.waitFor: Timeout 30000ms exceeded.
    Call log:
    [2m  - waiting for locator('.kb-picker') to be visible[22m

  code: 'ERR_TEST_FAILURE'
  name: 'TimeoutError'
  stack: |-
    <clean-checkout>\app\ui\knowledge-graph.browser.test.js:164:20
    async withBrowserApp (<clean-checkout>\app\ui\browser-testing.js:60:5)
  ...
```

定位：测试先取目标节点坐标，再等待源节点手柄同步，两端采样没有同步。连接菜单由拖拽释放时的本地命中检查打开，选择菜单项后才发创建关系请求。原始失败没有记录整段手势轨迹，目前仍需区分过期坐标、指针起点、几何变化或实际界面事件问题。

### 原样单跑一次：完整输出

命令（同一干净候选，Node 22 / Edge）：

```sh
node --test --test-name-pattern="^the knowledge graph centres, connects, merges, pins, filters and undoes$" app/ui/knowledge-graph.browser.test.js
```

这一次在更早的边悬停步骤失败，没有走到原失败的连线步骤。

```text
TAP version 13
# (node:97156) ExperimentalWarning: SQLite is an experimental feature and might change at any time
# (Use `node --trace-warnings ...` to show where the warning was created)
# (node:97156) ExperimentalWarning: SQLite is an experimental feature and might change at any time
# (Use `node --trace-warnings ...` to show where the warning was created)
# Subtest: the knowledge graph centres, connects, merges, pins, filters and undoes
not ok 1 - the knowledge graph centres, connects, merges, pins, filters and undoes
  ---
  duration_ms: 41462.7091
  type: 'test'
  location: '<clean-checkout>\\app\\ui\\knowledge-graph.browser.test.js:71:1'
  failureType: 'testCodeFailure'
  error: |-
    locator.waitFor: Timeout 30000ms exceeded.
    Call log:
    [2m  - waiting for locator('.kb-graph__hover') to be visible[22m

  code: 'ERR_TEST_FAILURE'
  name: 'TimeoutError'
  stack: |-
    <clean-checkout>\app\ui\knowledge-graph.browser.test.js:112:19
    async withBrowserApp (<clean-checkout>\app\ui\browser-testing.js:60:5)
  ...
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 53461.3589
```

### 未应用候选及一次独立验证

候选把两端坐标放在同一次相机/手柄就绪检查内取出，并检查拖拽是否开始，不增加等待时长或重试。只在忽略目录副本验证，三处相对导入指向同一干净源码；跟踪的 app/ui 文件未改。

```diff
diff --git a/app/ui/knowledge-graph.browser.test.js b/app/ui/knowledge-graph.browser.test.js
--- a/app/ui/knowledge-graph.browser.test.js
+++ b/app/ui/knowledge-graph.browser.test.js
@@ -140,26 +140,43 @@
         await fsqcaTitle.waitFor({ timeout: 3000 }).catch(() => {});
       }
       await fsqcaTitle.waitFor();
-      const target = await at(page, ref.consistency);
-      // The handle sits at the selected node's right edge once the view is still.
-      const start = await (
-        await page.waitForFunction(() => {
-          const host = document.querySelector('[data-kb-map]');
-          const map = /** @type {any} */ (host).knowledgeMap;
-          const handle = document.querySelector('.kb-map__handle');
-          const expected = map.handlePoint(map.selected()[0]);
-          if (!handle || !expected) return null;
-          const box = host.getBoundingClientRect();
-          const rect = handle.getBoundingClientRect();
-          const x = rect.left + rect.width / 2;
-          const y = rect.top + rect.height / 2;
-          return Math.hypot(x - box.left - expected.x, y - box.top - expected.y) < 1 && { x, y };
-        })
-      ).jsonValue();
-      await page.mouse.move(start.x, start.y);
-      await page.mouse.down();
-      await page.mouse.move(target.x, target.y, { steps: 8 });
-      await page.mouse.up();
+      // Sample both endpoints together after selection and camera animation settle.
+      const { start, target } = await (
+        await page.waitForFunction(
+          ([sourceRef, targetRef]) => {
+            const host = document.querySelector('[data-kb-map]');
+            const map = /** @type {any} */ (host).knowledgeMap;
+            if (map.cy.animated() || map.selected()[0] !== sourceRef) return null;
+            const handle = document.querySelector('.kb-map__handle');
+            const expected = map.handlePoint(sourceRef);
+            const destination = map.cy.getElementById(targetRef);
+            if (!handle || !expected || destination.empty() || destination.hasClass('hidden'))
+              return null;
+            const box = host.getBoundingClientRect();
+            const rect = handle.getBoundingClientRect();
+            const x = rect.left + rect.width / 2;
+            const y = rect.top + rect.height / 2;
+            if (Math.hypot(x - box.left - expected.x, y - box.top - expected.y) >= 1)
+              return null;
+            if (!handle.contains(document.elementFromPoint(x, y))) return null;
+            const point = destination.renderedPosition();
+            return {
+              start: { x, y },
+              target: { x: box.left + point.x, y: box.top + point.y },
+            };
+          },
+          [ref.fsqca, ref.consistency],
+        )
+      ).jsonValue();
+      await page.mouse.move(start.x, start.y);
+      await page.mouse.down();
+      assert.equal(
+        await onMap(page, 'return map.cy.getElementById("__ghost").nonempty();'),
+        true,
+        'the connection handle must start a drag',
+      );
+      await page.mouse.move(target.x, target.y, { steps: 8 });
+      await page.mouse.up();
       const picker = page.locator('.kb-picker');
       await picker.waitFor();
       assert.match(await picker.innerText(), /fsQCA → 一致性阈值/);
```

独立副本命令：

```sh
node --test --test-name-pattern="^the knowledge graph centres, connects, merges, pins, filters and undoes$" .sciencescope-local/temp/p4a/graph-diagnostic/candidate.test.mjs
```

```text
TAP version 13
# (node:59268) ExperimentalWarning: SQLite is an experimental feature and might change at any time
# (Use `node --trace-warnings ...` to show where the warning was created)
# (node:59268) ExperimentalWarning: SQLite is an experimental feature and might change at any time
# (Use `node --trace-warnings ...` to show where the warning was created)
# Subtest: the knowledge graph centres, connects, merges, pins, filters and undoes
ok 1 - the knowledge graph centres, connects, merges, pins, filters and undoes
  ---
  duration_ms: 14746.8195
  type: 'test'
  ...
1..1
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 16077.5219
```

候选副本这一次通过；原样单跑失败点不同，因此候选仍交 Claude 继续验证，完整检查仍记为 562/563。
