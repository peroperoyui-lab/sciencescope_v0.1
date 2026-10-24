# Builds the settings page mocks (P3 设置): every page the X-UI cards do not
# cover, plus the update prompt. Also rewrites the navigation in the older
# settings mocks so all of them share settings/nav.py.
# Run from the repository root: python3 -I docs/design/system/build/settings/gen.py
import pathlib, re, sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from nav import dialog, info, nav  # noqa: E402

BUILD = HERE.parent
PARTS = BUILD / 'parts'
COMP = BUILD.parent / 'project' / 'components'
background = (PARTS / 'shell_top.html').read_text() + (PARTS / 'settings_main.html').read_text() + (PARTS / 'shell_bottom.html').read_text()


def card(name, subtitle, body, group='整页示例', page=True, height=520):
    size = ' page height=900 width=1536' if page else f' height={height}'
    html = (f'<!-- @dsCard group="{group}"{size} subtitle="{subtitle}" -->\n<!doctype html>\n<html lang="zh-CN">\n'
            f'<head><meta charset="utf-8"><title>{name}</title></head>\n<body>\n' + body +
            '\n<script>window.SS && SS.mount(document.body)</script>\n</body>\n</html>\n')
    (COMP / name).mkdir(parents=True, exist_ok=True)
    (COMP / name / 'preview.html').write_text(html)


# ---------- small builders ----------

def row(label, control='', desc='', tip=''):
    d = f'<span class="ss-setting-row__desc">{desc}</span>' if desc else ''
    t = ' ' + info(tip) if tip else ''
    c = f'<div class="ss-setting-row__control">{control}</div>' if control else ''
    return (f'            <div class="ss-setting-row">\n              <div class="ss-setting-row__text">'
            f'<span class="ss-setting-row__label">{label}{t}</span>{d}</div>\n              {c}\n            </div>')


def section(title, body, tip='', extra='', count=None):
    t = ' ' + info(tip) if tip else ''
    n = f'<span class="ss-count">{count}</span>' if count is not None else ''
    return (f'          <section class="ss-setting-section">\n            <div class="ss-setting-section__head">'
            f'<h3 class="ss-setting-section__title">{title}{n}{t}</h3>{extra}</div>\n{body}\n          </section>')


def head(title, desc='', tip=''):
    t = ' ' + info(tip) if tip else ''
    d = f'\n          <p class="ss-settings__desc">{desc}</p>' if desc else ''
    return f'          <h2 class="ss-settings__title">{title}{t}</h2>{d}'


def switch(label, on=True):
    return f'<input class="ss-switch" type="checkbox" role="switch" aria-label="{label}"{" checked" if on else ""} />'


def seg(label, options, active, small=True):
    buttons = ''.join(f'<button type="button" aria-pressed="{"true" if o == active else "false"}">{o}</button>' for o in options)
    return f'<div class="ss-seg{" ss-seg--sm" if small else ""}" role="group" aria-label="{label}">{buttons}</div>'


def select(value, width=200, small=False, menu=''):
    m = f' aria-expanded="false" data-menu="{menu}"' if menu else ''
    return (f'<button class="ss-select{" ss-select--sm" if small else ""}" type="button" aria-haspopup="menu"{m} style="width:{width}px">'
            f'<span class="ss-select__value">{value}</span><i data-i="chevron-down"></i></button>')


def btn(label, icon='', kind='', small=False):
    cls = 'ss-btn' + (f' ss-btn--{kind}' if kind else '') + (' ss-btn--sm' if small else '')
    i = f'<i data-i="{icon}"></i>' if icon else ''
    return f'<button class="{cls}" type="button">{i}{label}</button>'


def saved(text='已保存'):
    return f'<span class="ss-kv__saved"><i data-i="check" class="ss-i--sm"></i>{text}</span>'


def page(name, active, subtitle, inner, overlays=''):
    card(name, subtitle, background + dialog(active, inner) + overlays)


# ---------- 通用 ----------
general = '\n'.join([
    head('通用', '改了立即生效。'),
    section('个人资料', '\n'.join([
        row('显示名称', '<span class="ss-input" style="width:240px"><input value="Yui" /></span>', '只在这台电脑上显示，不发给专家'),
        row('一句话介绍', '<span class="ss-input" style="width:320px"><input value="社会学，关注城市更新与社区记忆" /></span>',
            '写给自己看的，可以留空'),
    ])),
    section('使用', '\n'.join([
        row('界面语言', select('中文', 160), '只改界面文字，对话内容不变'),
        row('发送消息', seg('发送消息', ['Enter', 'Ctrl Enter'], 'Enter'), '另一种组合用来换行；Shift Enter 总是换行'),
        row('截图时隐藏窗口', switch('截图时隐藏窗口'), '用「添加 → 截图」时，先把 ScienceScope 藏起来'),
    ])),
    section('试用功能', '\n'.join([
        row('编辑台', switch('编辑台', False), '还在开发中。打开后，左栏「工作站」下面出现编辑台入口'),
    ]), tip='试用功能还没做完，可能会变。关掉后，已有的内容不会丢。'),
])
page('PageSettingsGeneral', '通用', '设置 → 通用：个人资料、语言、发送键、截图和试用功能；改了立即生效', general)

# ---------- 外观 ----------
preview = '''            <div class="ss-settings__preview" aria-label="预览">
              <div class="ss-msg"><div class="ss-msg__head"><span class="ss-avatar">主</span><span class="ss-msg__name">主专家</span><span class="ss-msg__role">16:20</span></div>
              <div class="ss-msg__body ss-prose"><p>三份访谈都提到「老街坊搬走以后，茶馆就散了」。可以把茶馆当作社区记忆的载体来写，先列出它在访谈里出现的场合。</p></div></div>
            </div>'''
appearance = '\n'.join([
    head('外观'),
    section('主题与字体', '\n'.join([
        row('主题', seg('主题', ['<i data-i="sun"></i>浅色', '<i data-i="moon"></i>深色', '<i data-i="monitor"></i>跟随系统'],
                       '<i data-i="monitor"></i>跟随系统', small=False)),
        row('界面字体', select('思源黑体（内置）', 200) + ' <button class="ss-linkbtn" type="button">读取本机字体</button>',
            '没有中文字形的字体会用替代字显示'),
        row('界面密度', seg('界面密度', ['标准', '紧凑'], '标准'), '只改左栏和设置的间距，不缩放对话文字'),
    ])),
    section('对话文字', '\n'.join([
        row('对话字号', select('14 px', 96, True)),
        row('对话行距', seg('对话行距', ['紧凑', '标准', '宽松'], '标准')),
        row('侧栏字号', select('14 px', 96, True), '左栏，以及右边的任务秘书和全局助手'),
        row('代码字号', select('14 px', 96, True), '只改消息里的代码块'),
        preview,
    ])),
    section('动效与滚动条', '\n'.join([
        row('减少过渡动画', switch('减少过渡动画', False), '系统里已经设置减弱动效时，这里自动打开'),
        row('始终显示滚动条', switch('始终显示滚动条', False), '关掉时，滚动条只在滚动时出现'),
    ])),
])
page('PageSettingsAppearance', '外观', '设置 → 外观：主题、字体、密度、对话文字和动效；下面有预览，改了立即看到', appearance)

# ---------- 快捷键 ----------
def key(label, combo, state=''):
    if state == 'rec':
        field = '<span class="ss-input ss-input--sm" data-focus style="width:180px"><input readonly placeholder="按下组合键…" /></span>'
    elif state == 'err':
        field = (f'<span class="ss-input ss-input--sm" data-invalid style="width:180px"><input readonly value="{combo}" /></span>')
    else:
        field = f'<span class="ss-input ss-input--sm" style="width:180px"><input readonly value="{combo}" /></span>'
    return field

fixed = ''.join(f'<div class="ss-list-row"><div class="ss-list-row__main"><span class="ss-list-row__title">{a}</span></div><span class="ss-kbd">{k}</span></div>'
                for a, k in [('发送消息', 'Enter'), ('停止回答、关闭弹层', 'Esc'), ('打开设置', 'Ctrl ,'), ('打开或关闭任务秘书', 'Ctrl J'),
                             ('重命名', 'F2'), ('返回', 'Alt ←'), ('项目置顶摘要', 'Alt S')])
shortcuts = '\n'.join([
    head('快捷键', '点一下输入框，再按组合键。只在 ScienceScope 窗口里有效。'),
    section('可以改的', '\n'.join([
        row('搜索与命令', key('', 'Ctrl K')),
        row('浏览全部', key('', 'Ctrl Shift K', 'rec')),
        row('新建项目内对话', key('', 'Ctrl F', 'err'),
            '<span class="ss-field__error"><i data-i="circle-alert" class="ss-i--sm"></i>Ctrl F 是查找，不能占用</span>'),
        row('独立新对话', key('', 'Ctrl Alt N')),
    ]), extra=btn('恢复默认', 'undo-2', 'ghost', True)),
    section('固定的', f'            <div class="ss-list">{fixed}</div>',
            tip='复制、粘贴、撤销、查找这些系统按键也保留，不能改。'),
])
page('PageSettingsShortcuts', '快捷键', '设置 → 快捷键：点一下再按组合键，冲突当场说明；固定的快捷键列在下面', shortcuts)

# ---------- 专家 ----------
def expert(avatar, name, role, model, skills, on=True, menu=True):
    sw = switch(f'启用 {name}', on) if menu else ''
    sub = f'{role} · {model}' + (f' · {skills} 个技能' if skills else '')
    m = '<button class="ss-icon-btn ss-icon-btn--sm" type="button" aria-label="更多" data-menu="#m-expert"><i data-i="ellipsis"></i></button>' if menu else ''
    return (f'<div class="ss-list-row ss-list-row--2{"" if on else " ss-list-row--done"}"><span class="ss-avatar">{avatar}</span>'
            f'<div class="ss-list-row__main"><span class="ss-list-row__title">{name}</span><span class="ss-list-row__sub">{sub}</span></div>'
            f'{sw}{m}<i data-i="chevron-right" class="ss-list-row__open"></i></div>')

experts = '\n'.join([
    head('专家', '点开一位专家，改名字、提示词、模型和技能。改了自动保存，下一轮发言生效。',
         tip='有序讨论时，选中的专家读同一份前文、各自作答，按这里的顺序显示；独立审核在最后核查。平时在输入框里用 @名字 请某位专家发言。'),
    section('主专家', f'            <div class="ss-list">{expert("主", "主专家", "统筹当前任务", "跟随对话", 1, menu=False)}</div>',
            tip='主专家负责统筹，一般不给它特定角色。'),
    section('参加讨论的专家', '\n'.join([
        f'            <div class="ss-list">{expert("方", "方法学家", "研究设计", "deepseek-v4-pro", 2)}{expert("史", "史料学者", "档案与文献考证", "跟随对话", 1)}{expert("统", "统计审稿人", "统计与数据", "deepseek-v4-pro", 0, on=False)}</div>',
        '            <div class="ss-callout ss-callout--warn" style="margin-top:8px"><i data-i="lightbulb"></i><div class="ss-callout__body">方法学家和统计审稿人用的是同一个模型。换成不同厂商的模型，观点更不容易雷同。</div></div>',
    ]), count=3, extra=btn('添加专家', 'plus', small=True)),
    section('独立审核', f'            <div class="ss-list">{expert("审", "审核人", "最后核查论证和引用", "deepseek-v4-pro", 1)}</div>',
            tip='只在有序讨论最后核查各位专家的回答，不参与作答。审核意见经你采纳才进入后面的对话。',
            extra=btn('添加审核', 'plus', 'ghost', True)),
])
expert_menu = '''
<div class="ss-menu" id="m-expert" hidden>
  <button class="ss-menu__item" type="button"><i data-i="arrow-up"></i>上移</button>
  <button class="ss-menu__item" type="button"><i data-i="arrow-down-up"></i>下移</button>
  <button class="ss-menu__item" type="button"><i data-i="copy"></i>复制一份</button>
  <div class="ss-menu__sep"></div>
  <button class="ss-menu__item ss-menu__item--danger" type="button"><i data-i="trash-2"></i>删除专家</button>
</div>'''
page('PageSettingsExperts', '专家', '设置 → 专家：主专家、参加讨论的专家和独立审核排成名册；开关即时生效，点开一位改详情', experts, expert_menu)

# ---------- 专家详情（主专家、专家、任务秘书、全局助手共用） ----------
prompt = ('你是方法学家，负责检查研究设计。\\n\\n关注：\\n- 问题和方法是否对得上\\n- 样本和资料来源是否说明清楚\\n'
          '- 结论有没有超出资料能支持的范围\\n\\n先指出最要紧的一处，再给出改法。')
history = ''.join(f'<div class="ss-list-row"><div class="ss-list-row__main"><span class="ss-list-row__title">{what}</span></div>'
                  f'<span class="ss-list-row__meta ss-list-row__meta--time">{when}</span>{act}</div>'
                  for what, when, act in [('改了提示词', '10-24 16:02', '<button class="ss-btn ss-btn--ghost ss-btn--sm" type="button">撤销</button>'),
                                          ('换了模型', '10-22 09:41', '<button class="ss-btn ss-btn--ghost ss-btn--sm" type="button">撤销</button>'),
                                          ('新建', '10-19 11:20', '')])
detail = '\n'.join([
    '          <button class="ss-linkbtn" type="button"><i data-i="chevron-left" class="ss-i--sm"></i>专家</button>',
    '          <h2 class="ss-settings__title" style="display:flex;align-items:center;gap:8px;margin-top:4px"><span class="ss-avatar ss-avatar--lg">方</span>方法学家 ' + saved('已保存 · 下一轮发言生效') + '</h2>',
    section('基本', '\n'.join([
        row('名称', '<span class="ss-input" style="width:240px"><input value="方法学家" /></span>'),
        row('职责标签', '<span class="ss-input" style="width:240px"><input value="研究设计" /></span>', '显示在名字旁边'),
        row('模型', select('deepseek-v4-pro', 240), '「跟随对话」就用输入框里选的模型'),
        row('默认思考强度', seg('默认思考强度', ['模型默认', '低', '中', '高'], '中'), '只列这个模型支持的档位'),
    ])),
    section('提示词', f'''            <textarea class="ss-textarea ss-textarea--tall" aria-label="提示词" style="width:100%;min-height:180px">{prompt.replace(chr(92) + 'n', chr(10))}</textarea>
            <p class="ss-field__hint">写清职责、关注点和检查清单。提示词不改变工具权限，那由对话的执行方式决定。</p>''',
            tip='停止输入一秒后自动保存，每次保存都能在下面撤销。'),
    section('绑定的技能', '''            <div class="ss-chips" style="padding:0">
              <span class="ss-chip"><i data-i="graduation-cap" class="ss-i--sm"></i><b>研究设计审查清单</b><button type="button" aria-label="取消绑定"><i data-i="x"></i></button></span>
              <span class="ss-chip"><i data-i="graduation-cap" class="ss-i--sm"></i><b>查资料并引用原文</b><button type="button" aria-label="取消绑定"><i data-i="x"></i></button></span>
              <button class="ss-btn ss-btn--ghost ss-btn--sm" type="button"><i data-i="plus"></i>添加</button>
            </div>''', tip='绑定的技能每轮发言前都会读；没绑定的技能也能按需使用。'),
    section('修改记录', f'            <div class="ss-list">{history}</div>', count=3),
])
page('PageSettingsExpertDetail', '专家', '设置 → 专家 → 一位专家：名称、模型、提示词、技能，自动保存，每次修改都能撤销；秘书和助手的角色也用这一页', detail)

# ---------- 任务秘书 ----------
def role_row(name, avatar, sub):
    return (f'            <div class="ss-list"><div class="ss-list-row ss-list-row--2"><span class="ss-avatar">{avatar}</span>'
            f'<div class="ss-list-row__main"><span class="ss-list-row__title">{name}</span><span class="ss-list-row__sub">{sub}</span></div>'
            f'<i data-i="chevron-right" class="ss-list-row__open"></i></div></div>')

secretary = '\n'.join([
    head('任务秘书', '每个对话一位任务秘书，整理纪要、跟进进度、起草下一步。'),
    section('角色', role_row('任务秘书', '秘', '提示词、模型和技能 · 跟随对话的模型')),
    section('什么时候整理纪要', '\n'.join([
        row('有序讨论结束后', switch('有序讨论结束后')),
        row('对话每多', switch('按消息数整理') + ' ' + select('20 条消息', 120, True)),
        row('内容每多', switch('按长度整理') + ' ' + select('约 3 万字', 120, True), '中文大约一个字算一个 token'),
        row('进入项目时', switch('进入项目时')),
        row('离开项目时', switch('离开项目时')),
    ]), tip='整理得越少，纪要后面接着的原文就越长；什么都不会被截掉。'),
    section('整理纪要时顺便更新', '\n'.join([
        row('研究导图', seg('研究导图', ['不更新', '直接更新'], '不更新')),
        row('计划', seg('计划', ['不更新', '直接更新'], '直接更新')),
        row('日志', seg('日志', ['不更新', '直接更新'], '直接更新')),
        row('稿件版本说明', seg('稿件版本说明', ['不更新', '直接更新'], '不更新')),
    ]), tip='直接更新只追加或标记，不改写你写的内容，每次都能撤销。'),
    section('记忆整理', '\n'.join([
        row('空闲时整理候选记忆', switch('空闲时整理候选记忆'), '整理出的记忆先进收件箱，你确认后才生效'),
        row('空闲多久后', select('10 分钟', 120, True)),
        row('整理用的模型', select('跟随任务秘书', 200), '会产生用量'),
        row('每次最多用', select('10 万 token', 120, True), '用完就停，下次接着整理'),
    ])),
    section('稿件版本说明模板', '''            <textarea class="ss-textarea" aria-label="稿件版本说明模板" style="width:100%;min-height:120px">## 比较对象
## 实际文件变化
## 秘书的解释：与当前研究的关系
## 待你决定的建议
## 相关导图节点与文件</textarea>''', tip='任务秘书写稿件版本说明时，按这几个标题分段。', extra='<button class="ss-linkbtn" type="button">恢复默认</button>'),
])
page('PageSettingsSecretary', '任务秘书', '设置 → 任务秘书：角色、整理纪要的时机、顺便更新工作站、记忆整理和版本说明模板；开关即时生效', secretary)

# ---------- 全局助手 ----------
assistant = '\n'.join([
    head('全局助手', '跨项目查阅和整理，可以独立成一个小窗口。'),
    section('角色', role_row('全局助手', '助', '提示词、模型和技能 · 跟随对话的模型')),
    section('窗口', '\n'.join([
        row('启动 ScienceScope 时', seg('启动时', ['不打开', '只显示浮球', '浮球和对话'], '只显示浮球'), '下次启动生效'),
        row('现在', btn('显示浮球', 'eye', small=True) + ' ' + btn('打开助手对话', 'message-square', small=True) + ' ' + btn('隐藏', 'eye-off', 'ghost', True),
            '隐藏只关窗口，不清记录，也不停止正在做的事'),
    ])),
])
page('PageSettingsAssistant', '全局助手', '设置 → 全局助手：角色和窗口；启动方式下次生效，现在就能显示或隐藏浮球', assistant)

# ---------- 执行与批准 ----------
def rule(tool, what, when):
    return (f'<div class="ss-list-row ss-list-row--2"><div class="ss-list-row__main"><span class="ss-list-row__title"><span class="ss-mono">{tool}</span> · {what}</span>'
            f'<span class="ss-list-row__sub">{when}</span></div><button class="ss-icon-btn ss-icon-btn--sm" type="button" aria-label="删除这条规则" data-tip="删除后，下次再问你"><i data-i="trash-2"></i></button></div>')

approvals = '\n'.join([
    head('执行与批准'),
    section('执行方式', '\n'.join([
        row('新对话默认', seg('新对话默认', ['请求批准', '常规'], '请求批准', small=False),
            '请求批准：运行命令、写项目文件夹、安装软件包之前先问你。常规：不问，直接执行，每一步都在时间线上看得见'),
    ]), tip='每个对话还能在输入框底栏单独切换，只对那个对话有效。'),
    section('总是允许的操作', '\n'.join([
        '            <p class="ss-settings__desc" style="margin:0 0 8px">在批准卡片上选「总是允许」后记在这里，只在当时的项目或对话里生效。删掉一条，下次就再问你。</p>',
        '            <div class="ss-list__group" aria-expanded="true"><i data-i="chevron-down"></i>项目「城市更新与社区记忆」</div>',
        f'            <div class="ss-list">{rule("shell", "以 git status 开头的命令", "10-21 添加")}{rule("python_env_install", "pandas", "10-22 添加")}{rule("mcp__zotero", "这个服务器的所有工具", "10-23 添加")}</div>',
        '            <div class="ss-list__group" aria-expanded="true"><i data-i="chevron-down"></i>独立对话「访谈转写整理」</div>',
        f'            <div class="ss-list">{rule("write_file", "写入 访谈/整理稿 文件夹", "10-24 添加")}</div>',
    ]), count=4),
])
page('PageSettingsApprovals', '执行与批准', '设置 → 执行与批准：新对话默认用哪种执行方式；总是允许的规则按项目分组，删掉就再问', approvals)

# ---------- 知识库与检索 ----------
knowledge = '\n'.join([
    head('知识库与检索'),
    section('本地混合检索', '\n'.join([
        '''            <div class="ss-callout ss-callout--ok"><i data-i="circle-check"></i><div class="ss-callout__body"><div class="ss-callout__title">混合检索就绪</div>模型 multilingual-e5-small · 已建索引 1,204 份资料</div></div>''',
        row('语义检索', switch('语义检索'), '按意思找资料，不只看字面；模型只在这台电脑上运行'),
        row('模型下载源', select('ModelScope（国内）', 200)),
        row('模型和索引', btn('下载或修复模型', 'download', small=True) + ' ' + btn('重新建立索引', 'refresh-cw', 'ghost', True), '重建索引不会改动资料原件'),
    ]), tip='第一次使用要先下载模型（约 120 MB）。对话进行时索引会暂停。模型或索引没准备好时，自动改用关键词检索。'),
    section('检索方式', '\n'.join([
        row('沿关系扩展', switch('沿关系扩展'), '顺着知识库里的关系多找几条：用词不同但讲同一件事的资料也能找到'),
    ])),
    section('论文卡片', '\n'.join([
        row('自动整理论文卡片', switch('自动整理论文卡片'), '新导入的文献各整理一张卡片：问题、方法、发现、局限'),
        row('整理用的模型', select('deepseek-v4.1-flash', 200), '每篇用一次，会产生用量'),
    ])),
])
page('PageSettingsKnowledge', '知识库与检索', '设置 → 知识库与检索：本地检索的状态和开关、沿关系扩展、论文卡片；状态写结果和下一步', knowledge)

# ---------- 编辑台 ----------
tiers = ''.join(f'<div class="ss-list-row"><i data-i="grip-vertical" class="ss-list-row__icon"></i><div class="ss-list-row__main"><span class="ss-list-row__title">{t}</span></div>'
                f'<button class="ss-icon-btn ss-icon-btn--sm" type="button" aria-label="重命名" data-tip="重命名" data-kbd="F2"><i data-i="pencil"></i></button></div>'
                for t in ['草稿', '内部审阅', '投稿', '修回', '终稿'])
desk = '\n'.join([
    head('编辑台', '编辑台还在试用，在「通用」里打开后这一页才出现。'),
    section('TeX 编译', '\n'.join([
        '''            <div class="ss-callout ss-callout--ok"><i data-i="circle-check"></i><div class="ss-callout__body">找到 MiKTeX：XeLaTeX、LuaLaTeX、pdfLaTeX 都能用</div></div>''',
        row('编译引擎', select('自动（按文稿选择）', 220), '文稿里写了 ctex 或 fontspec 时用 XeLaTeX，否则用 pdfLaTeX'),
        row('重新检查', btn('重新检查', 'refresh-cw', 'ghost', True), '装好或升级 TeX 以后点一下'),
    ]), tip='ScienceScope 不自带 TeX。没装时，tex 文稿照样能编辑，只是不能生成 PDF。'),
    section('稿件分级', f'            <div class="ss-list">{tiers}</div>', tip='版本树里给版本标的级别。拖动排序，改名后已有版本跟着改。'),
])
page('PageSettingsDesk', '编辑台', '设置 → 编辑台：TeX 找没找到、用哪个引擎；稿件分级的名称和顺序', desk)

desk_missing = '\n'.join([
    head('编辑台', '编辑台还在试用，在「通用」里打开后这一页才出现。'),
    section('TeX 编译', '\n'.join([
        '''            <div class="ss-callout ss-callout--warn"><i data-i="triangle-alert"></i><div class="ss-callout__body"><div class="ss-callout__title">没有找到 TeX</div>tex 文稿可以照常编辑，但不能生成 PDF。安装 MiKTeX 或 TeX Live 后点「重新检查」。</div><div class="ss-callout__actions">'''
        + btn('重新检查', 'refresh-cw', small=True) + '</div></div>',
        row('编译引擎', select('自动（按文稿选择）', 220), ''),
    ])),
])

# ---------- Python 环境 ----------
def env(name, meta, status, open_=False):
    return (f'<div class="ss-list-row ss-list-row--2"><i data-i="package" class="ss-list-row__icon"></i><div class="ss-list-row__main"><span class="ss-list-row__title">{name}</span>'
            f'<span class="ss-list-row__sub">{meta}</span></div>{status}<button class="ss-btn ss-btn--ghost ss-btn--sm" type="button">管理</button>'
            '<button class="ss-icon-btn ss-icon-btn--sm" type="button" aria-label="更多" data-menu="#m-env"><i data-i="ellipsis"></i></button></div>')

ready = '<span class="ss-provider__status"><span class="ss-dot ss-dot--ok"></span>就绪</span>'
python = '\n'.join([
    head('Python 环境', '专家做数据分析时用的 Python。系统里原有的 Python 不会被改动。'),
    section('新任务默认', row('默认环境', select('内置 · 科学分析', 240), '改了从下一轮发言开始用，对话记录不受影响')),
    section('环境', '\n'.join([
        f'            <div class="ss-list">{env("内置 · 科学分析", "Python 3.14 · 86 个包 · pandas、numpy、matplotlib 等", ready)}'
        f'{env("访谈文本分析", "Python 3.14 · 41 个包 · 2 个对话在用", ready)}'
        f'{env("地图可视化", "Python 3.13 · 安装到一半停了：geopandas 下载失败", "<span class=\"ss-provider__status ss-provider__status--danger\"><span class=\"ss-dot ss-dot--danger\"></span>部分安装</span><button class=\"ss-btn ss-btn--sm\" type=\"button\">重试</button>")}</div>',
    ]), count=3, extra=btn('新建环境', 'plus', small=True)),
    section('下载源', '\n'.join([
        row('软件包镜像', select('清华（国内）', 200, menu='#m-index'), '装软件包时从这里下载'),
        row('Python 下载源', select('官方', 200, menu='#m-pysrc'), '只在新建环境、需要下载 Python 本身时用'),
    ]), tip='内置了几个常用的源。学校或单位有自己的镜像时，在下拉框里选「添加自定义源」。'),
    section('空间', '\n'.join([
        row('共享缓存', btn('清理未用到的', 'trash-2', 'ghost', True), '1.4 GB，几个环境共用；清理只删没有环境在用的部分'),
        row('系统 Python', '', '3.12.4 · 只读取，不修改'),
    ])),
])
env_menu = '''
<div class="ss-menu" id="m-env" hidden>
  <button class="ss-menu__item" type="button"><i data-i="pencil"></i>重命名</button>
  <button class="ss-menu__item" type="button"><i data-i="copy"></i>复制成新环境</button>
  <button class="ss-menu__item" type="button"><i data-i="file-output"></i>导出清单</button>
  <div class="ss-menu__sep"></div>
  <button class="ss-menu__item ss-menu__item--danger" type="button"><i data-i="trash-2"></i>删除环境</button>
</div>'''
# 下载源：内置几个，用户可以添加、修改、删除自己的源
def source(name, url, checked=False, custom=False):
    tools = ('<span class="ss-menu__tools"><button class="ss-icon-btn ss-icon-btn--sm" type="button" aria-label="修改" data-tip="修改" data-dialog="#dlg-source-edit"><i data-i="pencil"></i></button>'
             '<button class="ss-icon-btn ss-icon-btn--sm" type="button" aria-label="删除" data-tip="删除"><i data-i="trash-2"></i></button></span>') if custom else ''
    return (f'<div class="ss-menu__item ss-menu__item--rich" role="menuitemradio" tabindex="-1" aria-checked="{"true" if checked else "false"}">'
            f'<span class="ss-menu__text"><span>{name}</span><span class="ss-menu__desc ss-mono">{url}</span></span>{tools}'
            '<i data-i="check" class="ss-menu__check"></i></div>')

def source_menu(id_, builtin, custom, static=False):
    attrs = ' data-static style="width:340px"' if static else f' id="{id_}" hidden style="width:340px"'
    items = ['  <div class="ss-menu__label">内置</div>'] + ['  ' + source(*b) for b in builtin]
    if custom:
        rows = [source(*c, custom=True) for c in custom]
        if static:  # show the hover tools on the first row the user added
            rows[0] = rows[0].replace('role="menuitemradio"', 'data-active role="menuitemradio"', 1)
        items += ['  <div class="ss-menu__sep"></div>', '  <div class="ss-menu__label">自己添加的</div>'] + ['  ' + r for r in rows]
    items += ['  <div class="ss-menu__sep"></div>',
              '  <button class="ss-menu__item" type="button" data-dialog="#dlg-source"><i data-i="plus"></i>添加自定义源…</button>']
    return f'<div class="ss-menu"{attrs}>\n' + '\n'.join(items) + '\n</div>'

index_builtin = [('官方 PyPI', 'https://pypi.org/simple'), ('清华（国内）', 'https://pypi.tuna.tsinghua.edu.cn/simple', True),
                 ('阿里云（国内）', 'https://mirrors.aliyun.com/pypi/simple')]
index_custom = [('学校镜像', 'https://mirrors.example.edu.cn/pypi/simple')]
py_builtin = [('官方', 'GitHub · python-build-standalone', True)]

def source_dialog(id_, title, name, url, hint, extra='', static=False, save='添加'):
    wrap_open = '' if static else f'<div class="ss-scrim" id="{id_}" hidden>\n'
    wrap_close = '' if static else '\n</div>'
    attrs = ' data-static style="width:440px"' if static else ' aria-modal="true"'
    return (wrap_open + f'''<div class="ss-dialog"{attrs} role="dialog" aria-label="{title}">
  <div class="ss-dialog__head"><h2 class="ss-dialog__title">{title}</h2><button class="ss-icon-btn" type="button" aria-label="关闭" data-tip="关闭" data-kbd="Esc" data-close><i data-i="x"></i></button></div>
  <div class="ss-dialog__body">
    <label class="ss-field"><span class="ss-field__label">名称</span><span class="ss-input"><input value="{name}" placeholder="例如 学校镜像" aria-label="名称" /></span></label>
    <label class="ss-field"><span class="ss-field__label">地址</span><span class="ss-input"><i data-i="link"></i><input class="ss-mono" value="{url}" placeholder="https://…/simple" aria-label="地址" /></span>{hint}</label>{extra}
  </div>
  <div class="ss-dialog__foot"><button class="ss-btn" type="button" data-close>取消</button><button class="ss-btn ss-btn--primary" type="button" data-close>{save}</button></div>
</div>''' + wrap_close)

add_hint = '<span class="ss-field__hint">填 pip 能用的索引地址，一般以 /simple 结尾。保存前会先试着连一下。</span>'
edit_error = '<span class="ss-field__error"><i data-i="circle-alert" class="ss-i--sm"></i>连不上这个地址（超时 10 秒）。请检查地址或网络；确定没错也可以仍然保存。</span>'
source_overlays = '\n'.join([
    source_menu('m-index', index_builtin, index_custom),
    source_menu('m-pysrc', py_builtin, []),
    source_dialog('dlg-source', '添加软件包镜像', '', '', add_hint),
    source_dialog('dlg-source-edit', '修改「学校镜像」', '学校镜像', 'https://mirrors.example.edu.cn/pypi/simple', add_hint, save='保存'),
])
page('PageSettingsPython', 'Python 环境', '设置 → Python 环境：默认环境、环境列表（状态和失败原因写在行里）、下载源和缓存；点「管理」看包，下载源可以添加自己的', python, env_menu + source_overlays)

picker = f'''<div class="ds" style="grid-template-columns:auto auto;justify-content:start;align-items:start;gap:24px">
  <div class="ds-col">
{source_menu('', index_builtin, index_custom, static=True)}
    <span class="ds-label">下拉框：内置的在上，自己添加的在下，悬停出现修改和删除</span>
  </div>
  <div class="ds-col">
{source_dialog('', '添加软件包镜像', '学校镜像', 'https://mirrors.example.edu.cn/pypi/simple', add_hint, static=True)}
    <span class="ds-label">添加：名称加地址，保存前试连一次</span>
{source_dialog('', '修改「学校镜像」', '学校镜像', 'https://mirrors.example.edu.cn/pypi/simpel', edit_error, static=True, save='仍然保存')}
    <span class="ds-label">连不上：原因写在地址下面，可以改地址，也可以仍然保存</span>
  </div>
</div>'''
card('SourcePicker', '下载源选择：内置几个常用源，用户可以添加、修改、删除自己的源；删掉正在用的源时退回内置默认', picker, group='输入', page=False, height=640)

pkgs = ''.join(f'<div class="ss-list-row"><div class="ss-list-row__main"><span class="ss-list-row__title ss-mono">{p}</span></div><span class="ss-list-row__meta">{v}</span></div>'
               for p, v in [('jieba', '0.42.1'), ('pandas', '2.3.3'), ('scikit-learn', '1.7.2'), ('spacy', '3.8.7'), ('wordcloud', '1.9.4')])
env_detail = '\n'.join([
    '          <button class="ss-linkbtn" type="button"><i data-i="chevron-left" class="ss-i--sm"></i>Python 环境</button>',
    '          <h2 class="ss-settings__title" style="margin-top:4px">访谈文本分析</h2>',
    '          <p class="ss-settings__desc">Python 3.14 · 41 个包 · 「访谈转写整理」等 2 个对话在用</p>',
    section('已安装', f'''            <span class="ss-input ss-input--sm" style="width:240px;margin-bottom:8px"><i data-i="search" class="ss-i--sm"></i><input placeholder="查找已安装的包" /></span>
            <div class="ss-list">{pkgs}</div>''', count=41, extra='<button class="ss-linkbtn" type="button">还有 36 个</button>'),
    section('添加或移除', '''            <textarea class="ss-textarea" aria-label="软件包清单" style="width:100%;min-height:96px" placeholder="每行一个包，可以写版本，例如 jieba==0.42.1"></textarea>
            <div class="ss-btn-group" style="margin-top:8px"><button class="ss-btn ss-btn--sm" type="button"><i data-i="download"></i>安装</button><button class="ss-btn ss-btn--ghost ss-btn--sm" type="button">移除</button><button class="ss-btn ss-btn--ghost ss-btn--sm" type="button">按清单同步</button></div>''',
            tip='「按清单同步」会让环境和清单完全一致：清单里没有的包会被移除。',
            extra='<button class="ss-btn ss-btn--ghost ss-btn--sm" type="button"><i data-i="import"></i>导入清单</button><button class="ss-btn ss-btn--ghost ss-btn--sm" type="button"><i data-i="file-output"></i>导出清单</button>'),
])
page('PageSettingsPythonEnv', 'Python 环境', '设置 → Python 环境 → 一个环境：查已装的包，按清单安装、移除或同步，导入导出 requirements.txt', env_detail)

# ---------- 数据与备份 ----------
def place(label, path, desc=''):
    d = f'<span class="ss-list-row__sub ss-mono">{path}</span>'
    return (f'<div class="ss-list-row ss-list-row--2"><i data-i="folder" class="ss-list-row__icon"></i><div class="ss-list-row__main"><span class="ss-list-row__title">{label}</span>{d}</div>'
            '<button class="ss-btn ss-btn--ghost ss-btn--sm" type="button"><i data-i="folder-open"></i>打开</button></div>')

data = '\n'.join([
    head('数据与备份', '所有内容都在安装目录的 data 文件夹里，卸载时默认保留。'),
    section('导出全部数据', '\n'.join([
        '            <p class="ss-settings__desc" style="margin:0 0 8px">对话、纪要、工作站、知识库、专家、技能和设置导成 Markdown 和 JSON，资料原件照原样复制，再附一份数据库副本。不含任何密钥。</p>',
        row('同时复制项目文件夹里的文件', switch('同时复制项目文件夹里的文件', False), '这些文件本来就在你的项目文件夹里，默认不重复复制'),
        row('导出到', btn('选择文件夹并导出', 'file-output', 'primary', True)),
        '''            <div class="ss-export" aria-live="polite">
              <div class="ss-export__head"><span class="ss-spin"></span><span>正在导出 · 12,480 / 40,083 个文件</span><span class="ss-toolbar__spacer"></span><button class="ss-btn ss-btn--ghost ss-btn--sm" type="button">取消</button></div>
              <div class="ss-progress" role="progressbar" aria-valuenow="31" aria-valuemin="0" aria-valuemax="100"><span class="ss-progress__bar" style="width:31%"></span></div>
              <span class="ss-field__hint">导出时可以照常对话。取消后留下的文件夹名字带「（未完成）」。</span>
            </div>''',
        '''            <div class="ss-callout ss-callout--ok" style="margin-top:8px"><i data-i="circle-check"></i><div class="ss-callout__body"><div class="ss-callout__title">已导出 40,083 个文件 · 81 MB</div><span class="ss-mono">D:\\备份\\ScienceScope 导出 2026-10-24 1530</span></div><div class="ss-callout__actions">'''
        + btn('打开文件夹', 'folder-open', small=True) + '</div></div>',
    ])),
    section('数据位置', f'            <div class="ss-list">{place("全部数据", "D:\\ScienceScope\\data")}{place("数据库与设置", "D:\\ScienceScope\\data\\sciencescope.sqlite")}{place("项目", "D:\\ScienceScope\\data\\projects")}{place("资料库原件", "D:\\ScienceScope\\data\\library")}</div>',
            tip='数据库保存对话、资料库、知识库和历史版本；用户会读会改的内容（工作站、纪要、专家定义、技能）存成文件。'),
    section('运行时', row('程序', '', 'ScienceScope 1.0.0-alpha · Node 22.22.2 · Windows x64')),
])
page('PageSettingsData', '数据与备份', '设置 → 数据与备份：全量导出（进行中和完成两种状态），数据位置，运行时', data)

# ---------- 关于（含检查更新） ----------
about = '\n'.join([
    '''          <div class="ss-about__head">
            <i data-logo class="ss-about__mark"></i>
            <div class="ss-about__name">ScienceScope</div>
            <div class="ss-about__version">1.0.0-alpha.1</div>
            <div class="ss-about__text">本地学术研究助手：几位 AI 专家和你一起读文献、做分析、写论文。</div>
          </div>''',
    section('更新', '\n'.join([
        '''            <div class="ss-callout"><i data-i="download"></i><div class="ss-callout__body"><div class="ss-callout__title">有新版本 1.0.0-alpha.2</div>10-24 发布 · 修好了导出时偶尔卡住的问题，更新提示更清楚。<button class="ss-linkbtn" type="button">查看全部说明</button></div><div class="ss-callout__actions">'''
        + btn('更新并重启', 'refresh-cw', 'primary', True) + '</div></div>',
        row('自动检查更新', switch('自动检查更新'), '每天最多检查一次，有新版本时提示你，不会自己安装'),
        row('上次检查', btn('立即检查', 'refresh-cw', 'ghost', True), '10-24 16:20'),
    ])),
    section('关于', '\n'.join([
        row('发布者', '', 'peroperoyui'),
        row('参与开发', '', 'Codex（AI 辅助开发）、Claude（Anthropic，AI 辅助审阅与开发）'),
        row('许可证', btn('第三方声明', small=True), 'MIT；随附的第三方软件各有自己的许可证'),
    ])),
])
page('PageSettingsAbout', '关于', '设置 → 关于：版本和检查更新（有新版本时一条说明加「更新并重启」），署名和许可证', about)

# ---------- 更新提示（主窗口） ----------
update = '''<div class="ds" style="display:grid;gap:16px;max-width:560px">
  <div class="ss-toast" role="status"><i data-i="download"></i><div class="ss-toast__body"><b>有新版本 1.0.0-alpha.2</b><span>修好了导出时偶尔卡住的问题。</span></div>
    <button class="ss-btn ss-btn--ghost ss-btn--sm" type="button">查看说明</button><button class="ss-btn ss-btn--primary ss-btn--sm" type="button">更新并重启</button>
    <button class="ss-icon-btn ss-icon-btn--sm" type="button" aria-label="稍后" data-tip="稍后再说"><i data-i="x"></i></button></div>
  <div class="ss-toast" role="status"><span class="ss-spin"></span><div class="ss-toast__body"><b>正在下载更新 · 32 / 94 MB</b><div class="ss-progress"><span class="ss-progress__bar" style="width:34%"></span></div></div></div>
  <div class="ss-toast" role="status"><span class="ss-spin"></span><div class="ss-toast__body"><b>正在保存数据并关闭…</b><span>安装完会自动重新打开，大约一两分钟。</span></div></div>
  <div class="ss-toast" role="alert"><i data-i="circle-alert" style="color:var(--danger)"></i><div class="ss-toast__body"><b>更新没有完成，当前版本没有改动</b><span>下载中断了。请检查网络后重试。</span></div>
    <button class="ss-btn ss-btn--sm" type="button">重试</button></div>
  <p class="ds-note">启动后自动检查（每天最多一次），有新版本时在右下角提示一次，关掉就不再打扰，到「设置 → 关于」还能更新。下载和校验在后台，期间照常使用；只有点「更新并重启」后才关闭程序。</p>
</div>'''
card('UpdatePrompt', '更新提示：右下角一条，写版本和一句说明；下载进度、关闭前提示、失败原因各一种状态', update, group='反馈', page=False)

# ---------- 旧的设置稿换上同一套导航 ----------
NAV_RE = re.compile(r'<nav class="ss-settings__nav".*?</nav>', re.S)
for name, active in [('PageSettings', '模型与服务商'), ('PageSettingsTools', '工具'), ('PageSettingsSkills', '技能'), ('PageSettingsMcp', 'MCP 服务器')]:
    file = COMP / name / 'preview.html'
    file.write_text(NAV_RE.sub(lambda _: nav(active), file.read_text(), count=1))
part = PARTS / 'settings_dialog.html'
part.write_text(NAV_RE.sub(lambda _: nav('模型与服务商'), part.read_text(), count=1))
print('ok')
