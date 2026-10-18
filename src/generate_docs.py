from pathlib import Path
import json,shutil,re,base64
R=Path(__file__).resolve().parents[1]
specs=json.loads((R/'docs/archive/legacy/page-manifest.json').read_text())
updates={
'home':dict(title='开始与继续',actions=['最近工作按真实项目和对话身份打开。','常用站点通过浏览器侧栏打开，菜单管理站点。','输入框支持附件和模型/运行方式菜单。','顶部按钮使用下拉菜单；全局助手打开独立窗口。']),
'work':dict(title='主工作聊天',actions=['用户消息右对齐，显示日期、时间和消息操作。','复制消息、引用到输入框、从选中消息前缀开始分支。','Ctrl F 查找当前对话；Ctrl K 搜索项目、对话和操作。','输入框圆环悬停显示模型上下文和缓存，引用及批注另设入口。','项目摘要在右上角浮出；浏览器/秘书侧栏仍可独立操作。']),
'overview':dict(title='项目置顶摘要',regions=['主聊天右上角锚定浮层，柔和底色、轻阴影。','项目名称、修改列表、最近日志、来源、秘书与工作站入口。'],actions=['点击摘要按钮展开；关闭键、Esc 或外部点击收起。','浏览器打开时摘要按钮仍在，摘要可以叠在侧栏上。','点击文件查看预览；查看全部修改进入 P49。'],checks=['没有全屏遮罩或主工作区锁定。','不与左侧手动置顶混淆。']),
'workbench':dict(title='工作站',actions=['顶部全局计划支持创建、编辑、完成和删除撤销。','项目日志整卡打开，切项目只显示该项目日志。','计划与日志可选择/拖入文件。','下部保持文献版本、导图预览、项目文件夹三个区域。','导图独立编辑窗口与原工作站同步。']),
'plan':dict(title='全局计划',regions=['简单计划卡列表。','非模态编辑器包含标题、可选项目、备注和文件。'],actions=['新建、编辑、切换完成状态、删除并撤销。','选择文件或拖入附件区，可移除附件。','编辑器打开时继续使用主工作区，表单目标保持不变。'],checks=['空标题有反馈。','切项目不丢全局计划。','附件属于相应计划。']),
'journal':dict(title='项目日志详情',actions=['日志整卡打开对应节点。','简述、文件列表和日志详情切换。','编辑/删除/撤销；添加关联文件。','打开相关对话；定位到稳定消息位置并短暂高亮。'],checks=['日志属于指定项目，切项目隔离。','失效消息引用不跳到其他消息。']),
'browser':dict(title='内置浏览器',regions=['主聊天旁边可调整宽度的侧栏。','关闭、分离、标签、地址栏与前进后退。'],actions=['侧栏关闭保留主聊天与草稿。','地址输入、前进、后退和刷新。','引用页面进入主输入附件；系统浏览器打开由用户点击。','分离为独立窗口，不锁主窗口。'],checks=['项目摘要按钮不消失。','离线正文不冒充真实网页加载。']),
'quick':dict(title='独立快速聊天',actions=['打开独立浏览窗口。','输入与附件在快速聊天内保留。','关闭辅助窗口不锁定主应用。']),
'assistant':dict(title='全局助手',regions=['独立于主窗口的浮窗。','球状入口/对话面板两种状态。'],actions=['球与面板切换保留临时内容。','项目、工作站、数据库动作激活主窗口定位。','浏览器原型演示真实辅助窗口；原生 always-on-top/贴边由桌面接入。'],checks=['主窗口无模态遮罩。','用户可同时操作主界面。']),
'projects':dict(title='全部对话',regions=['对话表、名称/消息搜索。','全部、置顶、未读、已归档筛选。'],entry='左侧底部固定“浏览全部”；Ctrl Shift K；顶部菜单/命令入口。',actions=['对话条目进入对应项目与线程。','省略号与右键共用菜单。','搜索已加载消息或标题。','新建项目/聊天、归档、已读/未读、重命名和手动置顶。']),
'context':dict(title='引用与批注',goal='检查附带到本次发送的材料与临时批注，独立于模型 Token 状态。',entry='输入框加号菜单、批注标签。',regions=['已选择上下文来源。','临时标记及附加说明。']),
'shortcuts':dict(actions=['显示本原型实际快捷键。','菜单条目右侧显示对应快捷键。','正式桌面版支持平台映射与自定义；中文输入法组合期不会提交或新建节点。']),
'map':dict(actions=['从工作站左上角打开独立编辑窗口。','Enter 同级、Shift Enter 换行、Tab 子分支。','Markdown/图片选择、粘贴、拖入、右键插入。','移动/删除节点，撤销重做，设置缩略图大小。','保存预览同步到对应项目，支持 JSON/Markdown 导出。']),
'branch':dict(checks=['从选中历史前缀建立独立消息状态。','分支后新增内容不污染原聊天。','正式运行时历史和文件输出由 DSH 对应能力接入。'])
}
for sp in specs:
 if sp['route'] in updates:sp.update(updates[sp['route']])
sp49={'id':'P49','route':'changes','title':'项目修改记录','group':'研究记录','source':'本轮用户反馈','goal':'查看细粒度项目文件变化，与关键节点日志分开。','entry':'项目摘要中的查看全部修改；命令入口。','regions':['按实际操作显示的变化列表。'],'actions':['查看创建、修改、删除、重命名和实际来源。','文件/版本与预览联动。'],'states':['有修改','无修改'],'checks':['项目归属正确。','修改记录不是全文审阅通过声明。']}
if not any(x['route']=='changes' for x in specs):specs.append(sp49)
(R/'docs/archive/legacy/page-manifest.json').write_text(json.dumps(specs,ensure_ascii=False,indent=2))
for s in specs:
 text=f"# {s['id']} {s['title']}\n\n版本 v0.3；路由 `#{s['route']}`。\n\n## 目的与入口\n\n{s['goal']}\n\n入口：{s['entry']}\n\n依据：{s['source']}。本轮菜单/窗口定义见 `../02_INTERACTION_CONTRACTS.md`，与早期原型描述不同处以本轮为准。\n"
 for key,title in [('regions','页面组成'),('actions','用户操作与结果'),('states','状态'),('checks','验收')]:
  text+='\n## '+title+'\n\n'+'\n'.join('- '+v for v in s.get(key,[]))+'\n'
 text+='\n## 开发接入\n\n首先检查完整 DSH 已有的对应组件和服务。原型的入口和结果作为功能依据，数据保存、模型调用及操作系统能力接入真实应用。未配置/不可用时用具体状态反馈，保持其他功能可用。\n'
 (R/'docs/archive/legacy/pages'/f"{s['id']}_{s['route']}.md").write_text(text)
# User-provided files, preserving original design/logo.
shutil.copy('/mnt/data/d286c339-023f-47d4-a806-f15adf372eb4.pptx',R/'reference/ScienceScope_User_Design.pptx')
shutil.copy('/mnt/data/67a08cba-b0b0-451e-a508-8fa1977ab38a.png',R/'reference/Codex_Overview_Reference.png')
s=(R/'src/original-base.html').read_text();m=re.search(r"window.LOGO_SRC='data:image/png;base64,([^']+)'",s)
if m:(R/'reference/ScienceScope_Logo.png').write_bytes(base64.b64decode(m.group(1)))
# Update focused flow sheets to link latest interaction notes, avoiding contradictory earlier wording.
for p in (R/'docs/archive/legacy/flows').glob('*.md'):
 t=p.read_text();p.write_text(t+'\n\n## v0.3 交互补充\n\n阅读 `../02_INTERACTION_CONTRACTS.md` 与 `../03_DESKTOP_WINDOWS.md`：本轮修正了菜单/浮层、计划日志附件、消息定位、独立窗口和上下文占用。保留本文件的数据语义，实际点击方式以本轮说明为准。\n')
(R/'README.md').write_text('''# ScienceScope · 交互优化版 v0.3

先打开 **ScienceScope.html**。不需要 npm 或服务器。底栏“页面目录”可浏览 49 个页面状态；Ctrl K 搜索与命令。

本轮保持上版视觉与用户 PPT 结构，修复菜单/浮层、置顶、项目折叠、浏览全部、上下文悬停、消息操作、计划日志及多窗口体验。

## 体验路径

工作对话 → 右上角项目摘要 → 文件预览与批注 → 会议秘书 → 编辑下一步提示词。

工作站 → 添加计划/日志 → 拖入附件 → 保存/删除/撤销；点日志卡打开详情并定位消息。

项目/对话 … 或右键 → 手动置顶/归档/重命名；侧栏底部浏览全部支持搜索。

左下角全局助手 → 独立窗口 → 收起为球 → 展开 → 点击项目/工作站定位主应用。

## 包内文件

- `CODEX_START.md`：本地开发总入口。
- `docs/`：总说明、交互与窗口说明、十条反馈、研究参考、49 份逐页文档、五份流程说明。
- `screenshots/index.html`：全页面截图索引。
- `qa/results.json` 与 `qa/test_interactions.py`：本轮可重复检查及结果。
- `src/`：保留的上版源文件和本轮可读样式/交互改动，`build.py` 可生成独立 HTML。
- `reference/`：用户 PPT、Logo 与本轮 Codex 截图。

## 使用范围

页面的导航、编辑、附件、批注、消息和独立浏览窗口可操作；数据保存在本次内存，刷新会重置，可显式导出。模型/API/秘书总结、统计值和外部网页属于示例或待接入。真实 DSH 及 Windows 原生窗口/目录由本地 Codex 实现。

普通浏览器可能将弹窗作为新标签或阻止弹窗，请允许当前文件打开辅助窗口。OS 悬浮球、透明窗、always-on-top 由正式桌面宿主提供。

没有字体文件、依赖目录、API 密钥、数据库或本地研究数据。源 PPT 内的原有示例文字仅作用户设计依据。
''')
print(len(specs),'page documents generated')
