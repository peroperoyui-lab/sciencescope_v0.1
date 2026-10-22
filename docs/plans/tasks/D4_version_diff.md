# D4 版本比较：段落配对、段内改字和格式改动

- 起草：Claude，2026-10-22。依据：`architecture/EDITING_DESK.md` §2 场景 3、§3.2 块模型、§3.3「D4 要补的」、§4.4、§12 第 10 条（所有者 2026-10-22：左右两页并排，旧版删掉的标红，新版新加和改格式的标淡黄，差异在生成版本时算好）；E0b 的 `app/services/desk/compare.js`（`alignVersions`、`dice`）；D3a/D3b 的块读取（`docx/read.js`、`text.js` 的 `splitText`）。
- 执行：Sol（Windows）；审阅：Claude。约 2 小时，一步交付；超出就停下汇报。

## 目标

1. 新函数 `diffVersions(old, new)`：两版文稿各自的块列表 → 配对、段内删改字、格式改动、整段增删的位置和计数。界面（U3，Claude 做）直接按它在左右两页上标红、标淡黄。
2. 生成版本时在后台和父版本比一次存起来；任意两版现算并缓存。
3. 新接口把两版的块和比较结果一起给界面。

## 用户会怎么用

- 用户关闭编辑台，生成 v8（父版本 v7）。几秒内后台算好 v7→v8 的差异，不拖慢关闭。
- 用户在版本树里右键 v5 →「和 v8 比较」：v5、v8 不是父子，第一次现算，之后再打开直接读缓存。
- 左页 v5：被删的词标红，整段删掉的段落也标红；右页 v8：新加的词和整段新加的段落标淡黄，加粗了的词标淡黄，原来那段被删的位置画一根红色细竖线。顶部计数「删 12 · 增 9 · 格式 3」。
- 把一段拆成两段、把两段合成一段，显示成改了一段加新增一段，而不是整段删了再整段加。

## 要做的

1. **块列表**（`app/services/desk/` 里新文件，比如 `diff.js`；`compare.js` 的 `alignVersions` 留着给现有调用）：
   - docx：用 `readDocx` 的块，按 `publicBlock` 的形状（`id,kind,style,level,inlines,text`）。
   - tex、md：用 `splitText` 的块（`id,kind,level,text`，没有 `inlines`）。
   - pdf：用现有的提取文字（`versions.read` 的块），包成 `{id:'b:<序号>',kind:'paragraph',text}`。
   - 其他格式或解析失败：不比较，状态 `originals-only`。
2. **配对**（§4.4 第 1 条）：
   - 配对用归一化文字：NFKC、连续空白合成一个、去掉首尾空白；原子用「类型 + 原 XML 的哈希」占位，不用 `display`（两个不同公式的线性文字可能相同）。归一化只用来配对，结果里的位置都按原 `text`。
   - `diffArrays` 先配完全相同的块；同一空档里剩下的块按字符二元组 Dice（复用 `compare.js` 的 `bigrams`、`dice`）保序配对，阈值 0.4。
   - 空档里旧块数 × 新块数超过 250 000 时不做 Dice，整空档当作删和增，结果里记 `limited: true`（§3.3 的内存限制）。
   - 拆段：旧块 A 拆成新块 A1、A2 时，A 配给相似度最高的一个（照上面的规则自然得到），另一个算新增。不做移动段落检测。
3. **段内比较**（§4.4 第 2 条）：配对的块用 `versions/comparison.js` 的 `compareText`（中文按词）比原 `text`，删掉的字记在旧块、新加的字记在新块。
   - 格式：只看两边都没变的字。docx 每个字的标记集合（`b/i/u/sup/sub`）不同的连续一段记一处 `format`，带前后标记；块的 `kind`、`style`、`level` 不同记一处块级 `format`（`from:0,to:text.length`，带前后样式）。tex、md、pdf 没有字符格式，只比 `kind/level`。
4. **输出**（存库和接口里的同一个对象，不含块本身）：

   ```js
   { algorithm: 1, status: 'ready' | 'unchanged',
     pairs: [{ old: 3, new: 3 }, { old: 4, new: null }, { old: null, new: 4 }],  // 块序号，按文稿顺序
     deleted:  [{ block: 4, from: 0, to: 18 }],            // 旧版块序号，UTF-16 偏移，按原 text
     inserted: [{ block: 5, from: 6, to: 9 }],             // 新版块序号
     format:   [{ block: 2, from: 0, to: 4, before: [], after: ['b'] },
                { block: 0, from: 0, to: 12, before: { kind: 'paragraph', style: '' }, after: { kind: 'heading', style: 'Heading1', level: 1 } }],
     removedAt: [{ old: 4, after: 3 }],                    // 整段删掉的旧块在新版里跟在哪块后面；开头为 -1
     counts: { deleted: 2, inserted: 2, format: 2 },
     limited: false }
   ```

   - 块用在这一版块列表里的序号（版本文件不变，序号就稳定），不用块 id（`b:<n>` 只在会话内稳定）。
   - 计数：每段连续删除的字算 1 处，整段删除算 1 处；增和格式同理。
   - 整段删除的旧块，整个 `text` 都进 `deleted`；整段新增的新块整个进 `inserted`。
   - 两版正文和格式都一样时 `status:'unchanged'`，各数组为空。

5. **存储**（新迁移 028，取目录里实际最高号加一）：表 `version_diffs`（`baseline_id`、`version_id`、`algorithm`、`diff_json`、`created_at`，主键 `(baseline_id, version_id)`，两列都引用 `manuscript_versions(id)`）。这张表同时放「和父版本的差异」和「任意两版的缓存」，不另给 `manuscript_versions` 加 `diff_json` 列（`EDITING_DESK.md` §4.4 第 4 条照此改写）。`algorithm` 比当前代码的号小时视为没有缓存，重算覆盖。
6. **什么时候算**：
   - 有父版本的新版本生成后（关闭会话、存为版本、导入外部修改、另存为新版本、带基线的导入），在后台和父版本比一次，写进 `version_diffs`。不阻塞生成版本的返回；同一时间只算一份（排队）；失败只记日志，下次打开比较时现算。
   - 应用退出时没算完的不用补，下次请求时现算。
7. **接口** `GET /api/versions/:id/diff?baseline=`：
   - `baseline` 省略时用父版本；没有父版本返回 `{ status: 'first' }`。两版不在同一版本组返回 `INVALID_BASELINE`（同现有比较接口）；跨分支可以比。
   - 返回 `{ baseline:{id,number,branch}, version:{id,number,branch}, format, old:{blocks}, new:{blocks}, diff }`，`blocks` 是第 1 条的块列表（docx 带 `inlines`），`diff` 是第 4 条的对象。`originals-only` 时 `old/new` 为 `null`、`diff` 为 `{ status:'originals-only' }`。
   - 有缓存直接用；没有就现算、存起来再返回。
   - 现有 `GET /api/versions/:id/compare` 和版本说明里的 `changeSummary` 都不改，U3 换界面时 Claude 再处理旧接口。
8. **测试**（合成文件用代码生成）：
   - docx：改一个中文词（只有那个词进 `deleted`、`inserted`）、插段、删段（`removedAt` 位置对）、拆段、合段、给一个词加粗（只记 `format` 不记删增）、段落从正文改成一级标题（块级 `format`）、两个不同公式线性文字相同时不配成相同块。
   - tex、md：改一段一个词；md 标题级别变了记块级 `format`。
   - pdf：两份提取文字不同的 pdf 能比出删增。
   - 存储：关闭会话生成版本后 `version_diffs` 有一条（测试里等后台任务完成）；任意两版第二次请求读缓存（可数调用次数）；`algorithm` 号变大后重算；`baseline` 不同组返回 `INVALID_BASELINE`；首版返回 `first`。
   - 大空档：旧块 × 新块超过上限时 `limited: true` 且不报错（上限在测试里做成可注入）。

## 可以改的

`app/services/desk/`（可加文件）、`app/services/versions/`（只加生成后的后台比较和 `diff` 接口所需）、迁移目录（新迁移 028 及其测试）、`app/server/routes/versions.js`，及各自测试；`docs/architecture/EDITING_DESK.md`（§4.4、§8 按实际行为改）、`docs/product/FEATURES.md`、`docs/log/IMPLEMENTATION_LOG.md`（不超过 5 行）。

## 不做的

- 不改 `app/ui/`（比较视图是 U3），不改现有 `/compare` 接口和版本说明。
- 不做逐句对齐的行视图、移动段落检测、表格结构比较。
- 不新增依赖（`diff` 已有）。
- 不动 `<预览安装目录>` 及其数据，不把稿件、截图提交进仓库。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）。
- 第 8 条的测试都在。
- 真实稿件：用 D2b 的中文学位论文，在它的副本上用编辑台接口改三处（改一个词、删一段、给一个词加粗）后关闭生成新版本，报告 `counts` 和人工核对结论（标出的位置对不对）；再找同一论文两个真实修订稿（E0b-2 用过的那对）各登记成同组两个版本比一次，报告配对误标的大致比例。两项都报耗时和 `diff_json` 大小。超过 3 秒就先停下汇报。稿件只放 `.sciencescope-local/temp/desk-d4/`。

## 交付

- 分支：`codex/d4-version-diff-YYYYMMDD`，从 `main` 最新提交开始。报告不超过 15 行，给出远程分支与 SHA、两份真实稿件的结论和耗时。不建 PR、不合并。
