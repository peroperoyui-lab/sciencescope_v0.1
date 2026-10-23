# D7 TeX 引擎检测与编译

- 起草：Claude，2026-10-23。依据：`architecture/EDITING_DESK.md` §2 场景 7，§3 目录（`data/temp/desk-build/<会话 id>/`），§8 接口表（`GET /api/desk/tex/engines`、`POST …/compile`、`GET …/pdf`），§9「Tectonic」一段，§12 第 4、5 条（alpha 只用用户已装的 TeX Live 或 MiKTeX；每个 `.tex` 单独成版本组，编译用整个项目文件夹）；D3b 的 tex 会话。
- 执行：Sol（Windows）；审阅：Claude。约 2.5 小时，一步交付；超出就停下汇报。

## 目标

1. 找到用户已装的 TeX（TeX Live 或 MiKTeX），告诉界面有哪些、用哪个。
2. 在编辑台对一份 tex 文稿点「编译 PDF」：用整个项目文件夹编译，输出不进项目文件夹，返回 PDF 和看得懂的错误。
3. 没装 TeX、缺宏包、写错命令、编译卡住，都有明确结果，不挂起、不弹窗。

## 用户会怎么用

- 用户装了 MiKTeX。打开 `main.tex` 点「编译 PDF」：右栏换成 PDF，底部写"xelatex · 8.2 秒"。
- 打开 `chapters/method.tex`（没有 `\documentclass`，被 `main.tex` 用 `\include` 引入）点编译：自动编译 `main.tex`，提示"编译的是 main.tex"。
- 写错一个命令：编译结果列出"method.tex 第 42 行：Undefined control sequence"，点一下跳到那行（跳转是 U6 的事）。
- 改了还没写回项目文件就点编译：提示"有 1 份文稿的修改还没写回，编译用的是项目文件夹里的版本"，界面可以先写回再编译。
- 没装 TeX：按钮停用，i 提示怎么装（文字由 Claude 写，接口只返回空列表）。

## 要做的

1. **检测**：`GET /api/desk/tex/engines[?refresh=1]` → `{ engines:[{ id:'xelatex'|'lualatex'|'pdflatex', path, distribution:'miktex'|'texlive'|'other', version }], latexmk: path|null, biber: path|null, bibtex: path|null }`。
   - 找 PATH，加常见安装位置：MiKTeX 的用户和全局安装目录（`%LOCALAPPDATA%\Programs\MiKTeX\miktex\bin\x64`、`%ProgramFiles%\MiKTeX\miktex\bin\x64`），TeX Live 的 `C:\texlive\<年份>\bin\windows`（旧版本是 `win32`/`win64`）、`/usr/local/texlive/<年份>/bin/<平台>`、`/Library/TeX/texbin`。多个年份取最新。
   - 版本用 `<程序> --version` 第一行，单个超时 5 秒。结果缓存到进程结束，`refresh=1` 重新找。
   - 设置 `desk.tex.engine`：`'auto'`（默认）或三个引擎之一。要有读它的地方（下面第 2 条），不只是存。
2. **选主文件和引擎**：
   - 主文件：文稿首部的 `% !TEX root = <相对路径>` 优先；文稿自己有 `\documentclass` 就编译它；否则在项目文件夹里找有 `\documentclass` 且用 `\input`、`\include`、`\subfile` 引入这份文稿的 `.tex`（只看直接引入），唯一就用它，没有或多个返回 `DESK_TEX_ROOT`（带候选列表）。请求可带 `{ root }` 指定。
   - 引擎：设置不是 `auto` 就用设置的；否则 `% !TEX program = xxx` 优先，再看主文件：用了 `ctex`、`xeCJK`、`fontspec` 用 xelatex，`luacode`、`luatexja` 用 lualatex，其余 pdflatex；选中的没装就按 xelatex → lualatex → pdflatex 退。
   - 有 latexmk 就用它（`-pdfxe`/`-pdflua`/`-pdf`，处理参考文献和多次运行）；没有就引擎跑一遍，`.aux` 里有 `\citation` 或用了 biblatex 时跑 bibtex 或 biber，再跑两遍引擎。
3. **编译**：`POST /api/desk/sessions/:id/compile { root? }` → `{ status:'ok'|'failed'|'timeout', root, engine, durationMs, pdf: boolean, errors:[{ file, line, message }], warnings: n, unsaved:[path], logTail }`。
   - 只接受 tex 会话；没有引擎返回 `DESK_TEX_MISSING`。
   - 工作目录是项目文件夹，输出和中间文件放 `data/temp/desk-build/<会话 id>/`（`-output-directory` 或 latexmk 的 `-outdir`），项目文件夹里不留任何新文件（`.aux`、`.log`、`.synctex.gz` 都不留）。
   - 编译用项目文件夹里的文件，不用会话里没写回的文字；这个项目里有未写回修改的会话，在 `unsaved` 列出路径（界面决定要不要先写回）。
   - 安全和不挂起：`-interaction=nonstopmode -file-line-error`，关闭 shell escape（`-no-shell-escape`）；总时限 120 秒，超时杀掉整个进程树（Windows 上 latexmk 会再起子进程），返回 `timeout`；MiKTeX 缺宏包时不能弹安装窗口挡住编译（查 MiKTeX 的自动安装设置和命令行参数，报告实际行为；做不到不弹窗就在报告里写明）。
   - 错误：从 `.log` 解析 `文件:行: 消息` 和 `! ` 开头的错误，路径相对项目文件夹；`logTail` 为日志最后 40 行。
   - 同一会话编译中再请求返回 `DESK_TEX_BUSY`。发 `desk.compiled { sessionId, status }`。
4. **读 PDF**：`GET /api/desk/sessions/:id/pdf` 返回最近一次成功的 PDF（`application/pdf`，`cache-control: no-store`），没有返回 404。会话关闭时删掉这个会话的构建目录；应用启动时清理没有对应打开会话的旧构建目录。
5. **测试**（不依赖本机装 TeX）：用测试里生成的假程序（放在临时 PATH 里的脚本，按参数写出 PDF 和日志）覆盖：检测 PATH 和安装目录、取最新年份、版本解析；主文件选择四种情况和 `DESK_TEX_ROOT`；引擎选择（魔法注释、ctex、设置覆盖、没装时退）；latexmk 和不用 latexmk 两条路；参考文献多跑；超时杀进程；错误解析（用几份真实日志片段做样例，放测试里）；`unsaved`；`DESK_TEX_BUSY`；项目文件夹不多出文件；PDF 接口；关闭会话删除构建目录。

## 可以改的

`app/services/desk/`（可加文件，比如 `tex-build.js`）、`app/server/routes/desk.js`、`app/core/workspace/resources/settings.js` 的默认值和校验（只加 `desk.tex.engine`）、`app/ui/api.js` 的 `EVENT_TYPES`（只加 `desk.compiled`）、各自测试；`docs/architecture/EDITING_DESK.md`（§3、§8、§9 按实际行为改）、`docs/product/FEATURES.md`、`docs/log/IMPLEMENTATION_LOG.md`（不超过 5 行）。

## 不做的

- 不做 Tectonic 下载（D9，alpha 之后）、SyncTeX、编译按钮和 PDF 预览界面（U6）。
- 除 `EVENT_TYPES` 一项外不改 `app/ui/`。
- 不新增依赖。
- 不动 `<预览安装目录>` 及其数据，不把稿件、截图、日志提交进仓库。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）。
- 第 5 条的测试都在。
- 真实验收（Windows，MiKTeX；有 TeX Live 也测一遍）：① 中文 xeCJK（或 ctex）单文件样例编译成功，PDF 里中文正常；② 多文件样例（`main.tex` 加 `\include` 两章和 `.bib`，用 biblatex 或 natbib 各一份皆可）从章节文件点编译，自动找到主文件，参考文献有编号；③ 故意写错一个命令，错误指到正确文件和行；④ 用一个没装过的宏包，记下 MiKTeX 的实际表现和耗时；⑤ 编译后项目文件夹没有多出文件。样例用代码生成，放 `.sciencescope-local/temp/desk-d7/`。报告写各项耗时。

## 交付

- 分支：`codex/d7-tex-compile-YYYYMMDD`，从 `main` 最新提交开始。报告不超过 15 行，给出远程分支与 SHA、真实验收结论。不建 PR、不合并。
