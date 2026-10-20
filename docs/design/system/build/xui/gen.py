# Builds the X-UI gallery cards: three settings pages and one parts card.
# Run from docs/design/system/build: python3 -I xui/gen.py <repo root>
import sys, pathlib
ROOT = pathlib.Path(sys.argv[1])
PARTS = ROOT / 'docs/design/system/build/parts'
COMP = ROOT / 'docs/design/system/project/components'
background = (PARTS / 'shell_top.html').read_text() + (PARTS / 'settings_main.html').read_text() + (PARTS / 'shell_bottom.html').read_text()

def info(tip):
    return f'<button class="ss-info" type="button" aria-label="说明" data-tip="{tip}"><i data-i="info"></i></button>'

NAV = [('settings', '通用'), ('palette', '外观'), ('plug', '模型与服务商'), ('shield-check', '执行与批准'), ('users', '专家'),
       ('wrench', '工具'), ('graduation-cap', '技能'), ('server', 'MCP 服务器'), ('database', '数据与运行环境'), ('keyboard', '快捷键')]

def dialog(active, inner):
    items = ''.join(
        f'<button class="ss-nav-item" type="button"{" aria-current=\"page\"" if label == active else ""}><i data-i="{icon}"></i><span class="ss-nav-item__label">{label}</span></button>\n        '
        for icon, label in NAV)
    return f'''
<div class="ss-scrim" id="dlg-settings">
  <div class="ss-dialog ss-dialog--settings" role="dialog" aria-modal="true" aria-label="设置">
    <button class="ss-icon-btn ss-settings__close" type="button" aria-label="关闭" data-tip="关闭" data-kbd="Esc" data-close><i data-i="x"></i></button>
    <div class="ss-settings">
      <nav class="ss-settings__nav" aria-label="设置分类">
        <div class="ss-settings__navtitle">设置</div>
        {items}<div class="ss-settings__navsep"></div>
        <button class="ss-nav-item" type="button"><i data-i="info"></i><span class="ss-nav-item__label">关于</span><span class="ss-nav-item__end">1.0.0-alpha</span></button>
      </nav>
      <div class="ss-settings__content">
        <div class="ss-settings__inner">
{inner}
        </div>
      </div>
    </div>
  </div>
</div>
'''

def card(name, meta, body):
    html = (f'<!-- @dsCard {meta} -->\n<!doctype html>\n<html lang="zh-CN">\n<head><meta charset="utf-8"><title>{name}</title></head>\n<body>\n'
            + body + '\n<script>window.SS && SS.mount(document.body)</script>\n</body>\n</html>\n')
    (COMP / name).mkdir(parents=True, exist_ok=True)
    (COMP / name / 'preview.html').write_text(html)

ASK = '<span class="ss-tag"><i data-i="shield-question-mark"></i>会先问</span>'

def tool(name, desc, ask=False, switch=None, off=False):
    end = (ASK if ask else '')
    if switch is not None:
        end += f'<input class="ss-switch" type="checkbox" role="switch" aria-label="启用 {name}"{" checked" if switch else ""} />'
    cls = 'ss-list-row ss-list-row--2' + (' ss-list-row--done' if off else '')
    return f'<div class="{cls}"><div class="ss-list-row__main"><span class="ss-list-row__title ss-mono">{name}</span><span class="ss-list-row__sub">{desc}</span></div>{end}</div>'

def section(title, count, rows, head_extra=''):
    return f'''          <section class="ss-setting-section">
            <div class="ss-setting-section__head"><h3 class="ss-setting-section__title">{title}<span class="ss-count">{count}</span></h3>{head_extra}</div>
            <div class="ss-list">{''.join(rows)}</div>
          </section>'''

# ---------- Tools page ----------
tools_inner = f'''          <h2 class="ss-settings__title">工具 {info("专家、秘书和全局助手共用这一套工具，每次发言时随请求发给模型。内置和 ScienceScope 自己的工具不能关；MCP 服务器的工具可以逐个停用。")}</h2>
          <p class="ss-settings__desc">共 29 个工具。在「请求批准」下，标「会先问」的工具调用前先问你。</p>
          <div class="ss-toolbar" style="margin-top:12px;padding:0">
            <span class="ss-input ss-input--sm" style="width:240px"><i data-i="search" class="ss-i--sm"></i><input placeholder="搜索工具" /></span>
            <span class="ss-toolbar__spacer"></span>
            <div class="ss-seg ss-seg--sm" role="group" aria-label="显示"><button type="button" aria-pressed="true">全部</button><button type="button" aria-pressed="false">会先问</button><button type="button" aria-pressed="false">已停用</button></div>
          </div>
{section("内置", 8, [
    tool("shell", "在工作文件夹里运行命令（Windows 用 PowerShell）", ask=True),
    tool("read_file", "读取文本文件，可以按行读"),
    tool("write_file", "新建或覆盖文本文件", ask=True),
    tool("edit_file", "替换文件里的一处文字", ask=True),
    tool("list_files", "按通配符列出文件"),
    tool("grep_files", "用正则表达式搜索文件内容"),
    tool("web_fetch", "读取网页的文字"),
    tool("view_image", "查看图片或 PDF 某一页，可以放大局部"),
])}
{section("ScienceScope", 10, [
    tool("research_search", "在资料库里按关键词检索段落和条目"),
    tool("research_read", "读资料原文，保留页码和章节"),
    tool("workspace_read", "读项目、对话、纪要、计划、导图、日志"),
    tool("workspace_edit", "修改计划、导图、日志、纪要和笔记，留历史版本"),
    tool("workspace_present", "把生成的文件交付到回答下方"),
    tool("python_env_install", "往对话的 Python 环境里装包", ask=True),
], head_extra='<button class="ss-linkbtn" type="button" data-toggle="next">还有 4 个</button>')}
{section("技能", 1, [
    tool("use_skill", "读取一个技能的正文并照着做；现有 6 个技能，在「技能」页管理"),
], head_extra='<button class="ss-btn ss-btn--ghost ss-btn--sm" type="button"><i data-i="graduation-cap"></i>管理技能</button>')}
{section("Zotero", 8, [
    tool("search_items", "Search your Zotero library by title, author or tag", ask=True, switch=True),
    tool("get_item_fulltext", "Get the full text of an item", ask=True, switch=True),
    tool("add_note", "Add a note to an item", ask=True, switch=False, off=True),
], head_extra='<span class="ss-provider__status"><span class="ss-dot ss-dot--ok"></span>MCP · 已连接</span><button class="ss-linkbtn" type="button">还有 5 个</button>')}
{section("Time", 2, [
    tool("get_current_time", "Get current time in a specific timezone", ask=True, switch=True),
    tool("convert_time", "Convert time between timezones", ask=True, switch=True),
], head_extra='<span class="ss-provider__status"><span class="ss-dot ss-dot--ok"></span>MCP · 已连接</span>')}'''

card('PageSettingsTools', 'group="整页示例" page height=900 width=1536 subtitle="设置 → 工具：按来源列出所有角色共用的工具，标出哪些会先问；MCP 工具可以逐个停用"',
     background + dialog('工具', tools_inner))

# ---------- Skills page ----------
def skill(title, name, desc, tags='', switch=True, menu='#m-skill'):
    sw = f'<input class="ss-switch" type="checkbox" role="switch" aria-label="启用 {title}"{" checked" if switch else ""} />'
    cls = 'ss-list-row ss-list-row--2' + ('' if switch else ' ss-list-row--done')
    return (f'<div class="{cls}" data-dialog="#dlg-skill"><i data-i="graduation-cap" class="ss-list-row__icon"></i><div class="ss-list-row__main"><span class="ss-list-row__title">{title}</span>'
            f'<span class="ss-list-row__sub"><span class="ss-mono">{name}</span> · {desc}</span></div>{tags}{sw}'
            f'<span class="ss-list-row__actions"><button class="ss-icon-btn ss-icon-btn--sm" type="button" aria-label="更多" data-menu="{menu}"><i data-i="ellipsis"></i></button></span></div>')

broken = ('<div class="ss-list-row ss-list-row--2"><span class="ss-dot ss-dot--danger" style="margin:0 4px"></span><div class="ss-list-row__main"><span class="ss-list-row__title ss-mono">review-format</span>'
          '<span class="ss-list-row__sub" style="color:var(--danger)">SKILL.md 的 YAML 头需要 name 和 description，修好后自动出现</span></div>'
          '<button class="ss-btn ss-btn--ghost ss-btn--sm" type="button"><i data-i="folder-open"></i>打开文件夹</button></div>')

skills_inner = f'''          <h2 class="ss-settings__title">技能 {info("技能是一份写给 AI 的做事说明（SKILL.md 文件夹，可以带参考文件和脚本），格式和 Claude、Codex 通用。所有角色都能用：AI 平时只看到名称和一句说明，用到时才读正文。也可以在「专家」里给某位专家绑定，它每次开口前就读好。")}</h2>
          <p class="ss-settings__desc">4 个内置、2 个你导入的。停用的技能不会出现在 AI 的技能目录里。</p>
          <section class="ss-setting-section">
            <div class="ss-setting-section__head"><h3 class="ss-setting-section__title">你导入的<span class="ss-count">2</span></h3>
              <button class="ss-btn ss-btn--ghost ss-btn--sm" type="button"><i data-i="folder-open"></i>打开技能文件夹</button>
              <button class="ss-btn ss-btn--sm" type="button" aria-haspopup="menu" data-menu="#m-import"><i data-i="import"></i>导入技能<i data-i="chevron-down"></i></button></div>
            <div class="ss-list">
              {skill("统计审稿清单", "stats-review", "按清单检查样本量、多重比较、效应量和可复现性", tags='<span class="ss-tag"><i data-i="users"></i>统计审稿人</span>', menu='#m-skill-user')}
              {broken}
            </div>
          </section>
          <section class="ss-setting-section">
            <div class="ss-setting-section__head"><h3 class="ss-setting-section__title">内置<span class="ss-count">4</span></h3></div>
            <div class="ss-list">
              {skill("查资料并引用原文", "cite-sources", "在资料库里检索、读原段落、按原文引用并标出处")}
              {skill("修改工作区并留版本", "edit-workspace", "读写导图、计划、日志、纪要和笔记，改错时撤销或恢复")}
              {skill("交付文件", "deliver-files", "生成图表、表格、文稿，交给用户并在回答里显示", tags='<span class="ss-tag ss-tag--ok">用的是你的副本</span>', menu='#m-skill-copied')}
              {skill("用 Python 分析数据", "python-analysis", "确认环境、装缺的包、写脚本运行、看结果和图", switch=False)}
            </div>
          </section>'''

skill_overlays = '''
<div class="ss-menu" id="m-import" hidden>
  <button class="ss-menu__item" type="button"><i data-i="folder"></i>从文件夹导入…</button>
  <button class="ss-menu__item" type="button"><i data-i="archive"></i>从 ZIP 导入…</button>
</div>
<div class="ss-menu" id="m-skill" hidden>
  <button class="ss-menu__item" type="button"><i data-i="eye"></i>查看正文</button>
  <button class="ss-menu__item" type="button"><i data-i="copy"></i>复制一份来修改</button>
</div>
<div class="ss-menu" id="m-skill-copied" hidden>
  <button class="ss-menu__item" type="button"><i data-i="eye"></i>查看正文</button>
  <button class="ss-menu__item" type="button"><i data-i="folder-open"></i>打开我的副本</button>
  <div class="ss-menu__sep"></div>
  <button class="ss-menu__item ss-menu__item--danger" type="button"><i data-i="undo-2"></i>删除副本，恢复内置</button>
</div>
<div class="ss-menu" id="m-skill-user" hidden>
  <button class="ss-menu__item" type="button"><i data-i="eye"></i>查看正文</button>
  <button class="ss-menu__item" type="button"><i data-i="folder-open"></i>打开文件夹</button>
  <div class="ss-menu__sep"></div>
  <button class="ss-menu__item ss-menu__item--danger" type="button"><i data-i="trash-2"></i>删除</button>
</div>
<div class="ss-scrim" id="dlg-skill" hidden>
  <div class="ss-dialog ss-dialog--lg" role="dialog" aria-modal="true" aria-labelledby="dlg-skill-title">
    <div class="ss-dialog__head"><h2 class="ss-dialog__title" id="dlg-skill-title">查资料并引用原文</h2><span class="ss-tag">内置</span><button class="ss-icon-btn" type="button" aria-label="关闭" data-close><i data-i="x"></i></button></div>
    <div class="ss-dialog__body" style="display:grid;gap:12px">
      <dl class="ss-props"><dt>名称</dt><dd class="ss-mono">cite-sources</dd><dt>说明</dt><dd>查资料并引用原文：在资料库里检索、读原段落、按原文引用并标出处。</dd><dt>位置</dt><dd class="ss-mono">app\\resources\\skills\\cite-sources</dd></dl>
      <div class="ss-prose" style="max-height:280px;overflow:auto;border-top:1px solid var(--line);padding-top:12px">
        <h3>查资料并引用原文</h3><p>引用必须能被用户核查：每个出处都指向你读过的原文段落，不凭记忆或检索摘要下结论。</p>
        <h4>步骤</h4><ol><li><b>检索。</b>用 <code>research_search</code> 查当前项目和个人资料，换两三个说法再查……</li><li><b>读原文。</b>引用前用 <code>research_read</code> 读它……</li></ol>
      </div>
    </div>
    <div class="ss-dialog__foot"><span class="ss-muted" style="font-size:12px;margin-right:auto">内置技能不能直接改，复制一份后改副本</span><button class="ss-btn" type="button"><i data-i="copy"></i>复制一份来修改</button><button class="ss-btn ss-btn--primary" type="button" data-close>关闭</button></div>
  </div>
</div>
'''
card('PageSettingsSkills', 'group="整页示例" page height=900 width=1536 subtitle="设置 → 技能：导入 SKILL.md 文件夹或 ZIP，开关、看正文；内置的复制后再改，坏掉的写明原因"',
     background + dialog('技能', skills_inner) + skill_overlays)

# ---------- MCP page ----------
def server(mark, name, meta, status, actions, switch=True, menu='#m-server', error=''):
    sw = f'<input class="ss-switch" type="checkbox" role="switch" aria-label="启用 {name}"{" checked" if switch else ""} />'
    return f'''            <div class="ss-provider">
              <div class="ss-provider__head">
                <span class="ss-preset__mark ss-preset__mark--sm">{mark}</span>
                <div class="ss-provider__main"><span class="ss-provider__name">{name}</span><span class="ss-provider__meta">{meta}</span></div>
                {status}
                {actions}
                {sw}
                <button class="ss-icon-btn ss-icon-btn--sm" type="button" aria-label="更多" data-menu="{menu}"><i data-i="ellipsis"></i></button>
              </div>{f'<div class="ss-provider__error"><i data-i="circle-alert" class="ss-i--sm"></i>{error}</div>' if error else ''}
            </div>'''

ok = lambda n: f'<span class="ss-provider__status"><span class="ss-dot ss-dot--ok"></span>已连接 · {n} 个工具</span>'
mcp_inner = f'''          <h2 class="ss-settings__title">MCP 服务器 {info("MCP 是让 AI 使用外部程序的通用接口，例如 Zotero、数据库、网页抓取。添加后它的工具出现在「工具」页，所有角色都能用。在「请求批准」下每次调用前先问你，可以在批准卡片上选「总是允许 → 这个服务器的所有工具」。")}</h2>
          <p class="ss-settings__desc">3 个已连接，共 13 个工具；1 个连接失败。</p>
          <section class="ss-setting-section">
            <div class="ss-setting-section__head"><h3 class="ss-setting-section__title">服务器<span class="ss-count">4</span></h3>
              <button class="ss-btn ss-btn--ghost ss-btn--sm" type="button" data-dialog="#dlg-paste"><i data-i="clipboard-paste"></i>粘贴配置</button>
              <button class="ss-btn ss-btn--sm" type="button" data-dialog="#dlg-server"><i data-i="plus"></i>添加服务器</button></div>
{server("Zo", "Zotero", '本地命令 · <span class="ss-mono">npx -y zotero-mcp</span>', ok(8), '<button class="ss-btn ss-btn--ghost ss-btn--sm" type="button">查看工具</button>')}
{server("Ti", "Time", '本地命令 · <span class="ss-mono">uvx mcp-server-time</span>', ok(2), '<button class="ss-btn ss-btn--ghost ss-btn--sm" type="button">查看工具</button>')}
{server("Fe", "网页抓取", '网址 · <span class="ss-mono">https://mcp.example.org/mcp</span>', '<span class="ss-provider__status ss-provider__status--danger"><span class="ss-dot ss-dot--danger"></span>连接失败</span>', '<button class="ss-btn ss-btn--sm" type="button" data-dialog="#dlg-server">编辑</button><button class="ss-btn ss-btn--sm" type="button">重新连接</button>', error='服务器要求登录（401）。请在「编辑」里检查请求头 Authorization 的密钥。')}
{server("Pu", "PubMed", '本地命令 · <span class="ss-mono">uvx pubmed-mcp</span>', '<span class="ss-provider__status"><span class="ss-dot ss-dot--ring"></span>已停用</span>', '', switch=False)}
          </section>
          <section class="ss-setting-section">
            <div class="ss-setting-section__head"><h3 class="ss-setting-section__title">下载源</h3></div>
            <div class="ss-setting-row">
              <div class="ss-setting-row__text"><span class="ss-setting-row__label">npx 下载源</span><span class="ss-setting-row__desc">用 npx 启动的服务器从这里下载；uvx 用「数据与运行环境」里的 Python 下载源</span></div>
              <div class="ss-setting-row__control"><button class="ss-select" type="button" aria-haspopup="menu" data-menu="#m-registry" style="width:240px"><span class="ss-select__value" data-slot="value">npmmirror（国内镜像）</span><i data-i="chevron-down"></i></button></div>
            </div>
          </section>'''

mcp_overlays = '''
<div class="ss-menu" id="m-server" hidden>
  <button class="ss-menu__item" type="button"><i data-i="pencil"></i>编辑</button>
  <button class="ss-menu__item" type="button"><i data-i="refresh-cw"></i>重新连接</button>
  <button class="ss-menu__item" type="button"><i data-i="wrench"></i>查看工具</button>
  <div class="ss-menu__sep"></div>
  <button class="ss-menu__item ss-menu__item--danger" type="button"><i data-i="trash-2"></i>删除服务器</button>
</div>
<div class="ss-menu" id="m-registry" hidden>
  <button class="ss-menu__item" role="menuitemradio" aria-checked="true" data-label="npmmirror（国内镜像）" type="button">npmmirror（国内镜像）<i data-i="check" class="ss-menu__check"></i></button>
  <button class="ss-menu__item" role="menuitemradio" aria-checked="false" data-label="npm 官方" type="button">npm 官方<i data-i="check" class="ss-menu__check"></i></button>
  <button class="ss-menu__item" role="menuitemradio" aria-checked="false" data-label="自定义…" type="button">自定义…<i data-i="check" class="ss-menu__check"></i></button>
</div>
''' + (pathlib.Path(__file__).parent / 'dialogs.html').read_text()
card('PageSettingsMcp', 'group="整页示例" page height=900 width=1536 subtitle="设置 → MCP 服务器：填表或粘贴配置添加，添加后立即连接；状态写明工具数或失败原因"',
     background + dialog('MCP 服务器', mcp_inner) + mcp_overlays)
print('ok')
