# Builds the main window's shared shell and the page mocks that use it.
# Run from the repo root: python3 -I docs/design/system/build/shell/gen.py .
#
# One title bar (with 窗口置顶) and one left bar (with 编辑台 and the 工作站
# 简报 button) for every main-window page: the existing page mocks get them
# swapped in, and the pages that had no mock yet are generated here. The
# editing desk is its own window; its cards come from build/desk/gen.py.
# Run it after build/assemble.py, which writes PageInbox and PageSettings from parts.
import re, sys, pathlib
ROOT = pathlib.Path(sys.argv[1])
COMP = ROOT / 'docs/design/system/project/components'
PROJECT = '城市韧性研究'


def card(name, meta, body, readme):
    html = (f'<!-- @dsCard {meta} -->\n<!doctype html>\n<html lang="zh-CN">\n<head><meta charset="utf-8"><title>{name}</title></head>\n<body>\n'
            + body.strip('\n') + '\n<script>window.SS && SS.mount(document.body)</script>\n</body>\n</html>\n')
    d = COMP / name
    d.mkdir(parents=True, exist_ok=True)
    (d / 'preview.html').write_text(html)
    (d / 'README.md').write_text(readme.strip() + '\n')
    print(name, len(html.encode()), 'bytes')


def icon_btn(icon, tip, extra='', sm=False):
    cls = 'ss-icon-btn ss-icon-btn--sm' if sm else 'ss-icon-btn'
    return f'<button class="{cls}" type="button" aria-label="{tip}" data-tip="{tip}"{extra}><i data-i="{icon}"></i></button>'


def item(icon, text, end='', extra=''):
    end = f'<span class="ss-menu__end">{end}</span>' if end else ''
    ic = f'<i data-i="{icon}"></i>' if icon else ''
    return f'  <button class="ss-menu__item" type="button"{extra}>{ic}{text}{end}</button>\n'


def check(text, on, icon=''):
    ic = f'<i data-i="{icon}"></i>' if icon else ''
    return (f'  <button class="ss-menu__item" role="menuitemcheckbox" aria-checked="{"true" if on else "false"}" type="button">'
            f'{ic}{text}<i data-i="check" class="ss-menu__check"></i></button>\n')


SEP = '  <div class="ss-menu__sep"></div>\n'


def menu(id_, items):
    return f'<div class="ss-menu" id="{id_}" hidden>\n{items}</div>\n'


# ---------- title bar ----------
def titlebar(title=PROJECT, pinned=False):
    pressed = 'true' if pinned else 'false'
    tip = '取消窗口置顶' if pinned else '窗口置顶'
    menus = ''.join(f'\n    <button class="ss-titlebar__menu" type="button" aria-haspopup="menu" data-menu="#m-tb-{k}">{v}</button>'
                    for k, v in (('file', '文件'), ('edit', '编辑'), ('view', '视图'), ('help', '帮助')))
    title_html = f'\n    <span class="ss-titlebar__title">{title}</span>' if title else ''
    return f'''<header class="ss-titlebar">
    <span class="ss-titlebar__brand"><i data-logo></i>ScienceScope</span>{menus}
    <span class="ss-titlebar__spacer"></span>{title_html}
    <button class="ss-winctl ss-winctl--pin" type="button" aria-label="窗口置顶" aria-pressed="{pressed}" data-tip="{tip}"><i data-i="pin"></i></button>
    <button class="ss-winctl" type="button" aria-label="最小化"><i data-i="minus"></i></button>
    <button class="ss-winctl" type="button" aria-label="最大化"><i data-i="square"></i></button>
    <button class="ss-winctl ss-winctl--close" type="button" aria-label="关闭"><i data-i="x"></i></button>
  </header>'''


def titlebar_menus(pinned=False):
    return (menu('m-tb-file', item('square-pen', '新对话', 'Ctrl N') + item('message-square', '独立快速对话', 'Ctrl Alt N')
                 + item('folder-plus', '新建项目') + SEP + item('download', '导出当前对话（Markdown）') + item('package', '导出项目快照'))
            + menu('m-tb-edit', item('search', '查找当前对话', 'Ctrl F') + item('search', '搜索与命令', 'Ctrl K') + SEP + item('copy', '复制选中文字', 'Ctrl C'))
            + menu('m-tb-view', item('layout-list', '全部对话', 'Ctrl Shift K') + item('box', '工作站') + item('file-pen', '编辑台')
                   + SEP + item('sparkle', '全局助手') + check('窗口置顶', pinned, 'pin')
                   + SEP + check('显示滚动条', False) + check('简洁执行记录', True) + SEP + check('中文', True) + check('English', False))
            + menu('m-tb-help', item('keyboard', '键盘快捷键') + item('info', '关于 ScienceScope')))


# ---------- left bar ----------
def row(label, end, menu_id='#m-side-chat', cls='ss-tree-row--child', selected=False, extra=''):
    sel = ' aria-selected="true"' if selected else ''
    return (f'<div class="ss-tree-row {cls}"{sel} data-ctx="{menu_id}"{extra}>'
            f'<span class="ss-tree-row__label">{label}</span><span class="ss-tree-row__end">{end}</span>'
            f'<span class="ss-tree-row__actions">{icon_btn("ellipsis", "更多", f" data-menu=\"{menu_id}\"", sm=True)}</span></div>')


def state(kind, icon, text, tip):
    mod = f' ss-tree-row__state--{kind}' if kind else ''
    return f'<span class="ss-tree-row__state{mod}" data-tip="{tip}" data-tip-place="right"><i data-i="{icon}" class="ss-i--sm"></i>{text}</span>'


SPIN = '<span class="ss-spin" aria-label="运行中"></span>'


def sidebar(current=None, chat=None, key=None):
    """current: new | knowledge | workbench | all | None; chat: the open chat's title."""
    cur = lambda name: ' aria-current="page"' if current == name else ''
    brief_open = 'false'
    chats = [('文献综述框架讨论', SPIN), ('指标体系初稿', state('warn', 'shield-question-mark', '待批准', '等你批准')),
             ('面板数据清洗', state('danger', 'circle-alert', '失败', '上次回答失败，点开查看')),
             ('问卷题项对照', '3 天'), ('访谈提纲', '1 周')]
    project_rows = ''.join(row(t, e, selected=(t == chat)) for t, e in chats)
    project_actions = (icon_btn('square-pen', '在项目中新对话', sm=True)
                       + icon_btn('ellipsis', '更多', ' data-menu="#m-side-project"', sm=True))
    split_key = f' data-key="{key}"' if key else ''
    return f'''<aside class="ss-sidebar">
      <div class="ss-sidebar__top">
        <button class="ss-nav-item" type="button"{cur("new")} data-tip="新对话" data-kbd="Ctrl N" data-tip-place="right"><i data-i="square-pen"></i><span class="ss-nav-item__label">新对话</span></button>
        <button class="ss-nav-item" type="button"{cur("knowledge")} data-tip="收件箱里有 8 条记忆等你确认" data-tip-place="right"><i data-i="book-open"></i><span class="ss-nav-item__label">知识库</span><span class="ss-nav-item__end">8</span></button>
        <div class="ss-nav-row"><button class="ss-nav-item" type="button"{cur("workbench")}><i data-i="box"></i><span class="ss-nav-item__label">工作站</span></button><button class="ss-icon-btn" type="button" aria-label="工作站简报" data-tip="工作站简报：最近历史版本、日志" aria-expanded="{brief_open}"><i data-i="clipboard-list"></i></button></div>
        <button class="ss-nav-item" type="button" data-tip="在独立窗口打开编辑台" data-tip-place="right"><i data-i="file-pen"></i><span class="ss-nav-item__label">编辑台</span><span class="ss-nav-item__end"><i data-i="app-window" class="ss-i--sm"></i></span></button>
        <button class="ss-search-trigger" type="button"><i data-i="search"></i><span class="ss-search-trigger__label">搜索与命令</span><span class="ss-kbd">Ctrl K</span></button>
      </div>
      <div class="ss-sidebar__scroll">
        <div class="ss-side-section" style="margin-top:4px">
          <div class="ss-side-section__head"><span>置顶</span></div>
          <div class="ss-tree">{row("开题报告修改意见", "今天", cls="ss-tree-row--leaf", selected=(chat == "开题报告修改意见"))}</div>
        </div>
        <div class="ss-side-section">
          <div class="ss-side-section__head"><span>项目</span>{icon_btn("plus", "新建项目", sm=True)}</div>
          <div class="ss-tree">
            <div class="ss-tree-row" aria-expanded="true" data-drop-target data-ctx="#m-side-project"><button class="ss-tree-row__twisty" type="button" aria-label="收起"><i data-i="chevron-down"></i></button><i data-i="folder-open"></i><span class="ss-tree-row__label">{PROJECT}</span><span class="ss-tree-row__end"></span><span class="ss-tree-row__actions">{project_actions}</span></div>
            <div class="ss-tree">{project_rows}<button class="ss-tree-more" type="button">还有 4 个</button></div>
            <div class="ss-tree-row" aria-expanded="false" data-drop-target data-ctx="#m-side-project"><button class="ss-tree-row__twisty" type="button" aria-label="展开"><i data-i="chevron-down"></i></button><i data-i="folder"></i><span class="ss-tree-row__label">劳动保障政策演化</span><span class="ss-tree-row__end"><span class="ss-spin" aria-label="里面有对话在运行" data-tip="里面有对话在运行" data-tip-place="right"></span></span><span class="ss-tree-row__actions">{project_actions}</span></div>
            <div class="ss-tree" hidden></div>
          </div>
        </div>
        <div class="ss-side-section">
          <div class="ss-side-section__head"><span>独立对话</span></div>
          <div class="ss-tree">{row("参考文献格式整理", state("", "clock", "排队", "排在当前回答之后"), cls="ss-tree-row--leaf", extra=' draggable="true" data-drag="chat"')}{row("Zipf 定律推导", "3 天", cls="ss-tree-row--leaf", extra=' draggable="true" data-drag="chat"')}</div>
        </div>
        <button class="ss-side-all" type="button"{cur("all")}><i data-i="layout-list"></i><span>全部对话</span><span class="ss-kbd">Ctrl Shift K</span></button>
      </div>
      <div class="ss-sidebar__foot">
        <button class="ss-user" type="button" data-tip="个人资料"><span class="ss-avatar ss-avatar--lg ss-avatar--user">Y</span><span class="ss-truncate">Yui</span></button>
        <button class="ss-icon-btn" type="button" aria-label="全局助手" data-tip="全局助手"><i data-i="sparkle"></i></button>
        <button class="ss-icon-btn" type="button" aria-label="设置" data-tip="设置" data-kbd="Ctrl ,"><i data-i="settings"></i></button>
      </div>
      <div class="ss-splitter ss-splitter--end" data-min="200" data-max="360" data-default="248"{split_key}></div>
    </aside>'''


SIDE_MENUS = (menu('m-side-chat', item('pencil', '重命名', 'F2') + item('pin', '置顶') + item('folder', '移到项目…', extra=' data-menu="#m-side-move"')
                   + SEP + item('archive', '归档（运行中不能归档）', extra=' aria-disabled="true"'))
              + menu('m-side-move', item('folder', PROJECT) + item('folder', '劳动保障政策演化') + SEP + item('message-square', '移出项目，变成独立对话'))
              + menu('m-side-project', item('square-pen', '在项目中新对话') + item('box', '打开工作站') + item('folder-open', '打开项目文件夹')
                     + item('pin', '置顶') + item('pencil', '重命名', 'F2') + SEP + item('archive', '归档项目')))


def statusbar(right='<span class="ss-statusbar__item">Python 3.12（项目环境）</span>'):
    return f'''<footer class="ss-statusbar">
    <span class="ss-statusbar__item"><span class="ss-dot ss-dot--ok"></span>已连接</span>
    <span class="ss-statusbar__item">项目文件夹 D:\\研究\\城市韧性</span>
    <span class="ss-statusbar__spacer"></span>
    {right}
  </footer>'''


def shell_menus(pinned=False):
    return '<!-- shell menus: build/shell/gen.py -->\n' + titlebar_menus(pinned) + SIDE_MENUS + '<!-- /shell menus -->\n'


def page(main, current=None, chat=None, panel='', title=PROJECT, menus='', pinned=False, status=None):
    return (f'''<div class="ss-shell">
  {titlebar(title, pinned)}
  <div class="ss-shell__body">
    {sidebar(current, chat)}
{main}
{panel}
  </div>
  {statusbar() if status is None else status}
</div>
''' + menus + shell_menus(pinned))


# ---------- swap the shell into the existing page mocks ----------
SWAP = {
    # name: (current nav item, open chat, project shown in the title bar)
    'PageChat': (None, '文献综述框架讨论', PROJECT),
    'PageInbox': ('knowledge', None, ''),
    'PageKnowledge': ('knowledge', None, ''),
    'PageKnowledgeGraph': ('knowledge', None, ''),
    'PageLibrary': ('knowledge', None, PROJECT),
    'PageProjectFolder': ('workbench', None, PROJECT),
    'PageSettings': ('knowledge', None, ''),
    'PageSettingsMcp': ('knowledge', None, ''),
    'PageSettingsSkills': ('knowledge', None, ''),
    'PageSettingsTools': ('knowledge', None, ''),
}
MENUS_RE = re.compile(r'<!-- shell menus: build/shell/gen.py -->\n.*?<!-- /shell menus -->\n', re.S)


def swap(name, current, chat, title):
    p = COMP / name / 'preview.html'
    t = p.read_text()
    key = re.search(r'<aside class="ss-sidebar">.*?data-key="([^"]+)"', t, re.S)
    t = re.sub(r'<header class="ss-titlebar">.*?</header>', lambda m: titlebar(title), t, count=1, flags=re.S)
    t = re.sub(r'<aside class="ss-sidebar">.*?</aside>', lambda m: sidebar(current, chat, key and key.group(1)), t, count=1, flags=re.S)
    t = MENUS_RE.sub('', t)
    t = t.replace('<script>window.SS && SS.mount(document.body)</script>', shell_menus() + '<script>window.SS && SS.mount(document.body)</script>')
    p.write_text(t)
    print('swapped', name)


# The chat header as built: find, project summary (Alt S), secretary, more.
CHAT_ACTIONS = ('<div class="ss-header__actions">\n'
                '          <button class="ss-icon-btn" type="button" aria-label="查找当前对话" data-tip="查找当前对话" data-kbd="Ctrl F"><i data-i="search"></i></button>\n'
                '          <button class="ss-icon-btn" type="button" aria-label="项目置顶摘要" aria-expanded="false" data-tip="项目置顶摘要" data-kbd="Alt S"><i data-i="newspaper"></i></button>\n'
                '          <button class="ss-icon-btn" type="button" aria-label="任务秘书" aria-pressed="true" data-tip="任务秘书" data-kbd="Ctrl J"><i data-i="panel-right"></i></button>\n'
                '          <button class="ss-icon-btn" type="button" aria-label="更多" data-menu="#m-chat"><i data-i="ellipsis"></i></button>\n'
                '        </div>')
CHAT_MENU = menu('m-chat', item('pencil', '重命名', 'F2') + item('pin', '置顶') + item('folder', '移到项目…', extra=' data-menu="#m-side-move"')
                 + SEP + item('history', '对话里的文件改动') + item('download', '导出为 Markdown') + item('square-terminal', 'Python 环境')
                 + SEP + item('archive', '归档（运行中不能归档）', extra=' aria-disabled="true"'))


def fix_chat():
    p = COMP / 'PageChat' / 'preview.html'
    t = p.read_text()
    t = re.sub(r'<div class="ss-header__actions">.*?</div>', CHAT_ACTIONS, t, count=1, flags=re.S)
    t = re.sub(r'<div class="ss-menu" id="m-chat" hidden>.*?\n</div>\n', lambda m: CHAT_MENU, t, count=1, flags=re.S)
    # Automation was removed (2026-10-18): two execution modes only.
    t = re.sub(r'\s*<button class="ss-menu__item ss-menu__item--rich ss-menu__item--auto"[^\n]*</button>', '', t)
    p.write_text(t)



# ---------- shared bits for the new pages ----------
def header(title, *, back=None, scope=None, tabs=None, actions='', tag=''):
    parts = []
    if back:
        parts.append(f'<button class="ss-icon-btn" type="button" aria-label="{back}" data-tip="{back}" data-kbd="Alt ←" style="align-self:center;margin-left:-6px"><i data-i="arrow-left"></i></button>')
    parts.append(f'<div class="ss-header__title"><span>{title}</span></div>')
    if tag:
        parts.append(tag)
    if scope:
        parts.append(scope)
    if tabs:
        parts.append('<span class="ss-header__sep"></span>')
        parts.append(tabs)
    parts.append(f'<div class="ss-header__actions">{actions}</div>')
    return '<div class="ss-header">\n        ' + '\n        '.join(parts) + '\n      </div>'


def tabs(label, items):
    btns = ''.join(f'<button class="ss-tab" role="tab" aria-selected="{"true" if i == 0 else "false"}" type="button">{t}{f"<span class=\"ss-tab__count\">{c}</span>" if c else ""}</button>'
                   for i, (t, c) in enumerate(items))
    return f'<nav class="ss-tabs" role="tablist" aria-label="{label}">{btns}</nav>'


def scope_select(menu_id='#m-scope', value=PROJECT, icon='folder-open'):
    return (f'<button class="ss-select ss-select--ghost" type="button" aria-haspopup="menu" data-menu="{menu_id}"><i data-i="{icon}"></i>'
            f'<span class="ss-select__value" data-slot="value">{value}</span><i data-i="chevron-down"></i></button>')


def radio(icon, text, on):
    return (f'  <button class="ss-menu__item" role="menuitemradio" aria-checked="{"true" if on else "false"}" data-label="{text}" type="button">'
            f'<i data-i="{icon}"></i>{text}<i data-i="check" class="ss-menu__check"></i></button>\n')


SCOPE_MENU = menu('m-scope', radio('folder-open', PROJECT, True) + radio('folder', '劳动保障政策演化', False))


def composer(placeholder, send_disabled=True):
    dis = ' disabled' if send_disabled else ''
    return f'''<div class="ss-composer-wrap">
        <div class="ss-composer">
          <textarea class="ss-composer__input" rows="1" placeholder="{placeholder}"></textarea>
          <div class="ss-composer__bar">
            {icon_btn("plus", "添加文件或资料")}
            <button class="ss-btn ss-btn--ghost ss-btn--sm" type="button" aria-haspopup="menu" data-menu="#m-mode" data-tip="执行方式"><i data-i="shield-check"></i><span data-slot="value">请求批准</span><i data-i="chevron-down"></i></button>
            <span class="ss-composer__spacer"></span>
            <button class="ss-btn ss-btn--ghost ss-btn--sm" type="button" data-tip="模型和思考强度">deepseek-v4-pro · 中<i data-i="chevron-down"></i></button>
            <button class="ss-send" type="button" aria-label="发送"{dis}><i data-i="arrow-up"></i></button>
          </div>
        </div>
      </div>'''


MODE_MENU = ('<div class="ss-menu" id="m-mode" hidden style="width:300px">\n'
             '  <button class="ss-menu__item ss-menu__item--rich" role="menuitemradio" aria-checked="true" type="button" data-label="请求批准" data-icon="shield-check"><i data-i="shield-check"></i><span class="ss-menu__text"><span>请求批准</span><span class="ss-menu__desc">运行命令、写入项目文件夹、安装包之前先问你</span></span><i data-i="check" class="ss-menu__check"></i></button>\n'
             '  <button class="ss-menu__item ss-menu__item--rich" role="menuitemradio" aria-checked="false" type="button" data-label="常规" data-icon="play"><i data-i="play"></i><span class="ss-menu__text"><span>常规</span><span class="ss-menu__desc">直接执行，不逐条询问，随时可以停止</span></span><i data-i="check" class="ss-menu__check"></i></button>\n'
             '</div>\n')


def welcome_art():
    src = (ROOT / 'app/ui/illustrations.js').read_text()
    body = re.search(r'welcome: svg\(`(.*?)`\)', src, re.S).group(1)
    star = re.search(r'\$\{STAR\((\d+), (\d+), (\d+)\)\}', body)
    x, y, r = map(int, star.groups())
    k = r * 0.12
    f = lambda v: f'{v:g}'
    d = (f'M{f(x)} {f(y - r)}C{f(x + k)} {f(y - k)} {f(x + k)} {f(y - k)} {f(x + r)} {f(y)}'
         f'C{f(x + k)} {f(y + k)} {f(x + k)} {f(y + k)} {f(x)} {f(y + r)}'
         f'C{f(x - k)} {f(y + k)} {f(x - k)} {f(y + k)} {f(x - r)} {f(y)}'
         f'C{f(x - k)} {f(y - k)} {f(x - k)} {f(y - k)} {f(x)} {f(y - r)}Z')
    body = body.replace(star.group(0), d)
    return '<svg class="ss-art" viewBox="0 0 160 120" aria-hidden="true" focusable="false">' + re.sub(r'\s*\n\s*', '', body) + '</svg>'


def list_row(title, sub, end='', icon='message-square', actions='', extra='', lead=None):
    lead = lead if lead is not None else f'<i data-i="{icon}" class="ss-list-row__icon"></i>'
    sub_html = f'<span class="ss-list-row__sub">{sub}</span>' if sub else ''
    two = ' ss-list-row--2' if sub else ''
    return (f'<div class="ss-list-row{two}"{extra}>{lead}<div class="ss-list-row__main"><span class="ss-list-row__title">{title}</span>{sub_html}</div>'
            f'{end}<span class="ss-list-row__actions">{actions}</span></div>')


def time_meta(t):
    return f'<span class="ss-list-row__meta ss-list-row__meta--time">{t}</span>'


CHAT_MORE = icon_btn('ellipsis', '对话菜单', ' data-menu="#m-side-chat"', sm=True)


# ---------- 首页（新对话） ----------
def page_home():
    recent = [('文献综述框架讨论', PROJECT, '16:24', SPIN), ('指标体系初稿', PROJECT, '15:02', '<span class="ss-tag ss-tag--warn">待批准</span>'),
              ('参考文献格式整理', '独立对话', '昨天', ''), ('面板数据清洗', PROJECT, '10-20', '<span class="ss-tag ss-tag--danger">失败</span>'),
              ('政策文本编码规则', '劳动保障政策演化', '10-19', '')]
    rows = ''.join(list_row(f'{t}', p, end + time_meta(when), actions=CHAT_MORE, extra=' data-ctx="#m-side-chat"') for t, p, when, end in recent)
    sites = ''.join(f'<button class="ss-btn ss-btn--sm" type="button" data-ctx="#m-site" data-tip="{u}"><i data-i="globe"></i>{n}</button>'
                    for n, u in (('Google Scholar', 'scholar.google.com'), ('中国知网', 'cnki.net'), ('Web of Science', 'webofscience.com'), ('arXiv', 'arxiv.org'), ('国家统计局', 'stats.gov.cn')))
    main = f'''    <main class="ss-main">
      {header("新对话", scope=scope_select("#m-where", PROJECT), actions="")}
      <div class="ss-content">
        <div class="ss-home">
          <div class="ss-home__hello">
            {welcome_art()}
            <h1 style="margin:0;font-size:22px;line-height:30px;font-weight:600">今天想研究什么？</h1>
            <p class="ss-muted" style="margin:0;font-size:13px">Yui，从一个问题开始，和你的研究小组一起推进。</p>
          </div>
          <section>
            <div class="ss-block-head"><span class="ss-block-head__title">最近工作</span><span class="ss-block-head__end"><button class="ss-btn ss-btn--ghost ss-btn--sm" type="button">全部对话<i data-i="chevron-right"></i></button></span></div>
            <div class="ss-list">{rows}</div>
          </section>
          <section>
            <div class="ss-block-head"><span class="ss-block-head__title">常用学术站点</span><span class="ss-block-head__end">{icon_btn("settings", "管理站点", sm=True)}</span></div>
            <div class="ss-home__sites">{sites}<button class="ss-btn ss-btn--ghost ss-btn--sm" type="button"><i data-i="plus"></i>添加站点</button></div>
          </section>
        </div>
      </div>
      {composer("问一个研究问题，输入 @ 叫其他专家")}
    </main>'''
    menus = (menu('m-where', radio('folder-open', PROJECT, True) + radio('folder', '劳动保障政策演化', False) + '  <div class="ss-menu__sep"></div>\n' + radio('message-square', '独立对话（不放进项目）', False))
             + menu('m-site', item('external-link', '打开站点') + item('pencil', '编辑站点') + item('chevron-up', '上移') + item('chevron-down', '下移') + SEP + item('trash-2', '移除站点', extra=' class="ss-menu__item ss-menu__item--danger"').replace('class="ss-menu__item" type="button" class="ss-menu__item ss-menu__item--danger"', 'class="ss-menu__item ss-menu__item--danger" type="button"'))
             + MODE_MENU)
    card('PageHome', 'group="整页示例" page height=900 width=1536 subtitle="首页（新对话）：问候、最近工作、常用学术站点，输入框在底部；页头选新对话放进哪个项目"',
         page(main, current='new', menus=menus), '''
整页示例：首页，也是「新对话」页。

## 区域

- 页头：标题「新对话」，旁边的范围选择决定新对话放进哪个项目，最后一项是「独立对话（不放进项目）」。从项目里点「新对话」时默认选中这个项目。
- 问候：欢迎插画（Illustrations 的 welcome）、「今天想研究什么？」和一句带名字的问候。
- 最近工作：最近 5 个对话，用列表（List，两行版），第二行写所在项目；行尾显示状态（运行中、待批准、失败）和时间；悬停出现 ⋯，右键是同一份对话菜单。右上「全部对话」进入全部对话页。
- 常用学术站点：一排按钮，点一下在系统浏览器打开；右键是打开、编辑、上移、下移、移除；「添加站点」填名称和网址；齿轮进入管理。
- 输入框（Composer）：和对话页同一个组件，执行方式只有「请求批准」「常规」两档。

## 规则

- 没有最近对话时，「最近工作」整组隐藏，不写空提示；第一次发送后才出现。
- 页面宽度随窗口变化，内容列最宽 720px，居中。
''')


# ---------- 全部对话 ----------
def page_all():
    def chat(title, sub, when, state_html='', pinned=False, icon='message-square', archived=False):
        pin = '<i data-i="pin" class="ss-i--sm" style="color:var(--muted);margin-left:4px;vertical-align:-2px" aria-label="已置顶"></i>' if pinned else ''
        acts = (icon_btn('archive', '取消归档', sm=True) if archived else '') + CHAT_MORE
        return list_row(title + pin, sub, state_html + time_meta(when), icon=icon, actions=acts, extra=' data-ctx="#m-side-chat"')
    today = (chat('文献综述框架讨论', f'{PROJECT} · 主专家、方法专家、文献专家', '16:24', '<span class="ss-spin" aria-label="运行中"></span>', icon='users')
             + chat('开题报告修改意见', '独立对话', '14:10', pinned=True)
             + chat('指标体系初稿', f'{PROJECT} · 主专家', '15:02', '<span class="ss-tag ss-tag--warn">待批准</span>')
             + chat('参考文献格式整理', '独立对话', '11:47', '<span class="ss-tag">排队</span>'))
    week = (chat('面板数据清洗', f'{PROJECT} · 主专家', '10-20', '<span class="ss-tag ss-tag--danger">失败</span>')
            + chat('稳健性检验方案', f'{PROJECT} · 分支自「面板数据清洗」', '10-20', icon='git-branch')
            + chat('问卷题项对照', f'{PROJECT} · 主专家', '10-19')
            + chat('政策文本编码规则', '劳动保障政策演化 · 主专家、方法专家', '10-19', icon='users')
            + chat('Zipf 定律推导', '独立对话', '10-19'))
    older = (chat('访谈提纲', f'{PROJECT} · 主专家', '10-14')
             + chat('研究区域划定', f'{PROJECT} · 主专家', '10-12')
             + chat('开题答辩准备', '独立对话', '10-08'))
    main = f'''    <main class="ss-main">
      {header("全部对话", tabs=tabs("筛选", [("全部", 23), ("置顶", 2), ("已归档", 6)]), actions='<button class="ss-btn" type="button"><i data-i="square-pen"></i>新对话</button>')}
      <div class="ss-toolbar">
        <span class="ss-input"><i data-i="search"></i><input placeholder="搜索对话名称或项目…" aria-label="搜索全部对话" /></span>
        {scope_select("#m-proj", "所有项目", "folder")}
        <button class="ss-select ss-select--ghost" type="button" aria-haspopup="menu" data-menu="#m-sort"><i data-i="arrow-down-up"></i><span class="ss-select__value" data-slot="value">最近活动</span><i data-i="chevron-down"></i></button>
        <span class="ss-toolbar__spacer"></span>
        <span class="ss-muted" style="font-size:12px">23 个对话，含 3 个分支对话</span>
      </div>
      <div class="ss-content">
        <div style="padding:8px 16px 24px">
          <button class="ss-list__group" type="button" aria-expanded="true" data-toggle="next"><i data-i="chevron-down"></i>今天<span class="ss-count">4</span></button>
          <div class="ss-list">{today}</div>
          <button class="ss-list__group" type="button" aria-expanded="true" data-toggle="next"><i data-i="chevron-down"></i>本周<span class="ss-count">5</span></button>
          <div class="ss-list">{week}</div>
          <button class="ss-list__group" type="button" aria-expanded="true" data-toggle="next"><i data-i="chevron-down"></i>更早<span class="ss-count">14</span></button>
          <div class="ss-list">{older}<button class="ss-tree-more" type="button" style="margin:4px 0 0 8px">再显示 11 个</button></div>
        </div>
      </div>
    </main>'''
    menus = (menu('m-proj', radio('folder', '所有项目', True) + radio('folder-open', PROJECT, False) + radio('folder', '劳动保障政策演化', False) + radio('message-square', '独立对话', False))
             + menu('m-sort', radio('arrow-down-up', '最近活动', True) + radio('arrow-down-up', '创建时间', False) + radio('arrow-down-up', '名称', False)))
    card('PageAllChats', 'group="整页示例" page height=900 width=1536 subtitle="全部对话：按时间分组的列表，可搜索、按项目筛选；每行都有和左栏一样的对话菜单，已置顶的带图钉"',
         page(main, current='all', menus=menus, title=''), '''
整页示例：全部对话。左栏末尾「全部对话」（Ctrl Shift K）进入，含已归档的对话。

## 区域

- 页头：标签「全部」「置顶」「已归档」带数量；右边一个「新对话」。
- 工具条（Toolbar）：搜索对话名称或项目、项目筛选（所有项目、各项目、独立对话）、排序（最近活动、创建时间、名称），右边一句总数。
- 列表（List，两行版）：按「今天」「本周」「更早」分组，组头可折叠。
  - 第一行是对话名，已置顶的在后面带图钉；
  - 第二行写所在项目和专家，分支对话写「分支自「…」」，图标换成 git-branch；多位专家的对话图标是 users；
  - 行尾是状态（运行中、待批准、失败、排队）和时间；
  - 悬停出现 ⋯，右键是同一份对话菜单（重命名 F2、置顶、移到项目…、归档）；「已归档」标签下多一个「取消归档」按钮。
- 一组太长时先列 3 行，其余收进「再显示 N 个」。

## 规则

- 对话用列表不用表格（README 的规则）。
- 和左栏共用一份对话菜单，改了一边另一边跟着改。
- 运行中的对话不能归档，菜单项禁用并写明原因。
''')


# ---------- 工作站 ----------
def vtree_panel():
    src = (COMP / 'PageDeskVersions' / 'preview.html').read_text()
    j = src.find('<aside class="ss-panel"')
    panel = src[j:src.find('</aside>', j) + len('</aside>')]
    panel = panel.replace('<span class="ss-panel__title">版本树 · thesis.docx</span>', '<span class="ss-panel__title">版本树</span>')
    panel = panel.replace('<span class="ss-input ss-input--sm" style="flex:1">',
                          '<button class="ss-select ss-select--sm" type="button" aria-haspopup="menu" data-menu="#m-wb-file" style="flex:none"><span class="ss-ftype ss-ftype--docx" aria-hidden="true">W</span><span class="ss-select__value" data-slot="value">thesis.docx</span><i data-i="chevron-down"></i></button><span class="ss-input ss-input--sm" style="flex:1">', 1)
    panel = panel.replace('placeholder="按标题、标签、备注、修改指令筛选"', 'placeholder="筛选版本"')
    panel = panel.replace('<i data-i="pencil"></i>从这一版开始编辑', '<i data-i="file-pen"></i>在编辑台打开这一版')
    panel = panel.replace('<button class="ss-btn ss-btn--sm ss-btn--ghost" type="button"><i data-i="git-compare"></i>和 v7 比较</button>', '')
    panel = panel.replace('data-default="360"', 'data-default="360" data-key="page-wb-vtree"')
    return '    ' + panel


def page_workbench():
    def plan(title, text, owner, when, done=False):
        cls = ' ss-note-card--done' if done else ''
        box = f'<label class="ss-check" style="margin:0"><input type="checkbox" aria-label="切换完成状态"{" checked" if done else ""} /></label>'
        return (f'<div class="ss-note-card{cls}" role="button" tabindex="0" data-ctx="#m-plan"><span class="ss-note-card__top">{box}<span class="ss-note-card__title">{title}</span></span>'
                f'<span class="ss-note-card__text">{text}</span><span class="ss-note-card__meta"><span class="ss-tag">{owner}</span><span>{when}</span></span></div>')

    def log(title, text, when, files, by=''):
        mark = '<span data-tip="秘书添加"><i data-i="sparkle" class="ss-i--sm"></i></span>' if by else ''
        return (f'<div class="ss-note-card" role="button" tabindex="0" data-ctx="#m-log"><span class="ss-note-card__top"><span class="ss-note-card__title">{title}</span>{mark}</span>'
                f'<span class="ss-note-card__text">{text}</span><span class="ss-note-card__meta"><span>{when}</span><span><i data-i="paperclip" class="ss-i--sm" style="vertical-align:-2px"></i> {files}</span></span></div>')
    plans = (plan('补齐 2021–2022 年面板数据', '统计年鉴缺的 6 个城市用城建年鉴补，补完重跑熵权。', PROJECT, '10-24 前')
             + plan('第三章组态分析改写', '按导师意见把 fsQCA 的必要性分析单列一节。', PROJECT, '10-26 前')
             + plan('政策文本编码复核', '两人背对背编码，算一致性系数。', '劳动保障政策演化', '10-28 前')
             + plan('导师第一轮意见逐条回复', '已全部回复，等导师确认。', PROJECT, '10-17', done=True))
    logs = (log('完成指标体系初稿', '26 个二级指标，S1、S4 对照后保留 15 个共有项。', '10-18', '3 个文件')
            + log('面板数据清洗出错', 'pandas 读 GBK 编码失败，换成 utf-8-sig 后通过。', '10-20', '1 个文件', by='秘书')
            + log('综述按方法分三节', '面板计量、综合评价、案例访谈各一节。', '10-21', '2 个文件', by='秘书')
            + log('fsQCA 校准阈值确定', '完全隶属 95%、交叉点 50%、完全不隶属 5%。', '10-22', '1 个文件'))
    files = ''.join(
        f'<div class="ss-tree-row ss-tree-row--{"leaf" if not folder else "child"}" style="padding-left:{8 + depth * 16}px">'
        f'{"<button class=\"ss-tree-row__twisty\" type=\"button\" aria-label=\"收起\"><i data-i=\"chevron-down\"></i></button>" if folder else ""}'
        f'<i data-i="{"folder-open" if folder else icon}"></i><span class="ss-tree-row__label">{name}</span><span class="ss-tree-row__end">{end}</span></div>'
        for depth, folder, icon, name, end in [
            (0, True, '', 'data', ''), (1, False, 'table-2', 'indicators.csv', '<span class="ss-dot ss-dot--ok" data-tip="已索引"></span>'),
            (1, False, 'table-2', 'panel_2010_2022.xlsx', '<span class="ss-dot ss-dot--ok" data-tip="已索引"></span>'),
            (0, True, '', 'chapters', ''), (1, False, 'file-text', 'thesis.docx', '<span class="ss-dot ss-dot--ok" data-tip="已索引"></span>'),
            (1, False, 'file-code', 'method.tex', '<span class="ss-spin" data-tip="正在索引"></span>'),
            (0, True, '', 'refs', ''), (1, False, 'file-text', 'Ragin_2008.pdf', '<span class="ss-dot ss-dot--ok" data-tip="已索引"></span>'),
            (0, False, 'file-code', 'match_indicators.py', '<span class="ss-dot" data-tip="只按名称索引"></span>'),
        ])
    main = f'''    <main class="ss-main">
      {header("工作站", scope=scope_select(), actions='<button class="ss-btn ss-btn--ghost" type="button" aria-pressed="true"><i data-i="git-fork"></i>版本树</button><button class="ss-btn" type="button"><i data-i="file-pen"></i>在编辑台打开</button>' + icon_btn("ellipsis", "更多", ' data-menu="#m-wb"'))}
      <div class="ss-content" style="overflow:hidden">
        <div class="ss-wb">
          <section>
            <div class="ss-block-head"><span class="ss-block-head__title">全局计划</span><span class="ss-count">4</span><span class="ss-block-head__end">{icon_btn("plus", "添加计划", sm=True)}<button class="ss-btn ss-btn--ghost ss-btn--sm" type="button">查看全部<i data-i="chevron-right"></i></button></span></div>
            <div class="ss-wb__strip">{plans}</div>
          </section>
          <section>
            <div class="ss-block-head"><span class="ss-block-head__title">本项目日志</span><span class="ss-count">12</span><span class="ss-block-head__end">{icon_btn("plus", "添加日志", sm=True)}<button class="ss-btn ss-btn--ghost ss-btn--sm" type="button">查看全部<i data-i="chevron-right"></i></button></span></div>
            <div class="ss-wb__strip">{logs}</div>
          </section>
          <div class="ss-wb__bottom">
            <div class="ss-box-card">
              <div class="ss-box-card__head"><span>研究框架与进展</span><span class="ss-tag">预览</span>{icon_btn("maximize-2", "打开研究导图")}</div>
              {map_canvas(preview=True)}
            </div>
            <div class="ss-box-card">
              <div class="ss-box-card__head"><span>项目文件夹</span>{icon_btn("folder-open", "在系统中打开")}{icon_btn("maximize-2", "打开项目资料页")}</div>
              <div class="ss-box-card__body" style="padding:4px 4px 8px"><div class="ss-tree">{files}</div></div>
            </div>
          </div>
        </div>
      </div>
    </main>'''
    menus = (SCOPE_MENU
             + menu('m-wb', item('square-pen', '在项目中新对话') + item('folder-open', '打开项目文件夹') + item('package', '导出项目快照') + SEP + item('history', '计划的历史版本') + item('history', '日志的历史版本'))
             + menu('m-wb-file', radio('file-text', 'thesis.docx', True) + radio('file-code', 'chapters/method.tex', False) + radio('file-text', 'notes/outline.md', False) + radio('file-text', '开题报告.docx', False))
             + menu('m-plan', item('pencil', '编辑计划') + item('circle-check', '标为完成') + item('folder', '改归属…') + SEP + item('trash-2', '删除').replace('class="ss-menu__item"', 'class="ss-menu__item ss-menu__item--danger"'))
             + menu('m-log', item('file-text', '日志详情') + item('paperclip', '文件列表') + item('pencil', '编辑') + SEP + item('trash-2', '删除').replace('class="ss-menu__item"', 'class="ss-menu__item ss-menu__item--danger"')))
    card('PageWorkbench', 'group="整页示例" page height=900 width=1536 subtitle="工作站：全局计划和本项目日志两条卡片带，下面研究导图预览和项目文件夹；页头「版本树」在右侧打开和编辑台同一个版本树"',
         page(main, current='workbench', panel=vtree_panel(), menus=menus), '''
整页示例：工作站。左栏「工作站」进入，右边的简报按钮打开工作站简报（最近历史版本、日志）。

## 区域

- 页头：标题、项目选择；「版本树」（ghost，按下时在右侧打开版本树）、「在编辑台打开」（打开编辑台窗口并显示这个项目的文稿）、⋯（在项目中新对话、打开项目文件夹、导出项目快照、计划的历史版本、日志的历史版本）。
- 全局计划：所有项目的计划卡片，横向一条，可左右滚动。卡片有完成勾选、标题、两行说明、归属项目和期限；完成的划掉变灰、排在最后。点卡片编辑，右键编辑、标为完成、改归属、删除。计划文件里一条是 `- [ ] 标题`，下面缩进的行是说明，缩进的 `due: 2026-10-24` 是期限。
- 本项目日志：这个项目的日志卡片。秘书写的带 sparkle 标记；卡片底部写日期和关联文件数。点卡片进入日志详情页。
- 研究框架与进展：研究导图的只读预览（ss-map），右上角放大按钮进入研究导图页。
- 项目文件夹：文件树，行尾的点表示索引状态（绿色已索引、转圈正在索引、空心只按名称索引）；可在系统中打开，或进入项目资料页。
- 右侧版本树（Panel 360px）：和编辑台同一个组件，上面多一个文稿选择；选中一版后「在编辑台打开这一版」（只读打开，在编辑台里再从这一版开始编辑）。工作站里不比较：比较在编辑台做。

## 规则

- 原来左下角的文稿版本管理撤掉，导图向左拉伸（DeskEntry ②）。
- 卡片带只有一行高，不随内容变高；内容多时截两行。
- 没有计划或日志时整组保留标题和「添加」，正文写一句提示（这是工作站的主要内容，不隐藏）。
''')


# ---------- 研究导图 ----------
NODES = [
    # id, x, y, title, meta, cls
    ('root', 24, 300, '城市韧性与公共政策', '', 'root'),
    ('q', 236, 72, '研究问题', '', ''),
    ('lit', 236, 188, '文献综述', '', ''),
    ('m', 236, 304, '研究方法', '', ''),
    ('d', 236, 420, '数据', '', ''),
    ('w', 236, 536, '发现与写作', '', ''),
    ('q1', 436, 40, '韧性如何测度', '', ''),
    ('q2', 436, 104, '政策是否提升韧性', '', ''),
    ('l1', 436, 160, '测度方法三类', '<i data-i="sparkle" class="ss-i--sm"></i>秘书添加', ''),
    ('l2', 436, 220, '政策评估文献', '', ''),
    ('m1', 436, 278, '熵权 TOPSIS', '', ''),
    ('m2', 436, 338, '多期 DID', '', ''),
    ('m3', 636, 338, '平行趋势检验', '', ''),
    ('w1', 436, 536, '第三章初稿', '<i data-i="file-text" class="ss-i--sm"></i>thesis.docx', ''),
    ('loose', 660, 150, '访谈材料怎么用？', '游离节点', 'loose'),
]
EDGES = [('root', 'q'), ('root', 'lit'), ('root', 'm'), ('root', 'd'), ('root', 'w'), ('q', 'q1'), ('q', 'q2'), ('lit', 'l1'), ('lit', 'l2'),
         ('m', 'm1'), ('m', 'm2'), ('m2', 'm3'), ('w', 'w1')]
LINKS = [('l2', 'm2')]


def map_canvas(preview=False, selected=None):
    pos = {n[0]: n for n in NODES}
    width = lambda n: 168 if n[5] == 'root' else 150
    mid = lambda n: n[2] + (22 if n[4] else 15)
    paths = ''
    for a, b in EDGES:
        A, B = pos[a], pos[b]
        x1, y1, x2, y2 = A[1] + width(A), mid(A), B[1], mid(B)
        paths += f'<path d="M{x1} {y1}C{x1 + 30} {y1} {x2 - 30} {y2} {x2} {y2}"/>'
    for a, b in LINKS:
        A, B = pos[a], pos[b]
        x1, y1, x2, y2 = A[1] + width(A), mid(A), B[1] + width(B), mid(B)
        paths += f'<path data-link d="M{x1} {y1}C{x1 + 56} {y1} {x2 + 56} {y2} {x2} {y2}"/>'
    nodes = ''
    for n in NODES:
        id_, x, y, title, meta, cls = n
        c = f' ss-mnode--{cls}' if cls else ''
        sel = ' aria-selected="true"' if id_ == selected else ''
        meta_html = f'<span class="ss-mnode__meta">{meta}</span>' if meta else ''
        nodes += (f'<button class="ss-mnode{c}" type="button" style="left:{x}px;top:{y}px"{sel} data-ctx="#m-node">'
                  f'<span class="ss-mnode__title">{title}</span>{meta_html}</button>')
    nodes += '<button class="ss-mnode__fold" type="button" style="left:386px;top:435px;right:auto;transform:none" aria-label="展开分支" data-tip="展开 3 个子节点">3</button>'
    scale = (' style="transform:scale(.64);transform-origin:0 0;position:absolute;left:8px;top:8px;width:820px;height:620px"' if preview
             else ' style="position:absolute;left:96px;top:56px;width:820px;height:620px"')
    hint = '' if preview else '<span class="ss-map__hint">滚轮缩放 · 拖动画布 · 右键节点编辑</span>'
    return (f'<div class="ss-map"><div{scale}><svg class="ss-map__links" width="820" height="620" aria-hidden="true">{paths}</svg>{nodes}</div>{hint}</div>')


def page_map():
    bar = (f'<div class="ss-map__bar">{icon_btn("zoom-out", "缩小", sm=True)}<span style="width:36px;text-align:center">100%</span>{icon_btn("zoom-in", "放大", sm=True)}'
           f'{icon_btn("scan", "适应画布", sm=True)}<span class="ss-ribbon__sep"></span>{icon_btn("undo-2", "撤销 Ctrl Z", sm=True)}{icon_btn("redo-2", "重做 Ctrl Y", sm=True)}'
           f'<span class="ss-toolbar__spacer"></span><span class="ss-dot ss-dot--ok"></span>已保存</div>')
    main = f'''    <main class="ss-main">
      {header("研究框架与进展", back="返回工作站", tabs=tabs("视图", [("导图", None), ("Markdown 大纲", None), ("JSON", None)]), actions=icon_btn("history", "历史版本") + icon_btn("download", "导出", ' data-menu="#m-export"') + '<button class="ss-btn" type="button"><i data-i="plus"></i>新增分支</button>')}
      {map_canvas(selected='l2')}
      {bar}
    </main>'''
    children = ''.join(list_row(t, '', '', icon='list-tree', actions=icon_btn('chevron-up', '上移', sm=True) + icon_btn('chevron-down', '下移', sm=True)) for t in ('双重差分类', '合成控制类', '断点回归类'))
    panel = f'''    <aside class="ss-panel" style="width:320px">
      <div class="ss-splitter ss-splitter--start" data-min="280" data-max="520" data-default="320" data-key="page-map-node"></div>
      <div class="ss-panel__head"><span class="ss-panel__title">节点</span>{icon_btn("ellipsis", "更多", ' data-menu="#m-node"')}{icon_btn("x", "关闭")}</div>
      <div class="ss-panel__body" style="display:grid;gap:14px;align-content:start;padding:12px;overflow:auto">
        <label class="ss-field"><span class="ss-field__label">节点内容 · Markdown</span><textarea class="ss-textarea" rows="5">**政策评估文献**
按识别策略分三类，重点看多期 DID 的
处理时点异质性问题（Goodman-Bacon 2021）。</textarea><span class="ss-field__hint">离开输入框自动保存；Enter 新建同级，Shift Enter 换行。</span></label>
        <section>
          <div class="ss-block-head"><span class="ss-block-head__title" style="font-size:13px">分支</span><span class="ss-count">3</span><span class="ss-block-head__end">{icon_btn("plus", "添加子节点", sm=True)}</span></div>
          <div class="ss-list">{children}</div>
        </section>
        <section>
          <div class="ss-block-head"><span class="ss-block-head__title" style="font-size:13px">连线</span><span class="ss-count">1</span><span class="ss-block-head__end">{icon_btn("plus", "连到另一个节点", sm=True)}</span></div>
          <div class="ss-list">{list_row("多期 DID", "研究方法 › 多期 DID", "", icon="spline", actions=icon_btn("x", "删除连线", sm=True))}</div>
        </section>
        <dl class="ss-props"><dt>位置</dt><dd>文献综述 › 政策评估文献</dd><dt>改动</dt><dd>10-21 16:40 · 你</dd></dl>
      </div>
      <div class="ss-panel__foot"><button class="ss-btn ss-btn--ghost ss-btn--sm" type="button" style="color:var(--danger)"><i data-i="trash-2"></i>删除节点</button></div>
    </aside>'''
    menus = (menu('m-export', item('image', '导出图片（PNG）') + item('file-code', '导出 SVG') + item('file-text', '导出 Markdown 大纲') + item('code', '导出 JSON'))
             + menu('m-node', item('plus', '添加子节点', 'Tab') + item('plus', '添加同级节点', 'Enter') + item('spline', '连到另一个节点…') + item('pencil', '编辑', 'F2')
                    + item('message-square', '在对话里引用') + SEP + item('trash-2', '删除节点', 'Del').replace('class="ss-menu__item"', 'class="ss-menu__item ss-menu__item--danger"')))
    card('PageMap', 'group="整页示例" page height=900 width=1536 subtitle="研究导图：从工作站放大进入；节点卡片和编辑台的版本树同一种样子，右侧编辑选中节点的内容、分支和连线"',
         page(main, current='workbench', panel=panel, menus=menus), '''
整页示例：研究导图（研究框架与进展）。工作站导图预览右上角的放大按钮进入，Alt ← 返回工作站。

## 区域

- 页头：返回、标题；视图标签「导图」「Markdown 大纲」「JSON」（后两个是同一份数据的文本编辑）；历史版本、导出（PNG、SVG、Markdown 大纲、JSON）、「新增分支」。
- 画布（ss-map）：点阵底，节点是卡片（ss-mnode），样子和编辑台版本树的 ss-vnode 一致；根节点加粗；从左往右展开。
  - 秘书加的节点带 sparkle「秘书添加」；关联了文稿的节点写文件名，点一下在编辑台打开。
  - 游离节点（没有父节点）用虚线边框。
  - 节点连线（不是父子关系的关联）用 accent 色虚线。
  - 收起的分支在父节点右边显示子节点数，点开展开。
- 底栏（ss-map__bar）：缩放、适应画布、撤销重做，右边保存状态。
- 右侧节点面板（Panel 320px）：节点内容（Markdown）、分支（上移下移、添加子节点）、连线（添加、删除）、位置和最后改动；底部删除节点。

## 交互

- 滚轮缩放，拖动空白处平移；拖动节点改位置。
- 右键节点：添加子节点（Tab）、添加同级（Enter）、连到另一个节点、编辑（F2）、在对话里引用、删除（Del）。
- 修改自动保存，每次离开页面留一个历史版本。
''')


# ---------- 日志详情 ----------
def page_journal():
    files = ''.join(list_row(p, d, '', icon=i, actions=icon_btn('external-link', '打开', sm=True) + icon_btn('x', '移除关联', sm=True))
                    for p, d, i in (('data/indicators.csv', '26 行 · 10-18 修改', 'table-2'), ('scripts/match_indicators.py', '+42 行 · 10-18 修改', 'file-code'),
                                    ('chapters/thesis.docx', '编辑台 · v5 修改方法部分', 'file-text')))
    main = f'''    <main class="ss-main">
      {header("完成指标体系初稿", back="返回工作站", tag='<span class="ss-tag" style="align-self:center">10-18</span>', tabs=tabs("日志", [("日志详情", None), ("文件列表", 3)]), actions=icon_btn("history", "历史版本") + icon_btn("ellipsis", "更多", ' data-menu="#m-entry"'))}
      <div class="ss-content">
        <div class="ss-doc ss-doc--aside">
          <article style="display:grid;gap:12px;min-width:0">
            <div class="ss-doc__meta"><span><i data-i="folder" class="ss-i--sm" style="vertical-align:-2px"></i> {PROJECT}</span><span>你写的 · 10-18 21:05</span><span>点正文直接编辑</span></div>
            <div class="ss-prose" tabindex="0" data-tip="点一下编辑，离开自动保存" data-tip-place="top-start">
              <h3>做了什么</h3>
              <p>把 S1（18 个二级指标）和 S4（24 个）的指标体系逐项对照，合并成 26 个二级指标，分经济、社会、生态、基础设施四类。15 个是两篇共有的，另外 11 个按研究区域的数据可得性取舍。</p>
              <h3>决定</h3>
              <ul><li>指标口径以 <code>data/indicators.csv</code> 为准；</li><li>负向指标（失业率、PM2.5 年均值）先取倒数再标准化；</li><li>权重用熵权法，稳健性检验再换 CRITIC。</li></ul>
              <h3>还没解决</h3>
              <p>2021–2022 年有 6 个城市缺「建成区绿化覆盖率」，已列进全局计划。</p>
            </div>
          </article>
          <aside class="ss-box-card" style="align-self:start">
            <div class="ss-box-card__head"><span>节点信息</span></div>
            <div style="display:grid;gap:12px;padding:12px">
              <dl class="ss-props"><dt>所属项目</dt><dd>{PROJECT}</dd><dt>日期</dt><dd>10-18</dd><dt>导图节点</dt><dd>研究方法 › 熵权 TOPSIS</dd></dl>
              <label class="ss-field"><span class="ss-field__label">关联稿件版本</span><button class="ss-select ss-select--sm" type="button" aria-haspopup="menu"><span class="ss-ftype ss-ftype--docx" aria-hidden="true">W</span><span class="ss-select__value">thesis.docx · v5 修改方法部分</span><i data-i="chevron-down"></i></button></label>
              <div class="ss-field"><span class="ss-field__label">关联文件</span><div class="ss-list">{files}</div>
                <span class="ss-input ss-input--sm"><i data-i="paperclip" class="ss-i--sm"></i><input placeholder="项目文件夹里的相对路径" aria-label="项目文件路径" /></span>
                <span class="ss-field__hint">关联随日志的历史版本一起保留。</span></div>
            </div>
          </aside>
        </div>
      </div>
    </main>'''
    menus = menu('m-entry', item('pencil', '编辑标题') + item('calendar', '改日期') + item('message-square', '在对话里引用') + SEP
                 + item('trash-2', '删除日志').replace('class="ss-menu__item"', 'class="ss-menu__item ss-menu__item--danger"'))
    card('PageJournal', 'group="整页示例" page height=900 width=1536 subtitle="日志详情：正文点一下就能改；右边是节点信息、关联的稿件版本和项目文件"',
         page(main, current='workbench', menus=menus), '''
整页示例：日志详情。工作站「本项目日志」里点一张卡片进入，Alt ← 返回工作站。

## 区域

- 页头：返回、日志标题、日期；标签「日志详情」「文件列表」（带数量）；历史版本、⋯（编辑标题、改日期、在对话里引用、删除日志）。
- 正文（ss-prose）：渲染后的 Markdown；点一下变成原文编辑，离开自动保存。上面一行写所属项目、谁写的和时间。
- 节点信息（右侧卡片 280px）：所属项目、日期、对应的导图节点；关联稿件版本（编辑台里的某一版）；关联文件列表（打开、移除），下面输入项目文件夹里的相对路径添加。

## 规则

- 「文件列表」标签只列关联文件，可以批量打开或移除。
- 秘书写的日志在作者处写「任务秘书」，内容同样可以改，改动进历史版本。
''')


# ---------- 项目置顶摘要 ----------
def project_summary():
    versions = ''.join(list_row(n, '', time_meta(w), icon=i) for n, w, i in (('研究导图', '10-22 09:12', 'network'), ('全局计划', '10-21 18:30', 'list-checks'), ('本项目日志', '10-21 16:40', 'notebook-pen')))
    nodes = ''.join(list_row(n, '', time_meta(w), icon='notebook-pen') for n, w in (('fsQCA 校准阈值确定', '10-22'), ('综述按方法分三节', '10-21'), ('面板数据清洗出错', '10-20')))
    body = f'''<div class="ds" style="grid-template-columns:minmax(0,1fr) 300px;gap:24px;align-items:start">
  <div class="ds-box" style="position:relative;height:500px;overflow:hidden;background:var(--paper)">
    <div class="ss-header">
      <div class="ss-header__title"><span>文献综述框架讨论</span></div>
      <span class="ss-header__sep"></span>
      <span class="ss-avatars" style="align-self:center"><span class="ss-avatar">主</span><span class="ss-avatar">方</span><span class="ss-avatar">文</span></span>
      <div class="ss-header__actions">
        {icon_btn("search", "查找当前对话", ' data-kbd="Ctrl F"')}
        <button class="ss-icon-btn" type="button" aria-label="项目置顶摘要" aria-expanded="true" data-tip="项目置顶摘要" data-kbd="Alt S" style="background:var(--selected)"><i data-i="newspaper"></i></button>
        {icon_btn("panel-right", "任务秘书", ' data-kbd="Ctrl J"')}
        {icon_btn("ellipsis", "更多")}
      </div>
    </div>
    <div class="ss-flyout" style="top:48px;right:52px" role="dialog" aria-label="项目摘要">
      <div class="ss-flyout__head"><i data-i="folder-open" class="ss-i--sm"></i><span>{PROJECT}</span>{icon_btn("x", "关闭项目摘要", sm=True)}</div>
      <button class="ss-list__group" type="button" aria-expanded="true" data-toggle="next"><i data-i="chevron-down"></i>最近历史版本<span class="ss-count">3</span></button>
      <div class="ss-list">{versions}</div>
      <div class="ss-flyout__group">最近日志</div>
      <div class="ss-list">{nodes}</div>
      <div class="ss-flyout__foot"><button class="ss-btn ss-btn--ghost ss-btn--sm" type="button"><i data-i="network"></i>研究导图</button><button class="ss-btn ss-btn--sm" type="button"><i data-i="box"></i>打开工作站</button></div>
    </div>
  </div>
  <div class="ds-col" style="padding-top:4px">
    <span class="ds-title">什么时候出现</span>
    <p class="ds-note">项目里的对话，页头的报纸按钮或 Alt S 打开；再按一次、Esc 或点浮层外面关闭。独立对话没有这个按钮。</p>
    <p class="ds-note">左栏工作站右边的简报按钮打开同一个浮层，位置贴着左栏。</p>
    <span class="ds-title" style="margin-top:8px">内容</span>
    <p class="ds-note">最近历史版本：工作站里导图、计划、日志最近的改动，点一行打开那一版。</p>
    <p class="ds-note">最近日志：本项目最近三条日志，点一行进入日志详情。</p>
    <p class="ds-note">底部：研究导图、打开工作站。</p>
  </div>
</div>'''
    card('ProjectSummary', 'group="对话" height=540 subtitle="项目置顶摘要：对话页头报纸按钮或 Alt S 打开的浮层，列最近历史版本和日志，底部去工作站"', body, '''
项目置顶摘要：项目对话里随时看一眼工作站的近况，不离开对话。

## 结构

- `ss-flyout`（320px，Popover 层级）：
  - `ss-flyout__head`：项目名和关闭；
  - 「最近历史版本」可折叠分组（`ss-list__group`），列工作站资源（导图、计划、日志）最近的改动；
  - `ss-flyout__group`「最近日志」：三条日志；
  - `ss-flyout__foot`：研究导图、打开工作站。
- 触发按钮：对话页头的 `newspaper` 图标，`aria-expanded` 跟着浮层开关，快捷键 Alt S。

## 交互

- 再点按钮、Esc、点浮层外面都会关闭；点到菜单或对话框里不算外面。
- 左栏「工作站简报」按钮打开同一个浮层，贴着左栏右侧弹出。
- 只有项目里的对话有这个按钮；独立对话没有。
''')


# ---------- 标题栏 ----------
def titlebar_card():
    view_menu = (item('layout-list', '全部对话', 'Ctrl Shift K') + item('box', '工作站') + item('file-pen', '编辑台') + SEP + item('sparkle', '全局助手')
                 + check('窗口置顶', True, 'pin') + SEP + check('显示滚动条', False) + check('简洁执行记录', True) + SEP + check('中文', True) + check('English', False))
    body = f'''<div class="ds" style="gap:16px">
  <div class="ds-col">
    <span class="ds-label">主窗口：标志、四个菜单、当前项目名、窗口置顶、最小化、最大化、关闭</span>
    <div class="ds-box" style="overflow:hidden">{titlebar(PROJECT)}</div>
  </div>
  <div class="ds-col">
    <span class="ds-label">窗口置顶打开：图钉变成主色并填充；提示改成「取消窗口置顶」</span>
    <div class="ds-box" style="overflow:hidden">{titlebar(PROJECT, pinned=True)}</div>
  </div>
  <div class="ds" style="grid-template-columns:auto 1fr;gap:24px;align-items:start;padding:0">
    <div class="ds-col">
      <span class="ds-label">「视图」菜单（窗口置顶也在这里，两处同步）</span>
      <div class="ss-menu" style="position:static;width:240px">{view_menu}</div>
    </div>
    <div class="ds-col" style="max-width:420px">
      <span class="ds-title">规则</span>
      <p class="ds-note">所有主窗口页面用同一个标题栏；编辑台窗口用自己的标题栏（文稿标签页），右边同样有窗口置顶。</p>
      <p class="ds-note">窗口置顶是设置（appearance.alwaysOnTop），重启后保留。</p>
      <p class="ds-note">右侧写当前项目名；不在项目里时不写。</p>
      <p class="ds-note">整条可以拖动窗口，按钮和菜单除外；双击最大化。</p>
    </div>
  </div>
</div>
''' + titlebar_menus(True)
    card('TitleBar', 'group="导航" height=520 subtitle="主窗口标题栏：菜单、当前项目、窗口置顶和窗口按钮；所有主窗口页面共用"', body, '''
主窗口标题栏，所有主窗口页面共用（build/shell/gen.py 生成）。

## 结构

- `ss-titlebar`：`ss-titlebar__brand`（矢量标志 + ScienceScope）、四个 `ss-titlebar__menu`（文件、编辑、视图、帮助）、`ss-titlebar__spacer`、`ss-titlebar__title`（当前项目名）、窗口置顶 `ss-winctl ss-winctl--pin`、最小化、最大化、关闭。
- 窗口置顶按钮用 `aria-pressed`；按下时图钉是主色并填充 `accent-soft`。

## 菜单

- 文件：新对话（Ctrl N）、独立快速对话（Ctrl Alt N）、新建项目；导出当前对话（Markdown）、导出项目快照。
- 编辑：查找当前对话（Ctrl F，只在对话页可用）、搜索与命令（Ctrl K）；复制选中文字。
- 视图：全部对话（Ctrl Shift K）、工作站、编辑台；全局助手、窗口置顶；显示滚动条、简洁执行记录；中文、English。
- 帮助：键盘快捷键、关于 ScienceScope。

## 规则

- 窗口置顶是设置，标题栏按钮和「视图」菜单两处同步，重启后保留。
- 编辑台窗口有自己的标题栏（文稿标签页），同样带窗口置顶。
''')


# ---------- 全局助手窗口 ----------
def assistant_card():
    projects = ''.join(list_row(n, '', '', icon='folder') for n in (PROJECT, '劳动保障政策演化'))
    body = f'''<div class="ds" style="grid-template-columns:400px 1fr;gap:28px;align-items:start">
  <div class="ss-assistant" style="height:640px">
    <div class="ss-panel__head" style="cursor:grab"><i data-i="sparkle" style="margin-right:6px;color:var(--accent)"></i><span class="ss-panel__title">全局助手</span>{icon_btn("minimize-2", "收起为悬浮球")}{icon_btn("x", "关闭助手")}</div>
    <div class="ss-content">
      <div style="padding:12px 16px 4px;display:grid;gap:8px">
        <div class="ss-section-title">最近项目</div>
        <div class="ss-list">{projects}</div>
        <div style="display:flex;gap:6px"><button class="ss-btn ss-btn--sm" type="button"><i data-i="box"></i>工作站</button><button class="ss-btn ss-btn--sm" type="button"><i data-i="book-open"></i>知识库</button><button class="ss-btn ss-btn--sm" type="button"><i data-i="folder-plus"></i>新建项目</button></div>
      </div>
      <div class="ss-thread" style="padding:12px 16px;gap:16px">
        <div class="ss-msg ss-msg--user"><div class="ss-msg__bubble">哪些项目还有待办？</div></div>
        <div class="ss-msg">
          <div class="ss-msg__head"><span class="ss-avatar"><i data-i="sparkle" class="ss-i--sm"></i></span><span class="ss-msg__name">全局助手</span><span class="ss-msg__role">deepseek-v4-flash</span></div>
          <div class="ss-act"><div class="ss-act__row"><i data-i="list-checks"></i><span class="ss-act__verb">读取全局计划</span><span class="ss-act__end">4 条</span></div></div>
          <div class="ss-msg__body"><p>还有 3 条没完成：</p><ul><li><b>{PROJECT}</b>：补齐 2021–2022 年面板数据（10-24 前）、第三章组态分析改写（10-26 前）。</li><li><b>劳动保障政策演化</b>：政策文本编码复核（10-28 前）。</li></ul></div>
        </div>
      </div>
    </div>
    <div class="ss-composer-wrap" style="padding:0 12px 12px">
      <div class="ss-composer">
        <textarea class="ss-composer__input" rows="1" placeholder="哪些项目还有待办？也可以指定项目查阅。" style="min-height:40px;padding:8px 12px 0"></textarea>
        <div class="ss-composer__bar">{icon_btn("plus", "添加文件或资料", sm=True)}<span class="ss-composer__spacer"></span><button class="ss-btn ss-btn--ghost ss-btn--sm" type="button">deepseek-v4-flash<i data-i="chevron-down"></i></button><button class="ss-send" type="button" aria-label="发送" disabled><i data-i="arrow-up"></i></button></div>
      </div>
    </div>
  </div>
  <div class="ds-col" style="gap:14px">
    <span class="ds-label">悬浮球（48px，桌面上始终在最前，可拖动）</span>
    <div style="display:flex;align-items:center;gap:20px">
      <button class="ss-orb" type="button" aria-label="展开或收起全局助手" data-ctx="#m-orb"><i data-logo></i></button>
      <div class="ss-menu" style="position:static;width:180px">{item("", "展开/收起助手")}{SEP}{item("", "退出助手")}</div>
    </div>
    <span class="ds-label">右键菜单是系统菜单：展开或收起、退出助手</span>
    <span class="ds-title" style="margin-top:8px">规则</span>
    <p class="ds-note">单击悬浮球展开或收起助手窗口；拖动超过 5px 才算移动，不触发展开。</p>
    <p class="ds-note">助手窗口没有系统标题栏，拖动面板头移动；「收起为悬浮球」只隐藏窗口，不清除历史，也不停止正在运行的任务，停止用输入框的停止按钮。</p>
    <p class="ds-note">启动时显示什么在设置的「桌面浮球与启动」里选：不打开、只显示浮球、显示浮球与助手对话；下次启动生效。</p>
    <p class="ds-note">主窗口里点左栏底部的 sparkle，在右侧面板打开同一个助手对话。</p>
  </div>
</div>
''' + menu('m-orb', item('', '展开/收起助手') + SEP + item('', '退出助手'))
    card('AssistantWindow', 'group="整页示例" height=700 subtitle="全局助手：桌面悬浮球和独立的小窗口；窗口顶部是最近项目和三个入口，下面是助手对话"', body, '''
全局助手的独立窗口和悬浮球。主窗口里同一个对话在右侧面板打开。

## 结构

- 悬浮球 `ss-orb`（48px 圆，矢量标志）：始终在其他窗口前面，可以拖动；单击展开或收起助手窗口；右键是系统菜单（展开/收起助手、退出助手）。
- 助手窗口 `ss-assistant`（无系统标题栏）：
  - 面板头：sparkle、「全局助手」、收起为悬浮球、关闭；拖动面板头移动窗口；
  - 最近项目（5 个）和三个入口：工作站、知识库、新建项目；
  - 助手对话：和对话页同样的消息和行动时间线；
  - 输入框：没有执行方式按钮，模型默认跟随全局助手设置。

## 规则

- 收起或关闭只隐藏窗口，不清除历史，也不停止正在运行的任务。
- 启动时显示什么在设置里选，下次启动生效。
''')


# ---------- left bar card ----------
def sidebar_card():
    body = f'''<div class="ds" style="grid-template-columns:auto 1fr;align-items:start;gap:24px">
  <div style="display:flex;height:700px;overflow:hidden;border:1px solid var(--line);border-radius:var(--r-md)">
      {sidebar(None, "文献综述框架讨论", "card-sidebar")}
  </div>
  <div class="ds-col" style="max-width:320px;padding-top:4px">
    <span class="ds-title">这一版改了什么</span>
    <p class="ds-note">所有主窗口页面现在用同一个左栏（build/shell/gen.py 生成），不再各页各写一份。</p>
    <p class="ds-note">「编辑台」放在工作站下面，小窗图标表示它在独立窗口打开；窗口已开时点它切过去。</p>
    <p class="ds-note">工作站右边的简报按钮打开工作站简报（和对话页头的项目置顶摘要同一个浮层）。</p>
    <p class="ds-note">「数据库」改名「知识库」，数字是收件箱里等你确认的记忆条数。</p>
    <p class="ds-note">对话行尾直接显示状态：转圈是运行中，「待批准」「失败」「排队」各有标记，没有状态时显示最后更新时间。折叠的项目里有对话在运行，项目行也转圈。</p>
    <p class="ds-note">每个项目先列最近 5 个对话，其余收进「还有 N 个」。列表末尾「全部对话」，含已归档的对话；在全部对话页时它是选中状态。</p>
    <p class="ds-note">底部是个人资料、全局助手、设置。</p>
    <span class="ds-title" style="margin-top:8px">试一试</span>
    <p class="ds-note">把「参考文献格式整理」拖到「劳动保障政策演化」上，会移入这个项目；菜单里的「移到项目…」也能移，还能移出项目。</p>
    <p class="ds-note">右键或悬停后点 ⋯ 打开同一份菜单。运行中的对话不能归档，菜单里写明原因。</p>
    <p class="ds-note">拖动右边缘调整宽度，双击恢复 248px。没有内容的分组整组隐藏。</p>
  </div>
</div>
''' + SIDE_MENUS
    meta = 'group="导航" height=732 subtitle="左侧栏：新对话、知识库、工作站（简报）、编辑台、搜索，置顶、项目树和独立对话，末尾全部对话；所有主窗口页面共用"'
    readme = (COMP / 'Sidebar' / 'README.md').read_text()
    readme = readme.replace('左侧栏：主导航（新对话、知识库、工作站）、搜索入口、置顶、项目树、独立对话和「全部对话」，宽度可以拖动。',
                            '左侧栏：主导航（新对话、知识库、工作站和它的简报按钮、编辑台）、搜索入口、置顶、项目树、独立对话和「全部对话」，宽度可以拖动。所有主窗口页面共用这一份（build/shell/gen.py 生成）。')
    readme = readme.replace('- 知识库导航的数字是收件箱里等确认的记忆条数，没有时不显示。',
                            '- 知识库导航的数字是收件箱里等确认的记忆条数，没有时不显示。\n'
                            '- 工作站一行是 `ss-nav-row`：右边的 `clipboard-list` 按钮打开工作站简报（ProjectSummary 同一个浮层），`aria-expanded` 跟着开关。\n'
                            '- 「编辑台」在工作站下面：`file-pen` 图标，行尾 `app-window` 小图标表示在独立窗口打开（DeskEntry ①）。\n'
                            '- 当前页面的导航项带 `aria-current="page"`；在全部对话页时 `ss-side-all` 也带。')
    card('Sidebar', meta, body, readme)


# ---------- PageHeader card: chat and workstation headers as built ----------
def fix_page_header():
    p = COMP / 'PageHeader' / 'preview.html'
    t = p.read_text()
    t = re.sub(r'<div class="ss-header__actions">.*?</div>', CHAT_ACTIONS.replace('data-menu="#m-chat"', 'data-menu="#m-head"'), t, count=1, flags=re.S)
    ws = re.search(r'(<div class="ss-header__title"><span>工作站</span></div>.*?)(\n    </div>\n  </div>)', t, re.S)
    t = t.replace(ws.group(1), '<div class="ss-header__title"><span>工作站</span></div>\n      ' + scope_select('#m-ws') + '\n      <div class="ss-header__actions"><button class="ss-btn ss-btn--ghost" type="button"><i data-i="git-fork"></i>版本树</button><button class="ss-btn" type="button"><i data-i="file-pen"></i>在编辑台打开</button>' + icon_btn('ellipsis', '更多') + '</div>')
    p.write_text(t)
    r = COMP / 'PageHeader' / 'README.md'
    rt = r.read_text()
    if '对话页头' not in rt:
        rt = rt.rstrip('\n') + '\n\n## 示例\n\n- 对话页头：查找（Ctrl F）、项目置顶摘要（Alt S，只在项目对话里）、任务秘书（Ctrl J），其余进 ⋯。\n- 工作站页头：项目选择；「版本树」「在编辑台打开」，其余进 ⋯。\n- 子页面：返回按钮在最左。\n'
        r.write_text(rt)


# ---------- remove automation from the gallery (removed 2026-10-18) ----------
def drop_automation():
    M = r'\s*<button class="ss-menu__item ss-menu__item--rich ss-menu__item--auto"[^\n]*</button>'
    edits = {
        'Button/preview.html': [(r'\s*<div class="ds-row">\s*<button class="ss-btn ss-btn--sm ss-btn--auto".*?</div>', '')],
        'Menu/preview.html': [(M, '')],
        'ModeMenu/preview.html': [(M, ''), (r'\s*<dt>自动化</dt><dd>[^<]*</dd>', ''), (r'\s*<button class="ss-btn ss-btn--auto ss-btn--sm"[^\n]*</button>', ''),
                                  ('三种执行方式：请求批准、常规、自动化；自动化统一用暗红色', '两种执行方式：请求批准（新对话默认）和常规'),
                                  ('试一试：选自动化，输入框会跟着变', '试一试：切换执行方式'), ('底栏里的三种触发按钮', '底栏里的两种触发按钮')],
        'Composer/preview.html': [(M, ''), (r'\s*<span class="ds-label">自动化：边框和执行方式变成暗红色</span>\s*<div class="ss-composer" data-mode="auto".*?\n  </div>', '')],
        'Callout/preview.html': [(r'\s*<div class="ss-callout ss-callout--auto">.*?\n  </div>', '')],
        'Badge/preview.html': [(r'<span class="ss-tag ss-tag--auto">.*?</span>', '')],
        'ModeMenu/README.md': [('在输入框底栏切换请求批准、常规、自动化三档；自动化统一用暗红色。', '在输入框底栏切换请求批准和常规两档。自动化已在 2026-10-18 取消。'),
                               (r'\n- 自动化一项再加 `ss-menu__item--auto`。', ''), (r'\n- 自动化（zap，`auto`）：[^\n]*', ''), (r'\n- `auto` 系列的颜色只给自动化用[^\n]*', '')],
        'Composer/README.md': [(r'\n*执行方式是自动化时，在 `ss-composer` 上加 `data-mode="auto"`[^\n]*', '')],
        'Badge/README.md': [('、`ss-tag--auto`', ''), (r'\n- `ss-tag--auto` 只表示自动化。[^\n]*', '')],
        'Button/README.md': [(r'\n- 自动化按钮 `ss-btn--auto`[^\n]*', '')],
        'Callout/README.md': [('、`--auto`', '')],
    }
    for path, subs in edits.items():
        p = COMP / path
        t = p.read_text()
        for a, b in subs:
            t = re.sub(a, b, t, flags=re.S)
        p.write_text(t)


def write_shell_part():
    # assemble.py builds PageInbox and PageSettings from parts; keep its shell the same.
    part = ROOT / 'docs/design/system/build/parts/shell_top.html'
    old = part.read_text()
    new = old[:old.find('<header')] + titlebar('') + old[old.find('</header>') + 9:]
    new = re.sub(r'<aside class="ss-sidebar">.*?</aside>', lambda m: sidebar('knowledge'), new, count=1, flags=re.S)
    part.write_text(new)


if __name__ == '__main__':
    write_shell_part()
    for name, (current, chat, title) in SWAP.items():
        swap(name, current, chat, title)
    fix_chat()
    drop_automation()
    fix_page_header()
    sidebar_card()
    titlebar_card()
    page_home()
    page_all()
    page_workbench()
    page_map()
    page_journal()
    project_summary()
    assistant_card()
