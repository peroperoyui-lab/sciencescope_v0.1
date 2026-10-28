# Builds the editing-desk gallery cards (U0): page mocks of the desk window, the entry card,
# menus and the index picker (U5).
# Run from the repo root: python3 -I docs/design/system/build/desk/gen.py .
import sys, pathlib
ROOT = pathlib.Path(sys.argv[1])
COMP = ROOT / 'docs/design/system/project/components'


def card(name, meta, body, readme):
    html = (f'<!-- @dsCard {meta} -->\n<!doctype html>\n<html lang="zh-CN">\n<head><meta charset="utf-8"><title>{name}</title></head>\n<body>\n'
            + body.strip('\n') + '\n<script>window.SS && SS.mount(document.body)</script>\n</body>\n</html>\n')
    d = COMP / name
    d.mkdir(parents=True, exist_ok=True)
    (d / 'preview.html').write_text(html)
    (d / 'README.md').write_text(readme.strip() + '\n')
    print(name, len(html.encode()), 'bytes')


def icon_btn(icon, tip, extra=''):
    return f'<button class="ss-icon-btn" type="button" aria-label="{tip}" data-tip="{tip}"{extra}><i data-i="{icon}"></i></button>'


def ftype(kind):
    letter = {'docx': 'W', 'tex': 'T', 'md': 'M', 'pdf': 'P', 'group': 'V'}[kind]
    return f'<span class="ss-ftype ss-ftype--{kind}" aria-hidden="true">{letter}</span>'


# ---------- window chrome ----------
TABS = [('docx', 'thesis.docx'), ('tex', 'method.tex'), ('md', 'outline.md'), ('pdf', 'Ragin_2008.pdf')]


def titlebar(active, dirty=()):
    tabs = ''
    for kind, name in TABS:
        sel = ' aria-selected="true"' if name == active else ' aria-selected="false"'
        end = '<span class="ss-doctab__dirty" aria-label="有修改未写回"></span>' if name in dirty else icon_btn('x', '关闭')
        tabs += f'<div class="ss-doctab" role="tab"{sel}>{ftype(kind)}<span class="ss-truncate">{name}</span>{end}</div>'
    return f'''<header class="ss-titlebar">
    <span class="ss-titlebar__brand"><i data-logo></i>编辑台</span>
    <nav class="ss-doctabs" role="tablist" aria-label="打开的文稿">{tabs}</nav>
    {icon_btn('plus', '打开文稿', ' style="-webkit-app-region:no-drag"')}
    <span class="ss-titlebar__spacer"></span>
    <span class="ss-titlebar__title">城市韧性研究</span>
    <button class="ss-winctl" type="button" aria-label="最小化"><i data-i="minus"></i></button>
    <button class="ss-winctl" type="button" aria-label="最大化"><i data-i="square"></i></button>
    <button class="ss-winctl ss-winctl--close" type="button" aria-label="关闭"><i data-i="x"></i></button>
  </header>'''


SEP = '<span class="ss-ribbon__sep"></span>'
UNDO = icon_btn('undo-2', '撤销 Ctrl Z') + icon_btn('redo-2', '重做 Ctrl Y')
FORMAT = (icon_btn('bold', '加粗 Ctrl B') + icon_btn('italic', '斜体 Ctrl I') + icon_btn('underline', '下划线 Ctrl U')
          + icon_btn('superscript', '上标') + icon_btn('subscript', '下标') + icon_btn('remove-formatting', '清除格式'))
LISTS = icon_btn('list', '项目符号') + icon_btn('list-ordered', '编号')
MARKS = ('<button class="ss-btn ss-btn--ghost ss-btn--sm" type="button"><i data-i="message-square-plus"></i>批注</button>'
         '<button class="ss-btn ss-btn--ghost ss-btn--sm" type="button"><i data-i="link-2"></i>索引</button>'
         '<button class="ss-btn ss-btn--ghost ss-btn--sm" type="button"><i data-i="text-quote"></i>引用到对话</button>')


def style_select(value):
    return f'<button class="ss-select ss-select--sm" type="button" aria-haspopup="listbox" data-tip="段落样式"><span class="ss-select__value">{value}</span><i data-i="chevron-down"></i></button>'


def save_btn(name):
    return (f'<button class="ss-btn ss-btn--primary ss-btn--sm" type="button" data-tip="写回项目文件夹里的 {name}" data-kbd="Ctrl S">'
            '<i data-i="save"></i>保存</button>')


def ribbon(kind, compare=False):
    tabs = ['开始', '审阅', '视图']
    bar = ''
    if kind == 'docx':
        bar = (UNDO + SEP + style_select('正文') + SEP + FORMAT + SEP + LISTS + SEP + MARKS
               + '<span class="ss-ribbon__spacer"></span>'
               + f'<button class="ss-btn ss-btn--ghost ss-btn--sm" type="button"{" aria-pressed=\"true\" style=\"background:var(--selected)\"" if compare else ""}><i data-i="git-compare"></i>比较</button>'
               + save_btn('thesis.docx'))
    elif kind == 'tex':
        bar = (UNDO + SEP
               + '<div class="ss-seg ss-seg--sm" role="group" aria-label="视图"><button type="button" aria-pressed="false">源码</button><button type="button" aria-pressed="true"><i data-i="columns-2"></i>并排</button><button type="button" aria-pressed="false">渲染</button></div>'
               + SEP + style_select('\\section') + icon_btn('bold', '加粗：\\textbf') + icon_btn('italic', '斜体：\\emph')
               + '<button class="ss-btn ss-btn--ghost ss-btn--sm" type="button"><i data-i="radical"></i>公式</button>'
               + icon_btn('quote', '插入引用：\\cite') + SEP + MARKS
               + '<span class="ss-ribbon__spacer"></span>'
               + '<button class="ss-btn ss-btn--sm" type="button" data-tip="用本机的 TeX Live 2025 编译，结果在渲染栏预览"><i data-i="file-output"></i>编译 PDF</button>'
               + save_btn('chapters/method.tex'))
    elif kind == 'md':
        bar = (UNDO + SEP
               + '<div class="ss-seg ss-seg--sm" role="group" aria-label="视图"><button type="button" aria-pressed="true">渲染</button><button type="button" aria-pressed="false">源码</button></div>'
               + SEP + style_select('正文') + icon_btn('bold', '加粗 Ctrl B') + icon_btn('italic', '斜体 Ctrl I')
               + icon_btn('code', '行内代码') + icon_btn('link', '链接') + icon_btn('sigma', '公式') + SEP + LISTS + SEP + MARKS
               + '<span class="ss-ribbon__spacer"></span>' + save_btn('notes/outline.md'))
    elif kind == 'pdf':
        tabs = ['阅览', '视图']
        bar = (icon_btn('zoom-out', '缩小') + '<span class="ss-muted" style="font-size:12px;width:40px;text-align:center">100%</span>' + icon_btn('zoom-in', '放大')
               + icon_btn('scan', '适应宽度') + SEP
               + icon_btn('chevron-up', '上一页') + '<span style="font-size:12px;padding:0 4px">3 / 18</span>' + icon_btn('chevron-down', '下一页') + SEP
               + '<button class="ss-btn ss-btn--ghost ss-btn--sm" type="button"><i data-i="highlighter"></i>标记</button>'
               + MARKS + SEP + icon_btn('search', '在文中查找 Ctrl F')
               + '<span class="ss-ribbon__spacer"></span>'
               + '<span class="ss-tag"><i data-i="eye"></i>只读</span>'
               + '<button class="ss-btn ss-btn--ghost ss-btn--sm" type="button"><i data-i="external-link"></i>用系统阅读器打开</button>')
    tab_html = ''.join(f'<button class="ss-tab" role="tab" type="button" aria-selected="{"true" if i == 0 else "false"}">{t}</button>' for i, t in enumerate(tabs))
    return f'''<div class="ss-ribbon">
    <div class="ss-ribbon__tabs"><nav class="ss-tabs" role="tablist" aria-label="功能区">{tab_html}</nav><span class="ss-ribbon__spacer"></span>{icon_btn('chevron-up', '收起功能区 Ctrl F1')}</div>
    <div class="ss-ribbon__bar">{bar}</div>
  </div>'''


FILES = [('docx', 'thesis.docx', 'v7'), ('tex', 'chapters/method.tex', 'v3'), ('md', 'notes/outline.md', 'v2'),
         ('pdf', 'refs/Ragin_2008.pdf', ''), ('docx', '开题报告.docx', 'v4'), ('group', '答辩稿（只在应用内）', 'v3')]


def nav(active, outline):
    files = ''
    for kind, name, end in FILES:
        cur = ' aria-current="true"' if name.endswith(active) else ''
        files += f'<button class="ss-desk-file" type="button"{cur}>{ftype(kind)}<span class="ss-desk-file__name">{name}</span><span class="ss-desk-file__end">{end}</span></button>'
    items = ''.join(f'<li><button type="button" style="--lv:{lv}"{" aria-current=\"true\"" if cur else ""}>{text}</button></li>' for lv, text, cur in outline)
    return f'''<aside class="ss-desk-nav">
      <div class="ss-desk-nav__section">
        <div class="ss-desk-nav__head"><span>文件</span>{icon_btn('search', '查找文件')}{icon_btn('folder-open', '打开项目文件夹里的其他文稿')}</div>
        {files}
      </div>
      <div class="ss-desk-nav__section" style="flex:1">
        <div class="ss-desk-nav__head"><span>大纲</span>{icon_btn('chevrons-down-up', '全部收起')}</div>
        <ul class="ss-outline">{items}</ul>
      </div>
      <div class="ss-splitter ss-splitter--end" data-min="180" data-max="320" data-default="232"></div>
    </aside>'''


def statusbar(items, tree_on=False):
    left = ''.join(f'<span class="ss-statusbar__item">{x}</span>' for x in items)
    return f'''<footer class="ss-statusbar">
    {left}
    <span class="ss-statusbar__spacer"></span>
    <button class="ss-statusbar__btn" type="button" aria-pressed="{"true" if tree_on else "false"}" data-tip="这份文稿的版本分叉树"><i data-i="git-fork"></i>版本树</button>
    <button class="ss-statusbar__btn" type="button"><i data-i="message-square"></i>第三章：组态分析</button>
    <span class="ss-statusbar__item">100%</span>
  </footer>'''


def window(active, kind, body, status, dirty=(), compare=False, tree_on=False):
    return f'''<div class="ss-shell ss-desk">
  {titlebar(active, dirty)}
  {ribbon(kind, compare)}
  <div class="ss-shell__body">
    {body}
  </div>
  {statusbar(status, tree_on)}
</div>'''


def panel(tabs, active, inner, width=336, foot=''):
    t = ''.join(f'<button class="ss-tab" role="tab" type="button" aria-selected="{"true" if name == active else "false"}">{name}{f"<span class=\"ss-tab__count\">{n}</span>" if n else ""}</button>' for name, n in tabs)
    return f'''<aside class="ss-panel" style="width:{width}px">
      <div class="ss-splitter ss-splitter--start" data-min="280" data-max="560" data-default="{width}"></div>
      <div class="ss-panel__head" style="padding-left:8px"><nav class="ss-tabs" role="tablist" aria-label="侧栏" style="align-self:stretch">{t}</nav><span style="flex:1"></span>{icon_btn('x', '关闭侧栏')}</div>
      {inner}
      {foot}
    </aside>'''


PANEL_TABS = [('批注与索引', 5), ('对话', 0)]
DOCX_OUTLINE = [(0, '第三章 研究设计', False), (1, '3.1 研究方法', False), (1, '3.2 样本与数据', True), (2, '3.2.1 指标合成', False),
                (2, '3.2.2 校准', False), (1, '3.3 稳健性检验', False), (0, '第四章 实证结果', False), (1, '4.1 必要条件分析', False),
                (1, '4.2 组态分析', False), (0, '第五章 结论与讨论', False)]
DOCX_STATUS = [f'{ftype("docx")}thesis.docx', 'v7 · 主线 · 草稿', '<span class="ss-dot ss-dot--warn"></span>有 4 处修改未写回', '12,480 字']

EQ = ('<span class="ss-math"><i>CI</i><sub><i>i</i></sub><span class="ss-math__op">=</span>'
      '<span class="ss-limits"><small><i>m</i></small><span>∑</span><small><i>j</i>=1</small></span>'
      '<i>w</i><sub><i>j</i></sub><i>x</i><sub><i>ij</i></sub></span>')


def docx_page(toolbar=True, flash=False):
    ftb = '''
        <div class="ss-ftb" role="toolbar" aria-label="选中文字" style="left:-8px;bottom:calc(100% - 4px)">
          <div class="ss-ftb__row">
            <button class="ss-ftb__label" type="button">正文<i data-i="chevron-down"></i></button>
            <span class="ss-ribbon__sep" style="margin:0 2px"></span>
            ''' + icon_btn('bold', '加粗 Ctrl B') + icon_btn('italic', '斜体 Ctrl I') + icon_btn('underline', '下划线 Ctrl U') + icon_btn('superscript', '上标') + icon_btn('subscript', '下标') + '''
            <span class="ss-ribbon__sep" style="margin:0 2px"></span>
            ''' + icon_btn('message-square-plus', '添加批注') + icon_btn('link-2', '添加索引') + '''
            <button class="ss-ftb__label" type="button"><i data-i="text-quote"></i>引用到对话</button>
            ''' + icon_btn('ellipsis', '更多') + '''
          </div>
          <div class="ss-ftb__row" style="padding-top:6px;padding-bottom:6px">
            <div class="ss-ftb__ask"><i data-i="wand-sparkles"></i><span>告诉主专家怎么改，例如「语气缓和些」</span><span class="ss-kbd">Enter</span></div>
          </div>
          <div class="ss-ftb__chips"><button type="button">润色</button><button type="button">精简</button><button type="button">更正式</button><button type="button">译成英文</button><button type="button">核对数据</button></div>
        </div>''' if toolbar else ''
    sel_open, sel_close = ('<span class="ss-sel">', '</span>') if toolbar else ('', '')
    fl_open, fl_close = ('<span class="ss-flash">', '</span>') if flash else ('', '')
    return f'''<article class="ss-page">
        <h1>第三章　研究设计</h1>
        <h2>3.1　研究方法</h2>
        <p>本章采用模糊集定性比较分析（fsQCA）识别城市经济韧性的条件组态，并以面板回归检验结论的稳健性。与传统回归关注单一变量的净效应不同，组态视角关注多个条件如何共同导致结果，适合解释“多条路径通向同一结果”的现象。</p>
        <div style="position:relative">{ftb}
        <p>{sel_open}经济韧性指数采用熵权法合成，涵盖抵抗力、恢复力与再组织能力三个维度{sel_close}，各维度下设 4–6 个二级指标，权重由各指标的信息熵确定。</p>
        </div>
        <h2>3.2　样本与数据</h2>
        <p>研究样本为 <span class="ss-bind" data-tip="索引：data/city_panel.csv、scripts/sample.py">98 个地级市</span>，时间跨度为 2010–2022 年，数据主要来自《中国城市统计年鉴》和各市统计公报，缺失值用线性插值补齐。</p>
        <p>结果表明，在样本量为 98 的条件下，组态方法的解释力总体高于基线模型，<span class="ss-cmt">但对东部城市的区分度有限</span>。</p>
        <p class="ss-page__eq"><span class="ss-atom" data-tip="Word 公式：只显示，保存时原样保留">{EQ}</span><span class="ss-page__eqno">（3-1）</span></p>
        <p>{fl_open}一致性阈值设为 <span class="ss-cmt" data-active>0.85</span>，案例频数阈值设为 2{fl_close}；校准锚点分别取各条件的第 95、50、5 百分位，<span class="ss-qmark">对应“完全隶属”“交叉点”和“完全不隶属”</span>。</p>
        <table><caption>表 3-1　条件变量与校准锚点</caption>
          <thead><tr><th>条件</th><th>完全隶属</th><th>交叉点</th><th>完全不隶属</th></tr></thead>
          <tbody><tr><td>数字经济水平</td><td>0.82</td><td>0.41</td><td>0.12</td></tr><tr><td>产业结构高级化</td><td>1.96</td><td>1.08</td><td>0.63</td></tr><tr><td>政府干预</td><td>0.31</td><td>0.18</td><td>0.09</td></tr></tbody>
        </table>
        <span class="ss-page__pageno">— 23 —</span>
      </article>'''


def change_card(who, avatar, time, body, actions=('撤回', '保留', '定位'), quote=None):
    q = f'<p class="ss-desk-card__quote">{quote}</p>' if quote else ''
    btns = ''.join(f'<button class="ss-btn{" ss-btn--ghost" if a != "撤回" else ""}" type="button">{a}</button>' for a in actions)
    return f'''<div class="ss-desk-card">
          <div class="ss-desk-card__head">{avatar}<span>{who}</span><time>{time}</time></div>
          {q}<p class="ss-desk-card__body">{body}</p>
          <div class="ss-desk-card__foot">{btns}</div>
        </div>'''


AV_MAIN = '<span class="ss-avatar">主</span>'
AV_YOU = '<span class="ss-avatar ss-avatar--user">Y</span>'
AV_SEC = '<span class="ss-avatar">秘</span>'


def note_card(kind, who, avatar, time, quote, body, active=False, extra=''):
    icon = 'message-square' if kind == '批注' else 'link-2'
    act = ' data-active' if active else ''
    return f'''<div class="ss-desk-card"{act}>
          <div class="ss-desk-card__head"><i data-i="{icon}" class="ss-i--sm" style="color:var({'--warn' if kind == '批注' else '--accent'})"></i><span>{kind}</span>{avatar}<span>{who}</span><time>{time}</time></div>
          <p class="ss-desk-card__quote">{quote}</p><p class="ss-desk-card__body">{body}</p>{extra}
          <div class="ss-desk-card__foot"><button class="ss-btn ss-btn--ghost" type="button"><i data-i="locate"></i>定位</button><button class="ss-btn ss-btn--ghost" type="button"><i data-i="pencil"></i>编辑</button><button class="ss-btn ss-btn--ghost" type="button"><i data-i="trash-2"></i>删除</button></div>
        </div>'''


def notes_panel(active_tab='批注与索引', composer=True, filt='全部'):
    seg = ''.join(f'<button type="button" aria-pressed="{"true" if name == filt else "false"}">{name}</button>' for name in ('全部', '批注', '索引'))
    comp = '''<div class="ss-desk-card" style="border-color:var(--accent-line);box-shadow:0 0 0 1px var(--accent-line)">
          <div class="ss-desk-card__head"><i data-i="message-square-plus" class="ss-i--sm" style="color:var(--accent)"></i><span>新批注</span></div>
          <p class="ss-desk-card__quote">经济韧性指数采用熵权法合成，涵盖抵抗力、恢复力与再组织能力三个维度</p>
          <textarea class="ss-textarea" rows="2" placeholder="写下你的意见或要核对的地方"></textarea>
          <div class="ss-desk-card__foot"><button class="ss-btn ss-btn--ghost" type="button"><i data-i="link-2"></i>改成索引</button><span style="flex:1"></span><button class="ss-btn ss-btn--ghost" type="button">取消</button><button class="ss-btn ss-btn--primary" type="button">添加</button></div>
        </div>''' if composer else ''
    idx_extra = '<dl class="ss-props" style="margin:0"><dt>数据</dt><dd>data/city_panel.csv</dd><dt>脚本</dt><dd>scripts/sample.py</dd></dl>'
    inner = f'''<div class="ss-toolbar" style="padding:8px 12px;border-bottom:1px solid var(--line);gap:6px"><div class="ss-seg ss-seg--sm" role="group" aria-label="类型">{seg}</div><span style="flex:1"></span><button class="ss-select ss-select--sm ss-select--ghost" type="button"><span class="ss-select__value">所有人</span><i data-i="chevron-down"></i></button></div>
      <div class="ss-panel__body" style="display:grid;gap:10px;align-content:start;padding:12px">
        {comp}
        <div class="ss-desk-list">
        {note_card('批注', '你', AV_YOU, '10-21', '0.85', '导师要求给出阈值依据，引 Ragin 2008 第 3 章。', active=True)}
        {note_card('批注', '主专家', AV_MAIN, '14:02', '但对东部城市的区分度有限', '这句和 4.2 节“东部城市组态最多”的结论不一致，建议核对东部样本。')}
        {note_card('索引', '主专家', AV_MAIN, '10-21', '98 个地级市', '去重后进入分析的城市数。', extra=idx_extra)}
        {note_card('索引', '你', AV_YOU, '10-19', '熵权法', '知识库：方法「熵权法」；资料 Wang 2021 第 6 页。')}
        </div>
        <p class="ss-prov">标记的文字全部删掉时，批注或索引跟着删掉；撤销会把文字和它们一起恢复。docx 的批注保存时写进 Word 批注。</p>
      </div>'''
    return panel(PANEL_TABS, active_tab, inner)


TOAST = '''<div class="ss-toast" data-static style="position:sticky;bottom:16px;margin:0 auto;width:fit-content;z-index:var(--z-sticky)"><span class="ss-avatar">主</span><span class="ss-toast__msg">主专家改写了 3.2 节 1 句</span><button class="ss-btn ss-btn--ghost ss-btn--sm" type="button">看改了什么</button><button class="ss-btn ss-btn--ghost ss-btn--sm" type="button">撤销</button><button class="ss-icon-btn ss-icon-btn--sm" type="button" aria-label="关闭"><i data-i="x"></i></button></div>'''


ORB = '<button class="ss-desk-orb" type="button" aria-label="秘书" data-tip="这个对话的秘书"><i data-i="clipboard-list"></i></button>'

# ---------- 1. docx ----------
docx_body = f'''{nav('thesis.docx', DOCX_OUTLINE)}
    <main class="ss-desk-canvas">{ORB}
      {docx_page()}
      {TOAST}
    </main>
    {notes_panel()}'''

card('PageDesk', 'group="编辑台" page height=900 width=1536 subtitle="编辑台：独立窗口，像 Word 一样正常编辑，不显示修订标记；划选弹出 Office 式浮动工具条；右侧「批注与索引」新增、查看、修改、删除"',
     window('thesis.docx', 'docx', docx_body, DOCX_STATUS, dirty=('thesis.docx',)), '''
整页示例：编辑台（docx）。编辑台是独立的系统窗口，主窗口留在对话；样式参照 Office 365 网页版。

## 区域

- 标题栏：「编辑台」、打开的文稿标签（有未写回修改的标签显示圆点，悬停变成 ×）、「+」打开文稿、项目名、窗口按钮。
- 功能区：一行标签（开始、审阅、视图）加一行命令，可以收起（Ctrl F1）。开始：撤销重做、段落样式、加粗斜体下划线上下标、清除格式、列表、批注、索引、引用到对话；右边「比较」和「保存」（写回项目文件夹里的原文件，Ctrl S）。
- 左栏：上半是文件（项目文件夹里的 docx、tex、md、pdf，加只在应用内的版本组），右侧是最新版本号；下半是大纲，当前位置有竖线。
- 中间：页面按 Word 的版式画（正文衬线字体、首行缩进），右上角悬浮秘书按钮。
- 右侧栏：「批注与索引」和「对话」。
- 底栏：文件名、当前版本（版本号、分支、层级）、保存状态、字数；右边「版本树」按钮、绑定的对话、缩放。

## 演示的规则

- 正文像 Word 一样正常编辑，不显示增删高亮和删除线。谁改了哪里（你、哪位专家、哪个模型）在后台记下，看差异用「比较」。
- AI 改完弹一条提示：「主专家改写了 3.2 节 1 句」，可以「看改了什么」（打开比较定位到这处）或「撤销」。
- 划选后弹出浮动工具条：第一行格式和批注、索引、引用到对话；第二行是改写输入框，下面是常用指令。鼠标离开后淡出。
- 批注与索引：一个入口，新增、查看、修改、删除，专家加的也在这里，可以按类型和作者筛选。批注的文字浅黄底加下划线，索引的文字下有点线；点卡片「定位」滚到原文。
- 锚点规则：批注或索引标记的文字，直到最后一个字被删掉才删除它；撤销把文字和批注、索引一起恢复。
- Word 公式、图片只显示，虚线框提示保存时原样保留。
''')

# ---------- 2. version tree ----------
ROW = 64
X1, X2 = 20, 190


def vy(r):
    return 16 + r * ROW


def vnode(x, r, v, title, meta_icon, meta, tier=None, current=False, selected=False, origin=None):
    attrs = (f' data-tier="{tier}"' if tier else '') + (' data-current' if current else '') + (f' data-origin="{origin}"' if origin else '') + (' aria-selected="true"' if selected else '')
    return f'<button class="ss-vnode" type="button" style="left:{x}px;top:{vy(r)}px"{attrs}><span class="ss-vnode__top"><span class="ss-vnode__v">{v}</span><span class="ss-vnode__title">{title}</span></span><span class="ss-vnode__meta"><i data-i="{meta_icon}"></i>{meta}</span></button>'


def down(x, r1, r2, on=False):
    cx = x + 66
    return f'<path d="M{cx} {vy(r1) + 40}V{vy(r2)}"{" data-on" if on else ""}/>'


def side(r_from, x_to, r_to):
    y = vy(r_from) + 20
    cx = x_to + 66
    if r_to is None:
        return f'<path d="M{X1 + 132} {y}H{x_to}"/>'
    return f'<path d="M{X1 + 132} {y}H{cx - 10}Q{cx} {y} {cx} {y + 10}V{vy(r_to)}"/>'


tree_nodes = ''.join([
    vnode(X1, 0, 'v1', '导入', 'import', '10-12 · 导入'),
    vnode(X1, 1, 'v2', '补充文献综述', 'pencil', '10-14 · 你'),
    vnode(X1, 2, 'v3', '导师第一轮意见', 'pencil', '10-16 · 你'),
    vnode(X1, 3, 'v4', '初稿完成', 'pencil', '10-18 · 定稿', tier='final'),
    vnode(X1, 4, 'v5', '修改方法部分', 'sparkle', '10-20 · 主专家', selected=True),
    vnode(X1, 5, 'v6', 'Word 中修改', 'file-pen', '10-21 · 外部', origin='external'),
    vnode(X1, 6, 'v7', '主线', 'pencil', '正在编辑', current=True),
    vnode(X2, 5, 'v8', '压缩到 8000 字', 'sparkle', '10-21 · 主专家'),
    vnode(X2, 6, 'v9', '期刊投稿', 'pencil', '10-22 · 投稿', tier='submit'),
])
tree_links = ''.join([down(X1, 0, 1), down(X1, 1, 2), down(X1, 2, 3), down(X1, 3, 4), down(X1, 4, 5, True), down(X1, 5, 6, True),
                      down(X2, 5, 6), side(4, X2, 5), side(2, X2 - 8, None)])
fold = f'<span class="ss-vfold" style="left:{X2 - 8}px;top:{vy(2) + 11}px" data-tip="展开这一枝">会议摘要 · 2 版<i data-i="chevron-down" class="ss-i--sm"></i></span>'
branch = f'<span class="ss-vbranch" style="left:{X2 - 4}px;top:{vy(4) + 10}px"><i data-i="git-branch" class="ss-i--sm"></i>分支：期刊投稿</span>'
ctx = '''<div class="ss-at" style="left:118px;top:''' + str(vy(4) + 30) + '''px">
          <div class="ss-menu" data-static role="menu" aria-label="版本 v5" style="min-width:212px">
            <button class="ss-menu__item" type="button" role="menuitem"><i data-i="eye"></i>打开这一版（只读）</button>
            <button class="ss-menu__item" type="button" role="menuitem"><i data-i="pencil"></i>从这一版开始编辑</button>
            <button class="ss-menu__item" type="button" role="menuitem"><i data-i="git-compare"></i>和正在编辑的 v7 比较</button>
            <button class="ss-menu__item" type="button" role="menuitem"><i data-i="file-diff"></i>和上一版比较</button>
            <div class="ss-menu__sep"></div>
            <button class="ss-menu__item" type="button" role="menuitem"><i data-i="tag"></i>改名和备注…<span class="ss-menu__end">F2</span></button>
            <button class="ss-menu__item" type="button" role="menuitem"><i data-i="star"></i>层级：草稿<i data-i="chevron-right" class="ss-menu__end" style="padding:0"></i></button>
            <button class="ss-menu__item" type="button" role="menuitem"><i data-i="download"></i>另存为文件…</button>
            <button class="ss-menu__item" type="button" role="menuitem"><i data-i="rotate-cw"></i>用这一版覆盖项目文件…</button>
            <div class="ss-menu__sep"></div>
            <button class="ss-menu__item" type="button" role="menuitem" aria-disabled="true"><i data-i="trash-2"></i>删除（有后续版本，不能删）</button>
          </div>
        </div>'''
vtree_inner = f'''<div class="ss-toolbar" style="padding:8px 12px;border-bottom:1px solid var(--line)"><span class="ss-input ss-input--sm" style="flex:1"><i data-i="search"></i><input placeholder="按标题、标签、备注、修改指令筛选" /></span></div>
      <div class="ss-vtree">
        <svg class="ss-vtree__links" width="340" height="460" aria-hidden="true">{tree_links}</svg>
        {tree_nodes}{fold}{branch}
        <div class="ss-vtree__legend"><span><i data-tier="final"></i>定稿</span><span><i data-tier="submit"></i>投稿</span><span><i data-i="file-pen" class="ss-i--sm"></i>虚线：外部修改</span><span><span class="ss-dot ss-dot--ok"></span>正在编辑</span></div>
      </div>
      <div class="ss-vtree__detail">
        <div style="display:grid;gap:6px">
          <span class="ss-input ss-input--sm"><span class="ss-mono ss-muted" style="font-size:12px">v5</span><input value="修改方法部分" aria-label="版本名称" /></span>
          <dl class="ss-props">
            <dt>层级</dt><dd><button class="ss-select ss-select--sm" type="button"><span class="ss-select__value">草稿</span><i data-i="chevron-down"></i></button></dd>
            <dt>来自</dt><dd>编辑台 · 主专家 · 10-20 16:12</dd>
            <dt>派生</dt><dd>父 v4 · 子 v6、v8</dd>
            <dt>改动</dt><dd>12 处，集中在 3.2 节</dd>
          </dl>
        </div>
        <div style="display:flex;gap:6px"><button class="ss-btn ss-btn--sm" type="button"><i data-i="pencil"></i>从这一版开始编辑</button><button class="ss-btn ss-btn--sm ss-btn--ghost" type="button"><i data-i="git-compare"></i>和 v7 比较</button></div>
      </div>'''
vtree_panel = f'''<aside class="ss-panel" style="width:360px">
      <div class="ss-splitter ss-splitter--start" data-min="300" data-max="640" data-default="360"></div>
      <div class="ss-panel__head"><i data-i="git-fork" style="margin-right:6px;color:var(--ink-2)"></i><span class="ss-panel__title">版本树 · thesis.docx</span>{icon_btn('maximize-2', '拉宽')}{icon_btn('x', '关闭')}</div>
      {vtree_inner}
    </aside>'''
versions_body = f'''{nav('thesis.docx', DOCX_OUTLINE)}
    <main class="ss-desk-canvas">{ORB}
      {docx_page(toolbar=False)}
    </main>
    {vtree_panel}'''
card('PageDeskVersions', 'group="编辑台" page height=900 width=1536 subtitle="版本树：底栏按钮打开右侧栏，从上往下分叉，样式同研究框架导图；右键版本可以从它开始编辑、比较、改层级"',
     window('thesis.docx', 'docx', versions_body, DOCX_STATUS, dirty=('thesis.docx',), tree_on=True), '''
整页示例：编辑台的版本树。底栏「版本树」按钮（工作站页面有同一个按钮）在右侧栏打开这份文稿的版本分叉树。

## 区域

- 侧栏头部：「版本树 · 文件名」、拉宽、关闭；下面一行筛选框，按标题、标签、备注和修改指令过滤。
- 树：从上往下长，根是导入的 v1；节点是版本卡片（版本号、名称、来源图标、时间或层级），连线是派生。分支从父版本右侧横出，线上标分支名；不常用的分支收成一枚「会议摘要 · 2 版」，点开展开。
- 侧栏下半：图例和选中版本的详情：名称直接改，层级下拉，来自谁、父子版本、改动摘要；「从这一版开始编辑」「和 v7 比较」。

## 演示的规则

- 正在编辑的版本号前有实心点；定稿、投稿在卡片左边有色条；从外部修改导入的版本是虚线框。
- 选中的节点有强调色描边，到当前版本的路径连线是强调色。
- 右键版本：打开（只读）、从这一版开始编辑、比较、改名和备注、层级、另存为文件、用这一版覆盖项目文件；有后续版本时不能删，菜单写明原因。
- 布局自己写，不用图布局库；节点多时可以折叠分支，侧栏可以拉宽。
''')

# ---------- 3. tex ----------
TEX = [
    ('<span class="tok-cmd">\\section</span>{研究设计}<span class="tok-cmd">\\label</span>{<span class="tok-arg">sec:design</span>}', False),
    ('', False),
    ('本章采用模糊集定性比较分析（fsQCA）识别城市经济韧性的条件组态，', False),
    ('并以面板回归检验结论的稳健性。', False),
    ('', False),
    ('<span class="tok-cmd">\\subsection</span>{指标合成}', False),
    ('经济韧性指数采用熵权法合成，第 <span class="tok-math">$i$</span> 个城市的综合得分为', False),
    ('<span class="tok-cmd">\\begin</span>{<span class="tok-env">equation</span>}', False),
    ('<span class="tok-math">  CI_i = \\sum_{j=1}^{m} w_j \\, x_{ij}</span>', False),
    ('<span class="tok-cmd">\\end</span>{<span class="tok-env">equation</span>}', False),
    ('其中 <span class="tok-math">$w_j$</span> 由第 <span class="tok-math">$j$</span> 项指标的信息熵 <span class="tok-math">$e_j$</span> 确定。', False),
    ('', False),
    ('<span class="tok-cmd">\\subsection</span>{一致性与覆盖度}', False),
    ('<span class="tok-com">% 阈值依据 Ragin (2008) 的建议</span>', False),
    ('条件组合 <span class="tok-math">$X$</span> 对结果 <span class="tok-math">$Y$</span> 的一致性定义为', False),
    ('<span class="tok-cmd">\\begin</span>{<span class="tok-env">equation</span>}', False),
    ('<span class="tok-math">  \\mathrm{Cons}(X \\le Y) = \\frac{\\sum_i \\min(x_i, y_i)}{\\sum_i x_i}</span>', True),
    ('<span class="tok-cmd">\\end</span>{<span class="tok-env">equation</span>}', False),
    ('一致性阈值取 0.85，案例频数阈值取 2<span class="tok-cmd">~\\cite</span>{<span class="tok-arg">ragin2008</span>}。', False),
    ('', False),
    ('<span class="tok-cmd">\\begin</span>{<span class="tok-env">table</span>}[h]', False),
    ('  <span class="tok-cmd">\\centering</span>', False),
    ('  <span class="tok-cmd">\\caption</span>{条件变量与校准锚点}', False),
    ('  <span class="tok-cmd">\\begin</span>{<span class="tok-env">tabular</span>}{lccc}', False),
    ('    条件 &amp; 完全隶属 &amp; 交叉点 &amp; 完全不隶属 <span class="tok-cmd">\\\\</span>', False),
    ('    数字经济水平 &amp; 0.82 &amp; 0.41 &amp; 0.12 <span class="tok-cmd">\\\\</span>', False),
    ('  <span class="tok-cmd">\\end</span>{<span class="tok-env">tabular</span>}', False),
    ('<span class="tok-cmd">\\end</span>{<span class="tok-env">table</span>}', False),
]
code = ''.join(f'<div class="ss-code__line"{" data-active" if act else ""}>{line or " "}</div>' for line, act in TEX)
CONS = ('<span class="ss-math">Cons(<i>X</i><span class="ss-math__op">≤</span><i>Y</i>)<span class="ss-math__op">=</span>'
        '<span class="ss-frac"><span>∑<sub><i>i</i></sub> min(<i>x</i><sub><i>i</i></sub>, <i>y</i><sub><i>i</i></sub>)</span><span>∑<sub><i>i</i></sub> <i>x</i><sub><i>i</i></sub></span></span></span>')
CONS_EDIT = ('<span class="ss-math">Cons(<i>X</i><span class="ss-math__op">≤</span><i>Y</i>)<span class="ss-math__op">=</span>'
             '<span class="ss-frac"><span>∑<sub><i>i</i></sub> min(<i>x</i><sub><i>i</i></sub>, <i>y</i><sub><i>i</i></sub><span class="ss-mathedit__caret"></span>)</span><span>∑<sub><i>i</i></sub> <i>x</i><sub><i>i</i></sub></span></span></span>')
EQ_TEX = ('<span class="ss-math"><i>CI</i><sub><i>i</i></sub><span class="ss-math__op">=</span>'
          '<span class="ss-limits"><small><i>m</i></small><span>∑</span><small><i>j</i>=1</small></span>'
          '<i>w</i><sub><i>j</i></sub> <i>x</i><sub><i>ij</i></sub></span>')
PAL = ['<span class="ss-frac" style="font-size:10px"><span>□</span><span>□</span></span>', '□<sup>□</sup>', '□<sub>□</sub>', '√□', '∑', '∫', '( )', '[ ]', 'min', '≤',
       'α', 'β', 'θ', 'σ', '∞', '±', '×', '→', '⋯', '▦']
pal = ''.join(f'<button type="button">{p}</button>' for p in PAL)
mathedit = f'''<div class="ss-pop ss-mathedit" data-static role="dialog" aria-label="编辑公式" style="position:absolute;left:-24px;top:calc(100% + 2px)">
            <div class="ss-pop__head"><i data-i="radical"></i><span>编辑公式（3-2）</span>{icon_btn('x', '关闭 Esc')}</div>
            <div class="ss-pop__body">
              <div class="ss-mathedit__field">{CONS_EDIT}</div>
              <div class="ss-mathedit__pal" aria-label="模板">{pal}</div>
              <div class="ss-pop__section"><div class="ss-mathedit__src" data-tip="写回源码第 17 行">\\mathrm{{Cons}}(X \\le Y) = \\frac{{\\sum_i \\min(x_i, y_i)}}{{\\sum_i x_i}}</div></div>
            </div>
            <div class="ss-pop__foot"><span class="ss-muted" style="font-size:12px">直接输入 \\frac、^、_ 也可以</span><span style="display:flex;gap:6px"><button class="ss-btn ss-btn--sm ss-btn--ghost" type="button">取消</button><button class="ss-btn ss-btn--sm ss-btn--primary" type="button">应用</button></span></div>
          </div>'''
tex_render = f'''<article class="ss-page" style="font-size:14px">
          <h2 style="margin-top:0">3　研究设计</h2>
          <p>本章采用模糊集定性比较分析（fsQCA）识别城市经济韧性的条件组态，并以面板回归检验结论的稳健性。</p>
          <h3>3.1　指标合成</h3>
          <p>经济韧性指数采用熵权法合成，第 <span class="ss-math"><i>i</i></span> 个城市的综合得分为</p>
          <p class="ss-page__eq"><span class="ss-eqbox">{EQ_TEX}</span><span class="ss-page__eqno">(3-1)</span></p>
          <p>其中 <span class="ss-math"><i>w</i><sub><i>j</i></sub></span> 由第 <span class="ss-math"><i>j</i></span> 项指标的信息熵 <span class="ss-math"><i>e</i><sub><i>j</i></sub></span> 确定。</p>
          <h3>3.2　一致性与覆盖度</h3>
          <p>条件组合 <span class="ss-math"><i>X</i></span> 对结果 <span class="ss-math"><i>Y</i></span> 的一致性定义为</p>
          <div style="position:relative"><p class="ss-page__eq"><span class="ss-eqbox" data-active>{CONS}</span><span class="ss-page__eqno">(3-2)</span></p>{mathedit}</div>
          <p>一致性阈值取 0.85，案例频数阈值取 2 [<span style="color:var(--accent-ink)">Ragin, 2008</span>]。</p>
          <table><caption>表 3.1　条件变量与校准锚点</caption><thead><tr><th>条件</th><th>完全隶属</th><th>交叉点</th><th>完全不隶属</th></tr></thead><tbody><tr><td>数字经济水平</td><td>0.82</td><td>0.41</td><td>0.12</td></tr></tbody></table>
        </article>'''
TEX_OUTLINE = [(0, '3 研究设计', False), (1, '3.1 指标合成', False), (1, '3.2 一致性与覆盖度', True), (1, '表 3.1 条件变量与校准锚点', False)]
tex_body = f'''{nav('method.tex', TEX_OUTLINE)}
    <div class="ss-split">
      <div class="ss-code" aria-label="源码">{code}</div>
      <div class="ss-split__rule"></div>
      <div class="ss-split__render" style="position:relative">
        {tex_render}
      </div>
    </div>'''
card('PageDeskTex', 'group="编辑台" page height=900 width=1536 subtitle="tex：左边源码、右边实时渲染，两边滚动联动；点渲染里的公式弹出公式编辑框，改完写回源码；装了 TeX 时可以编译 PDF"',
     window('method.tex', 'tex', tex_body, [f'{ftype("tex")}chapters/method.tex', 'v3 · 主线 · 草稿', '<span class="ss-dot ss-dot--warn"></span>有修改未写回', '第 17 行，第 58 列', '渲染：内置，不需要装 TeX'], dirty=('method.tex',)), '''
整页示例：编辑台（tex）。像 Overleaf 一样左边源码、右边实时渲染；不依赖用户装 TeX。

## 区域

- 功能区：视图「源码 / 并排 / 渲染」，默认并排；章节样式、加粗（\\textbf）、斜体（\\emph）、「公式」、插入引用（\\cite）、批注、索引、引用到对话；右边「编译 PDF」和「保存」。
- 左栏：文件和大纲（由 \\section、\\subsection、表和图的标题生成）。
- 中间左：源码，行号、语法着色（命令、环境、数学、注释、参数），当前行浅底。CodeMirror 6。
- 中间右：渲染（章节、列表、引用、表格和公式，KaTeX），和源码滚动联动；右侧栏默认收起，给两栏留宽度。

## 演示的规则

- 悬停渲染里的公式出现浅色框，点一下弹出公式编辑框：上面是可视化编辑区（MathLive），中间模板（分式、上下标、根号、求和、积分、括号、希腊字母、矩阵），下面是会写回的 LaTeX 和行号。应用后写回源码，是一条普通修改记录。
- 也可以直接在可视化区输入 \\frac、^、_。
- 检测到 TeX Live 或 MiKTeX 时「编译 PDF」可用，结果在渲染栏的位置预览；没有时按钮停用，i 提示说明怎么装。应用内渲染不求和 PDF 逐像素一致。
- 底栏写明当前行列和「渲染：内置，不需要装 TeX」。
''')

# ---------- 4. markdown + context menu ----------
md_menu = '''<div class="ss-at" style="left:330px;top:344px">
          <div class="ss-menu" data-static role="menu" aria-label="文字" style="min-width:232px">
            <button class="ss-menu__item" type="button" role="menuitem"><i data-i="scissors"></i>剪切<span class="ss-menu__end">Ctrl X</span></button>
            <button class="ss-menu__item" type="button" role="menuitem"><i data-i="copy"></i>复制<span class="ss-menu__end">Ctrl C</span></button>
            <button class="ss-menu__item" type="button" role="menuitem"><i data-i="clipboard-paste"></i>粘贴<span class="ss-menu__end">Ctrl V</span></button>
            <div class="ss-menu__sep"></div>
            <button class="ss-menu__item" type="button" role="menuitem"><i data-i="wand-sparkles"></i>改写…<span class="ss-menu__end">Ctrl J</span></button>
            <button class="ss-menu__item" type="button" role="menuitem"><i data-i="text-quote"></i>引用到对话<span class="ss-menu__end">Ctrl Shift L</span></button>
            <div class="ss-menu__sep"></div>
            <button class="ss-menu__item" type="button" role="menuitem"><i data-i="message-square-plus"></i>添加批注<span class="ss-menu__end">Ctrl Alt M</span></button>
            <button class="ss-menu__item" type="button" role="menuitem"><i data-i="link-2"></i>添加索引…</button>
            <button class="ss-menu__item" type="button" role="menuitem" data-active><i data-i="info"></i>查看索引</button>
            <div class="ss-menu__sep"></div>
            <button class="ss-menu__item" type="button" role="menuitem"><i data-i="history"></i>这句的修改记录</button>
            <button class="ss-menu__item" type="button" role="menuitem"><i data-i="git-fork"></i>在版本树里定位</button>
          </div>
        </div>'''
md_page = f'''<article class="ss-page ss-page--md">
        <h1>第三章写作提纲</h1>
        <blockquote>目标：两周内交初稿给导师，重点是 3.2 节的数据说明。</blockquote>
        <h2>一、要回答的问题</h2>
        <ol><li>哪些条件组合导致<strong>高经济韧性</strong>？</li><li>数字经济是不是核心条件，还是只在东部城市起作用？</li></ol>
        <h2>二、数据</h2>
        <p>样本 <span class="ss-bind ss-sel">98 个地级市，去掉了 4 个数据缺失超过三成的城市</span>；指标见 <code>data/indicators.csv</code>，合成方法用熵权法，公式 <span class="ss-math"><i>CI</i><sub><i>i</i></sub> = ∑ <i>w</i><sub><i>j</i></sub><i>x</i><sub><i>ij</i></sub></span>。</p>
        <ul><li>年鉴缺失值：线性插值，记在 <a>清洗日志</a></li><li>校准锚点：95 / 50 / 5 百分位</li></ul>
        <h2>三、待办</h2>
        <ul><li>补稳健性检验：去掉直辖市</li><li>和统计审稿人确认标准误按省份聚类</li></ul>
        {md_menu}
      </article>'''
sources_inner = f'''<div class="ss-toolbar" style="padding:8px 12px;border-bottom:1px solid var(--line);gap:6px"><div class="ss-seg ss-seg--sm" role="group" aria-label="类型"><button type="button" aria-pressed="false">全部</button><button type="button" aria-pressed="false">批注</button><button type="button" aria-pressed="true">索引</button></div><span style="flex:1"></span><button class="ss-select ss-select--sm ss-select--ghost" type="button"><span class="ss-select__value">所有人</span><i data-i="chevron-down"></i></button></div>
      <div class="ss-panel__body" style="display:grid;gap:10px;align-content:start;padding:12px">
        <div class="ss-desk-list">
          <div class="ss-desk-card" data-active><div class="ss-desk-card__head"><i data-i="link-2" class="ss-i--sm" style="color:var(--accent)"></i><span>索引</span>{AV_MAIN}<span>主专家</span><time>10-21</time></div><p class="ss-desk-card__quote">98 个地级市，去掉了 4 个数据缺失超过三成的城市</p><p class="ss-desk-card__body">去重后进入分析的城市数。</p><dl class="ss-props" style="margin:0"><dt>数据</dt><dd>data/city_panel.csv</dd><dt>脚本</dt><dd>scripts/sample.py（10-21 运行）</dd><dt>对话</dt><dd>第三章：组态分析</dd></dl><div class="ss-desk-card__foot"><button class="ss-btn ss-btn--ghost" type="button"><i data-i="external-link"></i>打开脚本</button><button class="ss-btn ss-btn--ghost" type="button"><i data-i="pencil"></i>编辑</button><button class="ss-btn ss-btn--ghost" type="button"><i data-i="trash-2"></i>删除</button></div></div>
          <div class="ss-desk-card"><div class="ss-desk-card__head"><i data-i="link-2" class="ss-i--sm" style="color:var(--accent)"></i><span>索引</span>{AV_YOU}<span>你</span><time>10-19</time></div><p class="ss-desk-card__quote">熵权法</p><p class="ss-desk-card__body">知识库：方法「熵权法」；资料 Wang 2021 第 6 页。</p><div class="ss-desk-card__foot"><button class="ss-btn ss-btn--ghost" type="button"><i data-i="locate"></i>定位</button><button class="ss-btn ss-btn--ghost" type="button"><i data-i="pencil"></i>编辑</button><button class="ss-btn ss-btn--ghost" type="button"><i data-i="trash-2"></i>删除</button></div></div>
        </div>
      </div>'''
MD_TOAST = '''<div class="ss-toast" data-static style="position:sticky;bottom:16px;margin:0 auto;width:fit-content;z-index:var(--z-sticky)"><i data-i="link-2"></i><span class="ss-toast__msg">删掉的文字带走了 1 条索引</span><button class="ss-btn ss-btn--ghost ss-btn--sm" type="button">撤销</button><button class="ss-icon-btn ss-icon-btn--sm" type="button" aria-label="关闭"><i data-i="x"></i></button></div>'''
MD_OUTLINE = [(0, '第三章写作提纲', False), (1, '一、要回答的问题', False), (1, '二、数据', True), (1, '三、待办', False)]
md_body = f'''{nav('outline.md', MD_OUTLINE)}
    <main class="ss-desk-canvas">{ORB}
      {md_page}
    </main>
    {panel(PANEL_TABS, '批注与索引', sources_inner)}'''
card('PageDeskMarkdown', 'group="编辑台" page height=900 width=1536 subtitle="md：渲染视图像普通文档一样直接改，也可以切到源码；右键菜单分组：编辑、改写与引用、批注与索引、记录与版本"',
     window('outline.md', 'md', md_body, [f'{ftype("md")}notes/outline.md', 'v2 · 主线', '<span class="ss-dot ss-dot--ok"></span>已写回项目文件', '612 字']), '''
整页示例：编辑台（Markdown）和右键菜单。

## 区域

- 功能区：视图「渲染 / 源码」，默认渲染；段落样式、加粗、斜体、行内代码、链接、公式、列表、批注、索引、引用到对话、保存。
- 中间：渲染视图（prosemirror-markdown），标题、列表、引用块、代码、链接、公式都能直接改；源码视图是 CodeMirror。保存时不改动用户没碰过的写法（列表符号、空行）。
- 右侧栏：「批注与索引」筛到「索引」，列出这份文稿的全部索引（说明、数据、脚本、对话），可以编辑、删除。

## 右键菜单

- 分四组：剪切、复制、粘贴 │ 改写…、引用到对话 │ 添加批注、添加索引…、查看索引（有索引时） │ 这句的修改记录、在版本树里定位。
- 没有选区时作用于光标所在的句子。没有索引时不显示「查看索引」，PDF 里没有剪切、粘贴和改写。
- 「查看索引」在右侧「批注与索引」里展开那条索引：说明、数据、脚本、对话，点一项在文件预览里打开并定位。
- 索引标记的文字全部删掉时索引跟着删掉，提示条可以撤销；撤销把文字和索引一起恢复。
''')

# ---------- 5. pdf ----------
pdf_page = '''<article class="ss-page ss-page--pdf">
        <h1 style="text-align:center;margin-bottom:6px">Set-Theoretic Methods for the Social Sciences</h1>
        <p style="text-align:center;color:var(--muted);margin-bottom:18px">Chapter 3 · Consistency and Coverage</p>
        <div class="ss-pdf-cols">
          <h2>3.1 Set-theoretic consistency</h2>
          <p>Consistency assesses the degree to which the cases sharing a given combination of conditions agree in displaying the outcome in question. <span class="ss-qmark">When consistency is low, there is little point in assessing coverage, since the set relation is not supported.</span></p>
          <p>With fuzzy sets, consistency is computed as the sum of the minimum of each case’s membership in X and in Y, divided by the sum of memberships in X. <span class="ss-cmt" data-active>Values below 0.75 indicate substantial inconsistency;</span> researchers often choose a threshold of 0.8 or higher for sufficiency.</p>
          <h2>3.2 Coverage</h2>
          <p>Coverage gauges empirical relevance or importance. When there are several paths to the same outcome, the coverage of any single path may be quite small, and <span class="ss-qmark">raw coverage should be distinguished from unique coverage</span>.</p>
          <p>Calibration requires the researcher to specify three qualitative anchors: full membership, full non-membership and the crossover point. These anchors should be grounded in substantive knowledge rather than in the sample distribution alone.</p>
          <p>Truth tables are then constructed by listing all logically possible combinations of conditions and sorting cases into the rows of the table according to their membership scores.</p>
        </div>
        <span class="ss-pin" style="top:352px" data-tip="批注 1">1</span>
        <span class="ss-pin" style="top:198px" data-tip="批注 2">2</span>
        <span class="ss-page__pageno">47</span>
      </article>
      <article class="ss-page ss-page--pdf">
        <div class="ss-pdf-cols">
          <p>The analysis of necessary conditions should precede the analysis of sufficiency. A condition is necessary if, whenever the outcome is present, the condition is also present; with fuzzy sets, Y must be a subset of X.</p>
          <p>Necessity consistency is computed by dividing the sum of the minimum memberships by the sum of memberships in the outcome. A consistency of 0.9 or higher is usually required before a condition is treated as necessary.</p>
          <p>Coverage of necessity, in turn, indicates whether the condition is trivial: a condition that is present in nearly all cases will pass the consistency test regardless of the outcome.</p>
          <p>Table 3.1 summarizes the measures discussed in this chapter and the thresholds most commonly used in published applications.</p>
        </div>
      </article>'''
comments_inner = f'''<div class="ss-panel__body" style="display:grid;gap:10px;align-content:start;padding:12px">
        <p class="ss-prov" style="display:flex;gap:6px;align-items:center"><i data-i="info" class="ss-i--sm"></i>PDF 只能阅览、标记和批注，批注只在 ScienceScope 里可见。</p>
        <div class="ss-desk-list">
          <div class="ss-desk-card" data-active><div class="ss-desk-card__head">{AV_YOU}<span>你</span><time>10-20 15:02</time></div><p class="ss-desk-card__quote">Values below 0.75 indicate substantial inconsistency</p><p class="ss-desk-card__body">我们的阈值 0.85 比这里更严，3.2 节要引这句说明理由。</p>
            <div style="display:grid;gap:4px;padding-left:10px;border-left:2px solid var(--line)"><div class="ss-desk-card__head">{AV_MAIN}<span>主专家</span><time>15:05</time></div><p class="ss-desk-card__body">已在 thesis.docx 3.2 节加了引注，见修改记录。</p></div>
            <div class="ss-desk-card__foot"><button class="ss-btn ss-btn--ghost" type="button">回复</button><button class="ss-btn ss-btn--ghost" type="button"><i data-i="check"></i>解决</button></div></div>
          <div class="ss-desk-card"><div class="ss-desk-card__head">{AV_SEC}<span>秘书</span><time>10-19</time></div><p class="ss-desk-card__quote">raw coverage should be distinguished from unique coverage</p><p class="ss-desk-card__body">第四章组态表要同时报原始覆盖度和唯一覆盖度。</p><div class="ss-desk-card__foot"><button class="ss-btn ss-btn--ghost" type="button">回复</button><button class="ss-btn ss-btn--ghost" type="button"><i data-i="check"></i>解决</button></div></div>
        </div>
      </div>'''
PDF_OUTLINE = [(0, '3 Consistency and Coverage', False), (1, '3.1 Set-theoretic consistency', True), (1, '3.2 Coverage', False), (0, '4 Truth Tables', False), (0, '5 Limited Diversity', False)]
pdf_body = f'''{nav('Ragin_2008.pdf', PDF_OUTLINE)}
    <main class="ss-desk-canvas">{ORB}
      {pdf_page}
    </main>
    {panel([('批注与索引', 2), ('标记', 2), ('对话', 0)], '批注与索引', comments_inner)}'''
card('PageDeskPdf', 'group="编辑台" page height=900 width=1536 subtitle="PDF：只阅览，不能改；可以划选标记、引用到对话和批注，批注只在应用内可见，支持回复和解决"',
     window('Ragin_2008.pdf', 'pdf', pdf_body, [f'{ftype("pdf")}refs/Ragin_2008.pdf', '第 3 / 18 页', '只读', '资料库：Ragin 2008']), '''
整页示例：编辑台（PDF）。现有 pdf.js 阅读器放进编辑台，只读。

## 区域

- 功能区只有「阅览」「视图」：缩放、适应宽度、翻页、标记、批注、索引、引用到对话、查找；右边「只读」标签和「用系统阅读器打开」。
- 左栏：文件和 PDF 自带的目录。
- 中间：页面，标记（引用到对话）和批注的高亮叠在文字上，批注在页边有编号。
- 右侧栏：批注与索引（批注可以回复、解决）、标记（引用到对话的句子）。

## 演示的规则

- 划选后浮动工具条只有标记、批注、索引、引用到对话，没有格式和改写。
- 批注存在应用里，不写进 PDF；栏顶一句话写明。
''')

# ---------- 6. compare ----------
D = lambda t, cur=False: f'<span class="ss-diff-del{" ss-diff-cur" if cur else ""}">{t}</span>'
I = lambda t, cur=False: f'<span class="ss-rev-ins{" ss-diff-cur" if cur else ""}">{t}</span>'
GAP = '<span class="ss-diff-gap" data-tip="这里删了一段"></span>'
old_page = f'''<article class="ss-page">
          <h1>第三章　研究设计</h1>
          <h2>3.1　研究方法</h2>
          <p>本章采用模糊集定性比较分析（fsQCA）识别城市经济韧性的条件组态。与传统回归关注单一变量的净效应不同，组态视角关注多个条件如何共同导致结果。</p>
          <p>经济韧性指数采用熵权法合成，涵盖抵抗力{D("和")}恢复力{D("两个维度")}，各维度下设 4–6 个二级指标。</p>
          <p>{D("本研究的创新之处主要体现在以下三个方面：一是从组态视角解释城市经济韧性，二是构建了多维指标体系，三是结合面板数据检验稳健性。")}</p>
          <h2>3.2　样本与数据</h2>
          <p>研究样本为 {D("102")} 个地级市，时间跨度为 2010–{D("2020")} 年，数据主要来自《中国城市统计年鉴》。</p>
          <p>结果表明{D("该方法显著优于基线", True)}。</p>
          <p class="ss-page__eq"><span class="ss-atom">{EQ}</span><span class="ss-page__eqno">（3-1）</span></p>
          <p>一致性阈值设为 {D("0.8")}，案例频数阈值设为 {D("1")}。</p>
          <p>数字经济水平与产业结构共同构成高韧性的核心条件。</p>
          <span class="ss-page__pageno">— 23 —</span>
        </article>'''
new_page = f'''<article class="ss-page">
          <h1>第三章　研究设计</h1>
          <h2>3.1　研究方法</h2>
          <p>本章采用模糊集定性比较分析（fsQCA）识别城市经济韧性的条件组态{I("，并以面板回归检验结论的稳健性")}。与传统回归关注单一变量的净效应不同，组态视角关注多个条件如何共同导致结果{I("，适合解释“多条路径通向同一结果”的现象")}。</p>
          <p>经济韧性指数采用熵权法合成，涵盖抵抗力{I("、")}恢复力{I("与再组织能力三个维度")}，各维度下设 4–6 个二级指标{I("，权重由各指标的信息熵确定")}。{GAP}</p>
          <h2>3.2　样本与数据</h2>
          <p>研究样本为 {I("98")} 个地级市，时间跨度为 2010–{I("2022")} 年，数据主要来自《中国城市统计年鉴》{I("和各市统计公报，缺失值用线性插值补齐")}。</p>
          <p>结果表明{I("，在样本量为 98 的条件下，组态方法的解释力总体高于基线模型，但对东部城市的区分度有限", True)}。</p>
          <p class="ss-page__eq"><span class="ss-atom">{EQ}</span><span class="ss-page__eqno">（3-1）</span></p>
          <p>一致性阈值设为 {I("0.85")}，案例频数阈值设为 {I("2")}{I("；校准锚点分别取各条件的第 95、50、5 百分位")}。</p>
          <p>数字经济水平与产业结构共同构成高韧性的<b class="ss-diff-fmt" data-tip="格式：加粗">核心条件</b>。</p>
          <span class="ss-page__pageno">— 23 —</span>
        </article>'''
cmp_main = f'''<main class="ss-cmp">
      <div class="ss-cmp__bar">
        <i data-i="git-compare" style="color:var(--ink-2)"></i>
        <button class="ss-select ss-select--sm" type="button"><span class="ss-select__value">v5 · 修改方法部分</span><i data-i="chevron-down"></i></button>
        {icon_btn('arrow-left-right', '交换两侧')}
        <button class="ss-select ss-select--sm" type="button"><span class="ss-select__value">v7 · 主线</span><i data-i="chevron-down"></i></button>
        <span style="flex:1"></span>
        <span class="ss-cmp__counts"><span class="ss-diff-del">删 6 处</span><span class="ss-rev-ins">增 9 处</span><span class="ss-diff-fmt">格式 1 处</span></span>
        {icon_btn('chevron-up', '上一处 Shift F7')}<span class="ss-cmp__pos">5 / 12</span>{icon_btn('chevron-down', '下一处 F7')}
        <button class="ss-btn ss-btn--sm" type="button"><i data-i="x"></i>退出比较</button>
      </div>
      <div class="ss-cmp__pages">
        <div class="ss-cmp__col"><div class="ss-cmp__label"><b>旧 · v5 修改方法部分</b>主专家 10-20 16:12</div>{old_page}</div>
        <div class="ss-cmp__gutter"><button class="ss-cmp__lock" type="button" aria-pressed="true" aria-label="解锁，两页各自滚动" data-tip="解锁，两页各自滚动"><i data-i="lock"></i></button></div>
        <div class="ss-cmp__col"><div class="ss-cmp__label"><b>新 · v7 主线</b>你 10-22 14:06 存版本</div>{new_page}</div>
      </div>
    </main>'''
cmp_body = f'''{nav('thesis.docx', DOCX_OUTLINE)}
    {cmp_main}'''
card('PageDeskCompare', 'group="编辑台" page height=900 width=1536 subtitle="比较：两版像 Word 并排查看一样左右两页显示，左旧右新；旧版删掉的标红，新版加的内容和格式标淡黄；差异在存版本时后台算好"',
     window('thesis.docx', 'docx', cmp_body, DOCX_STATUS, dirty=('thesis.docx',), compare=True), '''
整页示例：编辑台的版本比较。功能区「比较」、版本树里右键「和……比较」都进这里。

## 区域

- 比较栏：左右两个版本选择、交换两侧、三种改动的计数（删、增、格式，0 处的不显示）、上一处下一处（F7）、退出比较。
- 两页：像 Word 的并排查看，左边旧版、右边新版，各自按原来的版式排，页头写版本、作者和时间。两页各自能滚动。
- 两页中间的缝里有一把锁：锁上（默认）时两页同步滚动，成对的段落顶对顶、底对底，只有一边有的段落经过时另一边停着等；打开锁两页各自滚动，再锁上时右页跟到左页的位置。

## 演示的规则

- 旧版里被删掉的字标红（diff-del 底、diff-del-ink 字），不加删除线；新版里新加的字和改过格式的字标淡黄（diff-ins），格式改动另有点线和提示（“格式：加粗”）。
- 新版里整段删掉的位置留一根红色细竖线，悬停提示“这里删了一段”。
- 上一处下一处时，当前这处两边都有强调色描边。替换掉的一个词是一处（左删右增合在一起），连着几段只有一边有也算一处。
- 差异在存版本时（离开编辑台、存为版本、外部修改导入）后台算好，存在这个版本上；任意两版比较时现算一次再缓存。正文编辑时不显示修订标记。
''')

# ---------- 7. entry points ----------
entry = f'''<div class="ds" style="grid-template-columns:240px 1fr;align-items:start;gap:20px 24px">
  <div class="ds-col">
    <div class="ds-box" style="background:var(--side);padding:8px;display:grid;gap:2px">
      <button class="ss-nav-item" type="button"><i data-i="square-pen"></i><span class="ss-nav-item__label">新对话</span></button>
      <button class="ss-nav-item" type="button"><i data-i="book-open"></i><span class="ss-nav-item__label">知识库</span></button>
      <button class="ss-nav-item" type="button"><i data-i="box"></i><span class="ss-nav-item__label">工作站</span></button>
      <button class="ss-nav-item" type="button" data-tip="在独立窗口打开编辑台"><i data-i="file-pen"></i><span class="ss-nav-item__label">编辑台</span><span class="ss-nav-item__end"><i data-i="app-window" class="ss-i--sm"></i></span></button>
      <button class="ss-search-trigger" type="button"><i data-i="search"></i><span class="ss-search-trigger__label">搜索与命令</span><span class="ss-kbd">Ctrl K</span></button>
    </div>
    <span class="ds-label">① 主窗口左栏：「编辑台」在工作站下面；小窗图标表示另开窗口，窗口已开时切过去</span>
  </div>
  <div class="ds-col">
    <div class="ds-box" style="overflow:hidden">
      <div class="ss-header">
        <div class="ss-header__title"><span>工作站</span></div>
        <div class="ss-header__actions">
          <button class="ss-btn ss-btn--ghost" type="button"><i data-i="git-fork"></i>版本树</button>
          <button class="ss-btn" type="button"><i data-i="file-pen"></i>在编辑台打开</button>
        </div>
      </div>
      <div style="height:24px"></div>
    </div>
    <span class="ds-label">② 工作站页头：「版本树」在右侧栏打开和编辑台同一个版本树组件；左下角原来的文件版本管理撤掉，导图向左拉伸</span>
    <div class="ss-callout" style="margin-top:8px"><i data-i="file-pen"></i><div class="ss-callout__body"><span class="ss-callout__title">初稿已经成形，要进入编辑台继续改吗？</span>thesis.docx 第三章</div><div class="ss-callout__actions"><button class="ss-btn ss-btn--sm" type="button">开新分支进入</button><button class="ss-btn ss-btn--sm ss-btn--primary" type="button">接续当前对话</button></div></div>
    <span class="ds-label">③ 对话底部的进入横条：主专家调用 desk_suggest 时出现</span>
  </div>
  <div class="ds-col" style="grid-column:1 / -1;grid-template-columns:1fr 1fr;gap:8px 24px">
    <div class="ds-box" style="padding:12px;display:grid;gap:8px;justify-items:end">
      <div class="ss-msg__bubble" style="max-width:100%">3.2 节这两句帮我核对一下数据来源。</div>
      <div class="ss-msg__files">
        <span class="ss-file-chip" data-tip="在编辑台打开并定位到这句">{ftype('docx')}<button type="button" class="ss-file-chip__open">thesis.docx · 3.2 节</button><i data-i="app-window" class="ss-i--sm" style="color:var(--muted)"></i></span>
        <span class="ss-file-chip"><i data-i="sticky-note"></i><button type="button" class="ss-file-chip__open">标记 2 条</button></span>
      </div>
    </div>
    <div class="ss-page" style="width:auto;margin:0;padding:14px 20px;font-size:14px">
      <p style="margin:0">样本量为 98。<span class="ss-flash">一致性阈值设为 0.85，案例频数阈值设为 2</span>；校准锚点取第 95、50、5 百分位。</p>
    </div>
    <span class="ds-label">④ 对话里来自文稿的标记写明文件和位置，点一下把编辑台窗口调到前面……</span>
    <span class="ds-label">……打开那份文稿、滚到那句，短暂高亮</span>
  </div>
</div>'''
card('DeskEntry', 'group="编辑台" height=390 subtitle="入口：左栏工作站下面、工作站页头的版本树、对话底部的进入横条、对话里的文稿标记跳到编辑台"', entry, '''
编辑台的入口和跳转。

- 主窗口左栏：「编辑台」放在「工作站」下面，右边小窗图标表示它在独立窗口打开；窗口已开时点它切过去。
- 工作站页头：「版本树」在右侧栏打开和编辑台同一个版本树组件；「在编辑台打开」。工作站左下角原来的文件版本管理撤掉，导图向左拉伸。
- 对话底部横条：主专家调用 desk_suggest 时出现，「接续当前对话」或「开新分支进入」。
- 对话里的文稿标记：写明文件和位置（“thesis.docx · 3.2 节”），点一下把编辑台窗口调到前面，打开文稿、滚到那句、高亮 1.5 秒。
''')

# ---------- 8. floating toolbars and menus ----------
def ftb(rows, chips=True, width=None):
    w = f' style="position:relative;{f"width:{width}px" if width else ""}"'
    ch = '<div class="ss-ftb__chips"><button type="button">润色</button><button type="button">精简</button><button type="button">更正式</button><button type="button">译成英文</button><button type="button">核对数据</button></div>' if chips else ''
    return f'<div class="ss-ftb" role="toolbar"{w}>' + ''.join(f'<div class="ss-ftb__row">{r}</div>' for r in rows) + ch + '</div>'


SEP2 = '<span class="ss-ribbon__sep" style="margin:0 2px"></span>'
row_fmt = ('<button class="ss-ftb__label" type="button">正文<i data-i="chevron-down"></i></button>' + SEP2
           + icon_btn('bold', '加粗 Ctrl B') + icon_btn('italic', '斜体 Ctrl I') + icon_btn('underline', '下划线 Ctrl U') + icon_btn('superscript', '上标') + icon_btn('subscript', '下标')
           + SEP2 + icon_btn('message-square-plus', '添加批注') + icon_btn('link-2', '添加索引')
           + '<button class="ss-ftb__label" type="button"><i data-i="text-quote"></i>引用到对话</button>' + icon_btn('ellipsis', '更多'))
row_ask = '<div class="ss-ftb__ask"><i data-i="wand-sparkles"></i><span>告诉主专家怎么改，例如「语气缓和些」</span><span class="ss-kbd">Enter</span></div>'
row_tex = ('<button class="ss-ftb__label" type="button">\\textbf</button><button class="ss-ftb__label" type="button">\\emph</button>' + icon_btn('radical', '转成公式 $…$')
           + SEP2 + icon_btn('message-square-plus', '添加批注') + icon_btn('link-2', '添加索引')
           + '<button class="ss-ftb__label" type="button"><i data-i="text-quote"></i>引用到对话</button>')
row_pdf = ('<button class="ss-ftb__label" type="button"><i data-i="highlighter"></i>标记</button>'
           + '<button class="ss-ftb__label" type="button"><i data-i="message-square-plus"></i>批注</button>'
           + '<button class="ss-ftb__label" type="button"><i data-i="link-2"></i>索引</button>'
           + '<button class="ss-ftb__label" type="button"><i data-i="text-quote"></i>引用到对话</button>' + icon_btn('copy', '复制'))
row_busy = ('<div class="ss-ftb__ask" style="color:var(--ink-2)"><span class="ss-spin"></span><span>主专家正在改写这段……</span>'
            + '<button class="ss-btn ss-btn--ghost ss-btn--sm" type="button">停止</button></div>')
parts = f'''<div class="ds" style="grid-template-columns:auto 1fr;align-items:start;gap:16px 24px">
  <div class="ds-col">
    {ftb([row_fmt, row_ask])}
    <span class="ds-label">docx、md：格式一行，改写一行，下面是常用指令；鼠标离开后淡出</span>
    {ftb([row_tex, row_ask], chips=False, width=452)}
    <span class="ds-label">tex 源码：格式按钮写成命令；改写同上</span>
    {ftb([row_pdf], chips=False, width=360)}
    <span class="ds-label">PDF：没有格式和改写</span>
    {ftb([row_busy], chips=False, width=360)}
    <span class="ds-label">发出改写后：同一位置显示进度，可以停止；改完直接写进正文，弹提示可撤销</span>
  </div>
  <div class="ds-col">
    <div class="ss-menu" data-static role="menu" aria-label="版本 v5" style="min-width:220px">
      <div class="ss-menu__label">v5 · 修改方法部分</div>
      <button class="ss-menu__item" type="button" role="menuitem"><i data-i="eye"></i>打开这一版（只读）</button>
      <button class="ss-menu__item" type="button" role="menuitem"><i data-i="pencil"></i>从这一版开始编辑</button>
      <button class="ss-menu__item" type="button" role="menuitem"><i data-i="git-compare"></i>和正在编辑的 v7 比较</button>
      <button class="ss-menu__item" type="button" role="menuitem"><i data-i="file-diff"></i>和上一版比较</button>
      <div class="ss-menu__sep"></div>
      <button class="ss-menu__item" type="button" role="menuitem"><i data-i="tag"></i>改名和备注…<span class="ss-menu__end">F2</span></button>
      <button class="ss-menu__item" type="button" role="menuitem"><i data-i="star"></i>层级：草稿<span class="ss-menu__end"><i data-i="chevron-right" class="ss-i--sm"></i></span></button>
      <button class="ss-menu__item" type="button" role="menuitem"><i data-i="download"></i>另存为文件…</button>
      <button class="ss-menu__item" type="button" role="menuitem"><i data-i="rotate-cw"></i>用这一版覆盖项目文件…</button>
      <div class="ss-menu__sep"></div>
      <button class="ss-menu__item" type="button" role="menuitem" aria-disabled="true"><i data-i="trash-2"></i>删除（有后续版本，不能删）</button>
    </div>
    <span class="ds-label">版本树里右键一个版本</span>
  </div>
</div>'''
card('DeskMenus', 'group="编辑台" height=410 subtitle="浮动工具条（docx/md、tex、PDF、改写中）和版本树的右键菜单"', parts, '''
编辑台的浮动工具条和版本树右键菜单。正文的右键菜单见 PageDeskMarkdown。

- 浮动工具条参照 Office 的浮动工具栏：划选后出现在选区上方，鼠标离开后淡出，不挡正文；Esc 关掉。
- docx 和 md：第一行段落样式、加粗、斜体、下划线、上下标、批注、索引、引用到对话、更多；第二行改写输入框（Enter 发出），下面五个常用指令。
- tex 源码：格式按钮写成命令（\\\\textbf、\\\\emph、转成公式）。渲染栏里划选时和 docx 一样。
- PDF：只有标记、批注、索引、引用到对话、复制。
- 改写发出后，工具条变成进度行，可以停止；改完直接写进正文（不显示修订标记），弹提示「看改了什么 / 撤销」。
- 版本右键：打开（只读）、从这一版开始编辑、比较、改名和备注、层级、另存为文件、用这一版覆盖项目文件（先确认）；有后续版本时不能删，菜单写明原因。
''')


# ---------- 9. index picker (U5) ----------
def pick_row(icon, title, checked=False, sub=''):
    on = ' checked' if checked else ''
    two = ' ss-list-row--2' if sub else ''
    subline = f'<span class="ss-list-row__sub">{sub}</span>' if sub else ''
    return (f'<label class="ss-list-row ss-desk-picker__row{two}" role="option" aria-selected="{"true" if checked else "false"}">'
            f'<span class="ss-check"><input type="checkbox"{on} /></span><i data-i="{icon}" class="ss-list-row__icon"></i>'
            f'<span class="ss-list-row__main"><span class="ss-list-row__title">{title}</span>{subline}</span></label>')


def picker(tab, rows, crumbs='', chips=(), note='', title='添加索引'):
    seg = ''.join(f'<button type="button" aria-pressed="{"true" if name == tab else "false"}">{name}</button>' for name in ('项目文件', '资料库', '对话消息'))
    holder = '消息里的关键词' if tab == '对话消息' else '按名称筛选'
    chip_html = ''.join(f'<span class="ss-chip"><i data-i="{icon}" class="ss-i--sm"></i><span class="ss-truncate">{label}</span><button type="button" aria-label="移除 {label}"><i data-i="x" class="ss-i--sm"></i></button></span>' for icon, label in chips)
    chips_block = f'<div class="ss-chips ss-chips--inline" aria-label="已选来源">{chip_html}</div>' if chips else ''
    hint = '' if chips else '<span class="ss-muted ss-desk-picker__hint">至少选一项来源</span>'
    return f'''<div class="ss-dialog" data-static role="dialog" aria-label="{title}" style="width:420px">
      <div class="ss-dialog__head"><h2 class="ss-dialog__title">{title}</h2><button class="ss-icon-btn" type="button" aria-label="关闭" data-tip="关闭" data-kbd="Esc"><i data-i="x"></i></button></div>
      <div class="ss-dialog__body"><div class="ss-desk-picker">
        <p class="ss-desk-card__quote">98 个地级市</p>
        <div class="ss-desk-picker__bar"><div class="ss-seg ss-seg--sm" role="group" aria-label="来源类型">{seg}</div><span class="ss-input ss-input--sm ss-desk-picker__search"><i data-i="search"></i><input type="search" placeholder="{holder}" aria-label="查找来源" /></span></div>
        {crumbs}
        <div class="ss-list ss-desk-picker__list" role="listbox" style="height:200px">{''.join(rows)}</div>
        {chips_block}
        <label class="ss-field"><span class="ss-field__label">说明</span><textarea class="ss-textarea" rows="2" placeholder="这段文字是什么、怎么得来的，例如「去重后进入分析的企业数」">{note}</textarea></label>
      </div></div>
      <div class="ss-dialog__foot">{hint}<button class="ss-btn" type="button">取消</button><button class="ss-btn ss-btn--primary" type="button"{'' if chips else ' disabled'}>添加索引</button></div>
    </div>'''


CRUMBS = '<nav class="ss-desk-picker__crumbs" aria-label="文件夹"><button type="button" class="ss-linkbtn">项目文件夹</button><span aria-hidden="true">/</span><button type="button" class="ss-linkbtn">data</button></nav>'
files_rows = [
    pick_row('file', 'city_panel.csv', checked=True),
    pick_row('file', 'city_panel_raw.csv'),
    pick_row('file', 'codebook.xlsx'),
]
scripts_row = pick_row('file-code', 'sample.py', checked=True)
library_rows = [
    pick_row('book-open', 'Wang 2021 城市经济韧性的测度与时空演变', sub='资料 · PDF'),
    pick_row('book-marked', '熵权法', checked=True, sub='条目'),
    pick_row('book-open', 'Ragin 2008 Redesigning Social Inquiry', sub='资料 · PDF'),
]
message_rows = [
    pick_row('message-square', '主专家：去重后剩 98 个城市，删掉了 3 个数据缺失超过一半的', checked=True, sub='样本口径讨论 · 10-19'),
    pick_row('message-square', '你：样本要不要加上直辖市？', sub='样本口径讨论 · 10-19'),
]
picker_parts = f'''<div class="ds" style="grid-template-columns:auto auto;justify-content:start;align-items:start;gap:16px 24px">
  <div class="ds-col">
    {picker('项目文件', files_rows + [scripts_row], CRUMBS, chips=(('file', 'data/city_panel.csv'), ('file-code', 'scripts/sample.py')), note='去重后进入分析的城市数')}
    <span class="ds-label">项目文件：按文件夹浏览，脚本单独标出；可以多选，选中的在下面列成标签</span>
  </div>
  <div class="ds-col">
    {picker('资料库', library_rows, chips=(('book-marked', '熵权法'),))}
    <span class="ds-label">资料库：资料和条目</span>
    {picker('对话消息', message_rows)}
    <span class="ds-label">对话消息：输入关键词查找这个项目对话里的消息；一项都没选时「添加索引」停用</span>
  </div>
</div>'''
card('DeskIndexPicker', 'group="编辑台" height=1090 subtitle="添加索引：把选中的文字连到项目文件、资料库或对话消息，写一句说明"', picker_parts, '''
编辑台的「添加索引」对话框（U5）。划选文字后从功能区「索引」、浮动工具条或右键「添加索引…」打开；卡片上的「编辑」打开同一个框，标题是「修改索引」。

- 顶部一行是选中的原文。
- 三类来源用分段按钮切换：项目文件（按文件夹浏览，面包屑回到上层，脚本用代码图标）、资料库（资料和条目）、对话消息（关键词查找这个项目对话里的消息）。右边的框按名称筛选，或在消息里查关键词。
- 可以多选，跨类也行；选中的列成标签，点 × 去掉。
- 说明写这段文字是什么、怎么得来的。
- 至少选一项来源才能添加，左下角写明原因。添加后侧栏打开「批注与索引」，新卡片亮起。
- 只用已有组件：对话框、分段按钮、输入框、列表行、复选框、标签、文本框。
''')

# ---------- U8: the bound conversation in the side panel ----------
CHAT_HEAD = ('<div class="ss-toolbar ss-desk-chat__bar">'
             '<i data-i="message-square" class="ss-i--sm" style="color:var(--ink-2)"></i>'
             '<span class="ss-desk-chat__title ss-truncate">第三章：组态分析</span><span class="ss-tag">分支</span>'
             '<span style="flex:1"></span>'
             + icon_btn('app-window', '在主窗口打开这段对话') + icon_btn('ellipsis', '更多', ' aria-haspopup="menu"') + '</div>')
CHAT_THREAD = f'''<div class="ss-content ss-desk-chat__thread"><div class="ss-thread ss-thread--panel">
        <p class="ss-desk-chat__origin"><i data-i="git-branch" class="ss-i--sm"></i>10-21 从「研究设计讨论」分出，原对话停在初稿</p>
        <div class="ss-msg ss-msg--user">
          <div class="ss-msg__bubble">3.2 节这两句帮我核对一下数据来源。</div>
          <div class="ss-msg__files"><span class="ss-file-chip" data-tip="在编辑台里定位到这句">{ftype('docx')}<button type="button" class="ss-file-chip__open">thesis.docx · 3.2 节</button></span></div>
        </div>
        <div class="ss-msg">
          <div class="ss-msg__head">{AV_MAIN}<span class="ss-msg__name">主专家</span><span class="ss-msg__role">deepseek-v4-pro</span></div>
          <div class="ss-act"><button class="ss-act__summary" type="button" aria-expanded="false">用时 21 秒 · 读了 2 个文件，改写 1 句<i data-i="chevron-down"></i></button></div>
          <div class="ss-msg__body"><p>98 个城市来自 data/city_panel.csv 去重后的结果，和 scripts/sample.py 一致。第二句“缺失值用线性插值补齐”在脚本里实际是前后两年均值，我改成了“用相邻年份均值补齐”，并加了一条索引。</p></div>
          <div class="ss-msg__files"><span class="ss-file-chip">{ftype('docx')}<button type="button" class="ss-file-chip__open">thesis.docx · 3.2 节 · 改写 1 句</button></span><button class="ss-btn ss-btn--ghost ss-btn--sm" type="button">看改了什么</button></div>
        </div>
        <div class="ss-msg">
          <div class="ss-msg__head"><span class="ss-avatar">方</span><span class="ss-msg__name">方法专家</span><span class="ss-msg__role">deepseek-v4-flash</span></div>
          <div class="ss-msg__body"><p>补充一点：0.85 的一致性阈值建议在脚注里引 Ragin 2008 第 3 章，我在原文上留了一条批注。</p></div>
        </div>
      </div></div>'''


def chat_composer(running=False):
    send = ('<button class="ss-send" type="button" aria-label="停止" data-tip="停止" data-kbd="Esc" data-state="running"><span class="ss-send__stop"></span></button>'
            if running else '<button class="ss-send" type="button" aria-label="发送" data-tip="发送" data-kbd="Enter"><i data-i="arrow-up"></i></button>')
    quote = '' if running else ('<div class="ss-composer__files"><span class="ss-file-chip"><i data-i="text-quote"></i>'
                                '<span class="ss-truncate">“一致性阈值设为 0.85，案例频数阈值设为 2”</span>'
                                '<button type="button" aria-label="移除"><i data-i="x"></i></button></span></div>')
    text = '' if running else '这里的阈值依据够不够？'
    return f'''<div class="ss-composer-wrap ss-desk-chat__composer">
        <div class="ss-composer">
          {quote}
          <textarea class="ss-composer__input" rows="1" aria-label="和专家讨论这份文稿" placeholder="和专家讨论这份文稿，@ 点名">{text}</textarea>
          <div class="ss-composer__bar">{icon_btn('plus', '添加文件或资料')}<button class="ss-btn ss-btn--ghost ss-btn--sm" type="button" aria-haspopup="menu" data-tip="执行方式"><i data-i="shield-check"></i>请求批准<i data-i="chevron-down"></i></button><span class="ss-composer__spacer"></span>{send}</div>
        </div>
      </div>'''


chat_inner = f'''<section class="ss-desk-chat">{CHAT_HEAD}
      {CHAT_THREAD}
      {chat_composer()}</section>'''
chat_body = f'''{nav('thesis.docx', DOCX_OUTLINE)}
    <main class="ss-desk-canvas">{ORB}
      {docx_page(toolbar=False, flash=True)}
    </main>
    {panel(PANEL_TABS, '对话', chat_inner, width=376)}'''
card('PageDeskChat', 'group="编辑台" page height=900 width=1536 subtitle="对话：右侧栏「对话」是编辑台绑定的那段对话，可以接着和专家讨论这份文稿；引用到对话放进这里的输入框"',
     window('thesis.docx', 'docx', chat_body, DOCX_STATUS, dirty=('thesis.docx',)), '''
整页示例：编辑台右侧栏的「对话」（U8）。编辑台绑定的那段对话（从对话进入时接续或分出的那段，或左栏直接进入时项目最近的对话）在这里显示，和主窗口里是同一段对话。

## 区域

- 头部一行：对话名；分出来的对话带「分支」标签；「在主窗口打开这段对话」；「更多」菜单（见 DeskChatStates）。
- 消息：和主窗口一样的消息样式，侧栏窄，只是间距收紧。分支的第一行写明从哪段对话分出。
- 输入框：和主窗口同一个输入框，去掉模型选择（跟随对话设置）；「引用到对话」把选中的原文作为引用标签放进这里，侧栏自动切到「对话」。

## 演示的规则

- 消息里的文稿标记（thesis.docx · 3.2 节）点一下，正文滚到那句并闪一下高亮；专家改了正文的消息带「看改了什么」。
- 主窗口和编辑台同时开着这段对话时，两边的消息实时同步；在哪边发都行。
- 底栏右边的对话名就是绑定的对话，点它切到这个标签。
''')

unbound = f'''<aside class="ss-panel" style="width:330px;height:420px;position:relative">
      <div class="ss-panel__head" style="padding-left:8px"><nav class="ss-tabs" role="tablist" aria-label="侧栏" style="align-self:stretch"><button class="ss-tab" role="tab" type="button" aria-selected="false">批注与索引</button><button class="ss-tab" role="tab" type="button" aria-selected="true">对话</button></nav><span style="flex:1"></span>{icon_btn('x', '关闭侧栏')}</div>
      <div class="ss-panel__body">
        <div class="ss-empty">
          <div class="ss-empty__icon"><i data-i="message-square-plus"></i></div>
          <div class="ss-empty__title">还没有绑定对话</div>
          <div class="ss-empty__text">绑定后可以在这里和专家讨论这份文稿，秘书也跟着这段对话。</div>
          <div class="ss-empty__actions"><button class="ss-btn ss-btn--primary ss-btn--sm" type="button">接续最近的对话</button><button class="ss-btn ss-btn--sm" type="button">选一个对话…</button></div>
        </div>
      </div>
    </aside>'''
more_menu = '''<div class="ss-menu" data-static role="menu" aria-label="对话" style="min-width:220px">
      <button class="ss-menu__item" type="button" role="menuitem"><i data-i="app-window"></i>在主窗口打开</button>
      <button class="ss-menu__item" type="button" role="menuitem"><i data-i="git-branch"></i>从最新消息开新分支</button>
      <button class="ss-menu__item" type="button" role="menuitem"><i data-i="arrow-left-right"></i>换成别的对话…</button>
    </div>'''
secretary = f'''<aside class="ss-panel" style="width:330px;height:420px">
      <div class="ss-panel__head">{icon_btn('arrow-left', '回到对话')}<i data-i="clipboard-list" style="margin:0 6px;color:var(--ink-2)"></i><span class="ss-panel__title">任务秘书 · 第三章：组态分析</span>{icon_btn('x', '关闭侧栏')}</div>
      <div class="ss-content ss-desk-chat__thread"><div class="ss-thread ss-thread--panel">
        <div class="ss-msg ss-msg--user"><div class="ss-msg__bubble">把今天在编辑台里定下的改动记进纪要。</div></div>
        <div class="ss-msg"><div class="ss-msg__head">{AV_SEC}<span class="ss-msg__name">任务秘书</span></div><div class="ss-msg__body"><p>已记入纪要第 4 版：3.2 节缺失值处理改为相邻年份均值；阈值依据待补 Ragin 2008。</p></div></div>
      </div></div>
      <div class="ss-composer-wrap ss-desk-chat__composer"><div class="ss-composer"><textarea class="ss-composer__input" rows="1" placeholder="问秘书，或让它整理纪要…"></textarea><div class="ss-composer__bar"><span class="ss-composer__spacer"></span><button class="ss-send" type="button" aria-label="发送" disabled><i data-i="arrow-up"></i></button></div></div></div>
    </aside>'''
orbs = f'''<div style="display:flex;gap:16px;align-items:center">
      <div class="ss-desk-canvas" style="position:relative;width:120px;height:72px;overflow:hidden;border-radius:var(--r-md)">{ORB}</div>
      <div class="ss-desk-canvas" style="position:relative;width:120px;height:72px;overflow:hidden;border-radius:var(--r-md)"><button class="ss-desk-orb" type="button" aria-label="秘书" aria-disabled="true" data-tip="绑定对话后才有秘书"><i data-i="clipboard-list"></i></button></div>
    </div>'''
states = f'''<div class="ds" style="grid-template-columns:repeat(2,auto);justify-content:start;align-items:start;gap:16px 24px">
  <div class="ds-col">{unbound}<span class="ds-label">① 没有绑定对话：接续项目最近的对话，或选一个</span></div>
  <div class="ds-col">{secretary}<span class="ds-label">② 点秘书按钮：侧栏换成这段对话的任务秘书（和主窗口同一个），左上角回到对话</span></div>
  <div class="ds-col">{more_menu}<span class="ds-label">③ 头部「更多」：在主窗口打开、从最新消息开新分支、换成别的对话</span></div>
  <div class="ds-col">{orbs}<span class="ds-label">④ 正文右上角的秘书按钮；没绑定对话时停用</span></div>
</div>'''
card('DeskChatStates', 'group="编辑台" height=640 subtitle="对话标签的其他状态：没有绑定对话、更多菜单、秘书按钮打开任务秘书"', states, '''
编辑台「对话」标签的其他状态（U8）。整页见 PageDeskChat。

- 没有绑定对话：空状态，「接续最近的对话」（跳过归档、临时、附属和全局助手的对话；没有就新建「编辑台」对话），「选一个对话…」列出这个项目的对话。
- 「更多」：在主窗口打开；从最新消息开新分支（原对话不变，编辑台改绑新分支）；换成别的对话。
- 秘书按钮：在正文右上角，点开后侧栏换成绑定对话的任务秘书，和主窗口的秘书面板是同一段；头部左边箭头回到对话。没有绑定对话时按钮停用，悬停说明原因。
''')
