# The settings window frame shared by every settings mock: grouped navigation
# on the left, content on the right. Used by settings/gen.py and xui/gen.py.

GROUPS = [
    ('个人', [('settings', '通用'), ('palette', '外观'), ('keyboard', '快捷键')]),
    ('研究协作', [('plug', '模型与服务商'), ('users', '专家'), ('clipboard-list', '任务秘书'),
                ('sparkle', '全局助手'), ('shield-check', '执行与批准')]),
    ('工具', [('wrench', '工具'), ('graduation-cap', '技能'), ('server', 'MCP 服务器')]),
    ('资料与环境', [('book-open', '知识库与检索'), ('app-window', '编辑台'), ('package', 'Python 环境'),
                 ('database', '数据与备份')]),
]


def info(tip):
    return f'<button class="ss-info" type="button" aria-label="说明" data-tip="{tip}"><i data-i="info"></i></button>'


def nav(active):
    items = []
    for group, entries in GROUPS:
        items.append(f'<div class="ss-settings__navgroup">{group}</div>')
        for icon, label in entries:
            current = ' aria-current="page"' if label == active else ''
            items.append(f'<button class="ss-nav-item" type="button"{current}><i data-i="{icon}"></i>'
                         f'<span class="ss-nav-item__label">{label}</span></button>')
    current = ' aria-current="page"' if active == '关于' else ''
    items.append('<div class="ss-settings__navsep"></div>')
    items.append(f'<button class="ss-nav-item" type="button"{current}><i data-i="info"></i>'
                 '<span class="ss-nav-item__label">关于</span><span class="ss-nav-item__end">1.0.0-alpha</span></button>')
    return ('<nav class="ss-settings__nav" aria-label="设置分类">\n        <div class="ss-settings__navtitle">设置</div>\n        '
            + '\n        '.join(items) + '\n      </nav>')


def dialog(active, inner):
    return f'''
<div class="ss-scrim" id="dlg-settings">
  <div class="ss-dialog ss-dialog--settings" role="dialog" aria-modal="true" aria-label="设置">
    <button class="ss-icon-btn ss-settings__close" type="button" aria-label="关闭" data-tip="关闭" data-kbd="Esc" data-close><i data-i="x"></i></button>
    <div class="ss-settings">
      {nav(active)}
      <div class="ss-settings__content">
        <div class="ss-settings__inner">
{inner}
        </div>
      </div>
    </div>
  </div>
</div>
'''
