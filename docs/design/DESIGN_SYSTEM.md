# ScienceScope 设计系统

- 起草：Claude，2026-10-16。首版画廊已发布，等用户审（§4）。
- 画廊：<https://claude.ai/artifact/6MCyAAbMK2kD5nTsAkZEgk>（私有；用户可以在页面的 Share 菜单里共享）。
- 源文件：`docs/design/system/`（§5）。
- 界面工作以本文和画廊为准（AGENTS.md 原则 6）。品牌规则全文在 `system/project/README.md`，也就是画廊首页的品牌手册；每个组件的结构和规则在 `system/project/components/<名称>/README.md`。本文只写总览、对应的反馈和维护方法。

## 1. 内容

| 部分 | 内容 |
|---|---|
| 令牌 | 85 个（`tokens.json`）：颜色 39 个，分浅色和深色两套；间距 10 个、圆角 6 个、阴影 3 个、尺寸 20 个、层级 6 个、透明度 1 个；字号 12 级 |
| 图标 | Lucide 1.49.0（ISC），107 个，分六组，每个图标都写了中文含义；替换旧原型的 38 个手绘图标 |
| 组件 | 37 个，分十组：基础（图标、标志）、操作、输入、导航、浮层、反馈、数据、布局、对话、设置 |
| 整页示例 | 对话、资料库、收件箱、设置，按 1536×900 绘制（1920 宽屏幕 125% 缩放） |
| 标志 | 原件位图 `reference/ScienceScope_Logo.png`，以及从原件描出来的单色矢量 `system/logo/sciencescope-mark.svg` |

主要变化：

- 整体更紧凑：界面字 13/20，正文 14/22，控件默认高 28px，列表行 36px。
- 浅色主题的 `muted` 从 #6f766e 加深到 #666c65，原值在侧栏上只有 4.2:1。
- 主按钮沿用原有做法：浅色主题用墨色，深色主题用品牌绿。

## 2. 和首测反馈的对应

编号见 `REVIEW_2026-10-16.md` §3。

| 反馈 | 画廊里的做法 | 组件或页面 |
|---|---|---|
| 1、17 发送和中断是两个按钮，中断无效 | 发送和停止合成一个按钮，停止后写明已保留的内容 | SendButton、StatusLine |
| 大3 没有「已发送、思考中」等状态 | 消息下方一行状态：已发送、思考、执行、等批准、重试、失败、停止 | StatusLine |
| 2 OpenCode Go 不适配；上下键调长度；思考强度在设置页 | 服务商预设一步添加；上限自动获取；思考强度在输入栏选 | ProviderCard、ModelPicker、PageSettings |
| 大7、大8、15 工具调用和前导语看不见，各助手显示不一 | 专家、秘书、助手共用一套消息和行动时间线 | Message、ActivityTimeline |
| 16 没有请求批准；自动化的颜色 | 执行方式三档，自动化用暗红；批准卡片 | ModeMenu、ApprovalCard、Composer |
| 大1、大2、5 没有规范，字号、图标、对齐不统一 | 令牌、一套图标、基础组件 | 基础、操作、输入 |
| 10、13、大5、大6 弹窗位置乱；侧栏不能拖宽；浏览器右键菜单；按钮堆积 | 锚定弹层、可拖动分栏、自定义右键菜单、悬停两个图标加 ⋯ | Menu、Popover、Splitter、List |
| 3、8、14 运行中能归档；新对话归属；独立对话不能移入项目 | 运行中不能归档；新对话建在当前项目；对话可以拖进项目 | Sidebar、PageChat |
| 4、6、7 名称溢出；设置信息重叠；没有关于页 | 设置改成分区的大窗口；长名称截断；关于页 | PageSettings、SettingRow |
| 11、18、19 资料库筛选和详情；docx 警告堆积；收件箱按钮乱 | 漏斗筛选、单击预览、提示收成一条；收件箱批量处理和右侧依据 | FilterBar、Callout、PageLibrary、PageInbox |
| 用户 10-16：文字和行距再紧一点 | 见上面的字号和高度；每页按 1536×900 检查 | 品牌手册「间距、尺寸和密度」 |

还没有覆盖的：12（工作站）和大4（导图）在 P3 逐页重做时设计；9（启动慢）在 P4。

## 3. 应用里怎么用

- 组件是 HTML 结构加 `ss-` 类名。P3 把 `bundle.css` 移进 `app/ui/styles/`，令牌生成 CSS 变量；Preact 组件输出同样的结构，交互照 `build/bundle.src.js` 实现。
- 应用里不加载画廊的 `bundle.js`。
- `styles/legacy/` 在 P3 逐页删除。

## 4. 等用户确认

- 浅色 `muted` 加深一档。
- 图标整体换成 Lucide。
- 标志矢量版是描出来的，需要对照原件看有没有走样。
- 自动化的暗红（`auto`）和错误红（`danger`）色相接近，靠闪电图标和文字区分。
- 设置改成居中的大窗口，按 Esc 关闭。

## 5. 源文件与维护

| 路径 | 内容 |
|---|---|
| `system/project/` | 画廊发布的全部内容：`design-system.json`（索引）、`README.md`、`tokens.json`、`components/`、`assets/Logos/README.md`。`components/bundle.js` 由脚本生成，不进仓库 |
| `system/build/` | `bundle.src.js`（画廊交互脚本）、`icons_meta.py`（图标含义表）、`icons.json`（图标数据）、`build.py` 和检查工具 |
| `system/logo/` | 界面用的标志矢量，颜色跟随文字 |

常用命令（在仓库根目录运行）：

- 生成：`python3 -I docs/design/system/build/build.py`。它写出 `bundle.js`，以及 `.sciencescope-local/temp/design-system/` 下的预览辅助文件。
- 截图：`node docs/design/system/build/shot.cjs <组件|all> [light|dark|both] [倍数]`，输出到 `.sciencescope-local/temp/design-system/shots/`。
- 量高度：`node docs/design/system/build/measure.cjs <组件|all>`，对照卡片标记里的高度。
- 对比度：`python3 -I docs/design/system/build/contrast.py`。目前有 10 项低于目标，都是品牌手册「可读性」写明的例外：`faint`、`line-strong`、深色主题的 `auto`，以及 `press` 上的 `muted`。
- 整页示例：收件箱和设置由 `build/parts/` 拼成，用法见 `assemble.py` 第一行；对话和资料库直接改 `preview.html`。
- 加图标：
  1. 在 `icons_meta.py` 里加含义；
  2. 把 lucide-static 1.49.0 解压到 `.sciencescope-local/temp/lucide/`（用户机器上从 npmmirror 下载）；
  3. 运行 `gen_icons.py`，再运行 `build.py`。

发布：

- 先运行 `build.py`，再改 `design-system.json` 的 `lastChange`。
- 用 Artifact 发布到画廊地址：
  - `root` 是 `docs/design/system`；
  - `file_path` 是 `project/design-system.json`；
  - `files` 只列改过的 `project/` 路径。
- 标志的两个文件是画廊里上传的资源，索引里记了它们的编号；换文件要重新上传，并更新这两个记录。
