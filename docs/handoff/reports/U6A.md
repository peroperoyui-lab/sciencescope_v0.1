# U6A Windows 验收交接（2026-10-26）

受检 main：`146c1fe988531d0fe1d3a86710cdd90eca6cd8c7`。用户决定保留界面测试白名单，按实际 **543/545** 交付。本任务没有产品代码或测试改动；此报告随下一项 D10 的文档提交，供 Claude 审阅。

- 干净检出独立 npm ci（450 个依赖，npmmirror）后完整检查：543 通过、2 失败、0 跳过；U6 的五项浏览器测试和两项 Windows NSIS 测试通过。
- `app/ui/desk.browser.test.js`：`tables keep their cells and bookmarks survive text deleted around them`，完整错误、actual XML 和复制夹具的单跑输出见下。首轮原因未确定，复制夹具单跑通过不覆盖原失败。
- `app/ui/md-blocks.test.js`：`blocks add up to the source and every block writes back as it was read`；报错原文 `Expected values to be strictly equal:`。docs 样本在 Windows 检出后含 CRLF，直接传给接受 LF 的函数，断言因 169 处换行不同失败。Claude 后续已在 main `36d768d` 修测试输入；本次 U6A 仍记原结果。
- TeX 通过：中文渲染、公式编辑保存、两个 input、ref/cite、MiKTeX 编译（5,010 ms）、故意错误第 18 行跳转、无引擎按钮停用。
- Markdown 两份字节比较失败：列表新增空行，CRLF 文件混入 LF，任务项保存为 `- [x] [ ]`；BOM 和其余未改区域保留。
- PDF 26/30：合成中文期刊和英文双栏各 10/10，Word 导出中文 6/10；逐位置结果与复现见下。成功标记的缩放、定位、重开通过，三份 PDF 字节不变、关闭不问写回；资料库预览划选未见横向错位。
- 新装独立测试产品中，PDF 引用真实模型 1 请求、6,280 tokens，回答正确比较引用阈值 0.80 与用户阈值 0.75；额外后台请求 0。
- 正常关闭后无残留进程与 WAL/SHM；测试产品已卸载，测试数据、凭据和注册记录已清除，用户预览及备份未动。
- 原始输出、截图、逐字节比较与 PDF 文字层证据留在验收工作区的 `.sciencescope-local/temp/u6a/`。下列命令和堆栈仅将本机绝对路径改成占位符，其余诊断保留；无截图、稿件或构建产物入库。

## 1. DOCX 表格：首轮原测试失败

- 测试文件：<u6a-worktree>\.sciencescope-local\temp\u6a\clean-checkout\app\ui\desk.browser.test.js。
- 测试定义：第 344 行；失败断言：第 387 行。
- 精确测试名：tables keep their cells and bookmarks survive text deleted around them。
- 原 fullcheck TAP 编号：458。
- 报错原文、actual 和完整 stack 均在下面原始诊断块内。实际保存 XML 中乙单元格为空，预期存在乙二。

### 原 fullcheck 完整 TAP 诊断块

````text
# Subtest: tables keep their cells and bookmarks survive text deleted around them
not ok 458 - tables keep their cells and bookmarks survive text deleted around them
  ---
  duration_ms: 30868.0123
  type: 'test'
  location: '<u6a-worktree>\\.sciencescope-local\\temp\\u6a\\clean-checkout\\app\\ui\\desk.browser.test.js:344:1'
  failureType: 'testCodeFailure'
  error: |-
    The input did not match the regular expression /<w:t[^>]*>乙二<\/w:t>/u. Input:

    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:bookmarkStart w:id="1" w:name="mark"/><w:bookmarkEnd w:id="1"/><w:r><w:t xml:space="preserve">整段改写</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>甲</w:t></w:r></w:p></w:tc><w:tc><w:p></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>丙</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>丁</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>表后</w:t></w:r></w:p><w:sectPr/></w:body></w:document>'

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
  actual: '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:bookmarkStart w:id="1" w:name="mark"/><w:bookmarkEnd w:id="1"/><w:r><w:t xml:space="preserve">整段改写</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>甲</w:t></w:r></w:p></w:tc><w:tc><w:p></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>丙</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>丁</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>表后</w:t></w:r></w:p><w:sectPr/></w:body></w:document>'
  operator: 'match'
  stack: |-
    <u6a-worktree>/.sciencescope-local/temp/u6a/clean-checkout/app/ui/desk.browser.test.js:387:14
    async withBrowserApp (<u6a-worktree>/.sciencescope-local/temp/u6a/clean-checkout/app/ui/browser-testing.js:60:5)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
# (node:52896) ExperimentalWarning: SQLite is an experimental feature and might change at any time
# (Use `node --trace-warnings ...` to show where the warning was created)
````

### 原动作顺序的复制夹具：一次单跑未复现

实际运行的是忽略目录里的动作复制夹具 <u6a-worktree>\.sciencescope-local\temp\u6a\table-diagnostic.test.mjs，不是原跟踪 test 文件。
复制来源为同一受检提交的 app/ui/desk.browser.test.js，只抽出该测试及所需 helper；未修改跟踪源码。
该次保持 click 乙单元格 → End → 输入二 → Home → Backspace 两次 → 改首段 → 保存的原动作顺序，额外注册观察事件，记录 DOM 光标、按键和单元格文本。
原夹具该变体 U6A_WAIT_SELECTION=0，不执行等待选区的对照逻辑。
结果：pass，wrapper 16571 ms，原始 TAP 的耗时见下。
事件记录：<u6a-worktree>\.sciencescope-local\temp\u6a\table-original.json。
本次 Home 后 selectionchange 到 offset 0，随后 Backspace 时乙二仍在，未捕获首次失败的事件时序。

执行时工作目录：<u6a-worktree>。
确切外层执行命令：

````powershell
& pwsh.exe -NoProfile -ExecutionPolicy Bypass -File .sciencescope-local/temp/u6a/run-table-diagnostic.ps1
````

该外层 wrapper 当时的完整内容（首个 original 分支即本次；后一个早期诊断尝试单独说明如下）：

````powershell
$ErrorActionPreference='Stop'
$taskOut='<u6a-worktree>\.sciencescope-local\temp\u6a'
$taskClean=Join-Path $taskOut 'clean-checkout'
$taskNode='<node22>'
$env:PATH=(Split-Path $taskNode)+';'+$env:PATH
$env:SCIENCESCOPE_CHROMIUM='<edge>'
$env:TEMP=Join-Path $taskOut 'diagnostic-temp'
$env:TMP=$env:TEMP
New-Item -ItemType Directory -Path $env:TEMP -Force|Out-Null
Set-Location -LiteralPath $taskClean
$taskResults=@()
foreach($taskVariant in @('original','wait-selection')) {
  $env:U6A_WAIT_SELECTION=if($taskVariant -eq 'wait-selection'){'1'}else{'0'}
  $env:U6A_DIAGNOSTIC_REPORT=Join-Path $taskOut ('table-'+$taskVariant+'.json')
  $taskClock=[Diagnostics.Stopwatch]::StartNew()
  & $taskNode --test (Join-Path $taskOut 'table-diagnostic.test.mjs') *> (Join-Path $taskOut ('table-'+$taskVariant+'.log'))
  $taskExit=$LASTEXITCODE
  $taskClock.Stop()
  $taskResults+=@{variant=$taskVariant;exitCode=$taskExit;milliseconds=$taskClock.ElapsedMilliseconds;report=[IO.Path]::GetFileName($env:U6A_DIAGNOSTIC_REPORT)}
}
$taskResults|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $taskOut 'table-diagnostic-runs.json') -Encoding utf8
$taskResults|ConvertTo-Json
````

首个 original 分支执行的实际 Node 命令为 Node 22.22.2 --test table-diagnostic.test.mjs，工作目录由 wrapper 设为上列 clean-checkout；参数和环境完整保存在上面的 wrapper 中。

该次完整标准输出/错误日志（<u6a-worktree>\.sciencescope-local\temp\u6a\table-original.log）：

````text
TAP version 13
# (node:59300) ExperimentalWarning: SQLite is an experimental feature and might change at any time
# (Use `node --trace-warnings ...` to show where the warning was created)
# (node:59300) ExperimentalWarning: SQLite is an experimental feature and might change at any time
# (Use `node --trace-warnings ...` to show where the warning was created)
# Subtest: tables keep their cells and bookmarks survive text deleted around them
ok 1 - tables keep their cells and bookmarks survive text deleted around them
  ---
  duration_ms: 14849.542
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
# duration_ms 16391.3813
````

### DOM 等待对照：仅诊断，不作为修复

此变体仍运行同一忽略目录复制夹具，U6A_WAIT_SELECTION=1。
它在 Home 后等 DOM 已触发 selectionchange 且光标 offset=0、当前单元格文本为乙二，再执行原有 Backspace 与保存步骤。
结果：pass，wrapper 17536 ms。
该对照只说明一次等待选区的执行结果，未确认首次失败原因，也未应用为产品或测试修复。
事件记录：<u6a-worktree>\.sciencescope-local\temp\u6a\table-wait-selection.json。
确切执行命令（从 U6A 根目录启动，命令内再进入 clean-checkout）：

````powershell
$taskNode='<node22>'; $taskOut='<u6a-worktree>/.sciencescope-local/temp/u6a'; $env:PATH=(Split-Path $taskNode)+';'+$env:PATH; $env:SCIENCESCOPE_CHROMIUM='<edge>'; $env:U6A_WAIT_SELECTION='1'; $env:U6A_DIAGNOSTIC_REPORT=Join-Path $taskOut 'table-wait-selection.json'; $env:TEMP=Join-Path $taskOut 'diagnostic-temp'; $env:TMP=$env:TEMP; Set-Location -LiteralPath (Join-Path $taskOut 'clean-checkout'); $taskClock=[Diagnostics.Stopwatch]::StartNew(); & $taskNode --test (Join-Path $taskOut 'table-diagnostic.test.mjs') *> (Join-Path $taskOut 'table-wait-selection.log'); $taskExit=$LASTEXITCODE; $taskClock.Stop(); @{variant='wait-dom-selection-event';exitCode=$taskExit;milliseconds=$taskClock.ElapsedMilliseconds}|ConvertTo-Json|Set-Content (Join-Path $taskOut 'table-diagnostic-wait-run.json'); exit $taskExit
````

该次完整标准输出/错误日志（<u6a-worktree>\.sciencescope-local\temp\u6a\table-wait-selection.log）：

````text
TAP version 13
# (node:49876) ExperimentalWarning: SQLite is an experimental feature and might change at any time
# (Use `node --trace-warnings ...` to show where the warning was created)
# (node:49876) ExperimentalWarning: SQLite is an experimental feature and might change at any time
# (Use `node --trace-warnings ...` to show where the warning was created)
# Subtest: tables keep their cells and bookmarks survive text deleted around them
ok 1 - tables keep their cells and bookmarks survive text deleted around them
  ---
  duration_ms: 15586.3898
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
# duration_ms 17376.4518
````

### 早期诊断自身超时，单独保留

最初等待对照试图读取未暴露的私有编辑器 view，取值始终为空，导致该诊断自身 waitForFunction 超时；随后仅将忽略夹具改为上述可观察 DOM 条件。
这次超时不属于原 fullcheck 两项失败，也没有计入其 545 项。
为保留全过程，其完整输出原样归档在 <u6a-worktree>\.sciencescope-local\temp\u6a\table-wait-pm-unavailable.log；当次 wrapper 回执保留于 table-diagnostic-runs-attempt1.json。

````text
TAP version 13
# (node:51008) ExperimentalWarning: SQLite is an experimental feature and might change at any time
# (Use `node --trace-warnings ...` to show where the warning was created)
# (node:51008) ExperimentalWarning: SQLite is an experimental feature and might change at any time
# (Use `node --trace-warnings ...` to show where the warning was created)
# Subtest: tables keep their cells and bookmarks survive text deleted around them
not ok 1 - tables keep their cells and bookmarks survive text deleted around them
  ---
  duration_ms: 43986.2405
  type: 'test'
  location: '<u6a-worktree>\\.sciencescope-local\\temp\\u6a\\table-diagnostic.test.mjs:79:1'
  failureType: 'testCodeFailure'
  error: 'page.waitForFunction: Timeout 30000ms exceeded.'
  code: 'ERR_TEST_FAILURE'
  name: 'TimeoutError'
  stack: |-
    <u6a-worktree>\.sciencescope-local\temp\u6a\table-diagnostic.test.mjs:129:20
    async withBrowserApp (<u6a-worktree>\.sciencescope-local\temp\u6a\clean-checkout\app\ui\browser-testing.js:60:5)
  ...
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 45566.2039
````


## PDF 位置验收
# U6A PDF position matrix

All inputs are synthetic, two columns and two pages. PASS for header/page number means the requested same-paragraph rejection appeared. Geometry compares marks to the actual text layer; glyph alignment also needs screenshot review.

| PDF | Position | Page 1 | Page 2 |
| --- | --- | --- | --- |
| journal-zh.pdf | body | PASS | PASS |
| journal-zh.pdf | right-column | PASS | PASS |
| journal-zh.pdf | cross-line | PASS | PASS |
| journal-zh.pdf | header | PASS | PASS |
| journal-zh.pdf | page-number | PASS | PASS |
| paper-en-columns.pdf | body | PASS | PASS |
| paper-en-columns.pdf | right-column | PASS | PASS |
| paper-en-columns.pdf | cross-line | PASS | PASS |
| paper-en-columns.pdf | header | PASS | PASS |
| paper-en-columns.pdf | page-number | PASS | PASS |
| word-export-zh.pdf | body | FAIL — no correct annotation | FAIL — wrong anchor/mark |
| word-export-zh.pdf | right-column | FAIL — no correct annotation | FAIL — no correct annotation |
| word-export-zh.pdf | cross-line | PASS | PASS |
| word-export-zh.pdf | header | PASS | PASS |
| word-export-zh.pdf | page-number | PASS | PASS |

All three PDF source hashes stayed unchanged. Saved annotation IDs survived tab close/reopen: journal-zh 6, paper-en-columns 6, word-export-zh 3 (including the observed wrong anchor).

Word-export failures: both body sentences/right-column sentences cross parsed block boundaries. Page 2 body produced a card quoted as `1` on page 1 in the initial sequence; selection timing may have affected this observation. The single focused physical-mouse attempt recorded an empty selection and correct select-first prompt, so stable wrong anchoring remains for Claude to review. See pdf-evidence-word-export-zh.pdf.json: raw text layers, session blocks, and read-only durable annotations.
## 界面问题复现


1. Open either Markdown fixture in rendered view. Bold the first two Chinese characters, append the prepared sentence, press Enter after the second ordinary list item and type the third item, tick the first task, edit the inline formula, switch source/rendered, undo the temporary suffix, then Ctrl+S. The CRLF+BOM file preserves the BOM but inserts bare LF/extra blank lines inside the ordinary list. The LF file also gains extra blank lines. Ticking the first task writes `- [x] [ ] 核对合成样本数`; the old task marker remains in the content. Both actual/expected byte streams and SHA-256 values are in the comparison JSON/HTML. Unchanged comment, punctuation-adjacent bold, table, display formula and tail paragraph remain inspectable there.
2. In word-export-zh.pdf, page 1 body sentence `左栏正文第1页：本研究的合成一致性阈值为0.75，案例频数阈值为2。` spans session blocks b:0 (`…阈值为`) and b:1 (`0.75，案例频数阈值为2。`), so adding a comment to the whole visible sentence is rejected. Right-column sentences on both pages also fail to open the index picker. File/page/phrase, page text-layer raw text, session blocks and durable annotation audit are in pdf-evidence-word-export-zh.pdf.json. These mapping/UI failures were recorded without changing app/ui.
3. The initial page 2 body sequence left a card quoted as `1` on page 1 and failed rectangle comparison. **This observation may be affected by selection timing and remains for Claude to review.** In the single subsequent physical-mouse focused attempt, the recorded selection was empty with anchor/focus on page 1; the UI correctly requested selecting text first. That attempt did not establish a stable wrong-anchor reproduction. See focused-word-review.json and screenshots/u6a-word-p2-focused-mouse.png.

The two LaTeX-generated PDFs pass body, right-column, cross-line, running-header and footer-number cases on both pages. The Word-export PDF passes cross-line, header and footer-number cases on both pages. The 26/30 matrix retains the page 2 body failure with the timing qualification above. All successful mark cases record normal and zoomed rectangles/screenshots; actual canvas glyph alignment is checked visually by root/reviewer.


## Word 导出 PDF 的文字层与会话块

全部为本次自造文本；以下保留原 textContent 和块文字，便于核对跨块划选。

```json
{
  "file": "papers/word-export-zh.pdf",
  "layers": [
    {
      "page": 1,
      "textLayer": "合成 Word 中文论文 编辑台验收专用1合成 Word 论文：第 1 页左栏正文第 1 页：本研究的合成一致性阈值为0.75，案例频数阈值为 2。跨行句第 1 页：合成城市样本采用统一指标，这一句在下一行继续核对阈值解释。本文件由独立 Word 实例导出，作者和数据均为合成。右栏正文第 1 页：较低阈值纳入更多合成案例，应当区分阈值口径。右栏跨行句：先保持指标定义相同，再检查跨行文字的批注标记。本段只为验收 PDF 选择定位，不陈述真实研究发现。"
    },
    {
      "page": 2,
      "textLayer": "合成 Word 中文论文 编辑台验收专用2合成 Word 论文：第 2 页左栏正文第 2 页：本研究的合成一致性阈值为0.75，案例频数阈值为 2。跨行句第 2 页：合成城市样本采用统一指标，这一句在下一行继续核对阈值解释。本文件由独立 Word 实例导出，作者和数据均为合成。右栏正文第 2 页：较低阈值纳入更多合成案例，应当区分阈值口径。右栏跨行句：先保持指标定义相同，再检查跨行文字的批注标记。本段只为验收 PDF 选择定位，不陈述真实研究发现。"
    }
  ],
  "blocks": [
    {
      "id": "b:0",
      "kind": "paragraph",
      "level": null,
      "text": "左栏正文第 1 页：本研究的合成一致性阈值为",
      "page": 1
    },
    {
      "id": "b:1",
      "kind": "paragraph",
      "level": null,
      "text": "0.75 ，案例频数阈值为 2 。",
      "page": 1
    },
    {
      "id": "b:2",
      "kind": "paragraph",
      "level": null,
      "text": "跨行句第 1 页：合成城市样本采用统一指标， 这一句在下一行继续核对阈值解释。",
      "page": 1
    },
    {
      "id": "b:3",
      "kind": "paragraph",
      "level": null,
      "text": "本文件由独立 Word 实例导出，作者和数据均为合成。",
      "page": 1
    },
    {
      "id": "b:4",
      "kind": "paragraph",
      "level": null,
      "text": "应当区分阈值口径。",
      "page": 1
    },
    {
      "id": "b:5",
      "kind": "paragraph",
      "level": null,
      "text": "右栏跨行句：先保持指标定义相同， 再检查跨行文字的批注标记。",
      "page": 1
    },
    {
      "id": "b:6",
      "kind": "paragraph",
      "level": null,
      "text": "本段只为验收 PDF 选择定位，不陈述真实研究发现。",
      "page": 1
    },
    {
      "id": "b:7",
      "kind": "paragraph",
      "level": null,
      "text": "左栏正文第 2 页：本研究的合成一致性阈值为",
      "page": 2
    },
    {
      "id": "b:8",
      "kind": "paragraph",
      "level": null,
      "text": "0.75 ，案例频数阈值为 2 。",
      "page": 2
    },
    {
      "id": "b:9",
      "kind": "paragraph",
      "level": null,
      "text": "跨行句第 2 页：合成城市样本采用统一指标， 这一句在下一行继续核对阈值解释。",
      "page": 2
    },
    {
      "id": "b:10",
      "kind": "paragraph",
      "level": null,
      "text": "本文件由独立 Word 实例导出，作者和数据均为合成。",
      "page": 2
    },
    {
      "id": "b:11",
      "kind": "paragraph",
      "level": null,
      "text": "应当区分阈值口径。",
      "page": 2
    },
    {
      "id": "b:12",
      "kind": "paragraph",
      "level": null,
      "text": "右栏跨行句：先保持指标定义相同， 再检查跨行文字的批注标记。",
      "page": 2
    },
    {
      "id": "b:13",
      "kind": "paragraph",
      "level": null,
      "text": "本段只为验收 PDF 选择定位，不陈述真实研究发现。",
      "page": 2
    }
  ]
}
```
