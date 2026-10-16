# Builds project/components/bundle.js (gallery runtime) and the local preview helpers
# (tokens.local.css, fonts.local.css) under .sciencescope-local/temp/design-system.
# Usage: python3 -I docs/design/system/build/build.py
import json, re, os, sys, pathlib
HERE = os.path.dirname(os.path.abspath(__file__))
DS = os.path.join(HERE, '..', 'project')
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
TMP = os.path.join(ROOT, '.sciencescope-local', 'temp', 'design-system')
LOGO_SVG = os.path.join(HERE, '..', 'logo', 'sciencescope-mark.svg')
ORDER = [
    'Icons', 'Logo',
    'Button', 'IconButton', 'SendButton',
    'TextField', 'Select', 'Checkbox', 'SegmentedControl', 'Slider',
    'Tabs', 'Sidebar', 'PageHeader',
    'Tooltip', 'Menu', 'Popover', 'Dialog', 'Toast', 'CommandPalette',
    'Badge', 'Spinner', 'Callout', 'EmptyState',
    'List', 'Table', 'FilterBar',
    'Splitter', 'Panel',
    'Message', 'ActivityTimeline', 'StatusLine', 'ApprovalCard', 'Composer', 'ModelPicker', 'ModeMenu',
    'SettingRow', 'ProviderCard',
]

def build_bundle():
    icons = json.load(open(os.path.join(HERE, 'icons.json')))
    groups = json.load(open(os.path.join(HERE, 'icons_groups.json')))
    svg = open(LOGO_SVG).read()
    inner = svg[svg.index('>') + 1: svg.rindex('</svg>')]
    src = open(os.path.join(HERE, 'bundle.src.js')).read()
    # Line 1: namespace and component order (gallery groups in order; page mocks and Cover excluded).
    header = {'format': 4, 'namespace': 'SS', 'components': [{'name': n} for n in ORDER]}
    src = '/* @ds-bundle: ' + json.dumps(header, separators=(',', ':')) + ' */\n' + src
    out = (src.replace('__ICONS__', json.dumps(icons, ensure_ascii=False, separators=(',', ':')))
              .replace('__GROUPS__', json.dumps(groups, ensure_ascii=False, separators=(',', ':')))
              .replace('__LOGO__', json.dumps(inner)))
    for bad in ('</script', '<!--'):
        assert bad not in out.lower(), bad
    open(os.path.join(DS, 'components', 'bundle.js'), 'w').write(out)
    return len(out)

def resolve(v):
    m = re.fullmatch(r'\{([A-Za-z0-9][A-Za-z0-9_.-]*)\}', v)
    return f'var(--{m.group(1)})' if m else v

def build_tokens_css():
    t = json.load(open(os.path.join(DS, 'tokens.json')))
    themes = [x['id'] for x in t['color']['themes']]
    first = themes[0]
    def val(tok, theme):
        v = tok['value']
        if isinstance(v, str): return v if theme == first else None
        return v.get(theme) if theme in v else (v.get(first) if theme == first else None)
    lines = ['/* ScienceScope — local preview copy compiled from tokens.json */']
    lines.append(f':root, [data-theme="{first}"] {{')
    for fam in ('color', 'shadow'):
        for tok in t[fam]['tokens']:
            lines.append(f"  --{tok['name']}: {resolve(val(tok, first))};")
    lines.append('}')
    for th in themes[1:]:
        lines.append(f'[data-theme="{th}"] {{')
        for fam in ('color', 'shadow'):
            for tok in t[fam]['tokens']:
                v = val(tok, th)
                if v is None: v = val(tok, first)
                lines.append(f"  --{tok['name']}: {resolve(v)};")
        lines.append('}')
    lines.append(':root {')
    for fam, block in t.items():
        if fam in ('color', 'shadow', 'type', 'name', 'version', 'meta') or not isinstance(block, dict): continue
        for tok in block['tokens']:
            lines.append(f"  --{tok['name']}: {tok['value']};")
    for k, stack in t['type']['families'].items():
        lines.append(f'  --font-{k}: {stack};')
    lines.append('}')
    for g in t['type']['groups']:
        for s in g['styles']:
            fam = s.get('family', g['family'])
            lines.append(f".{s['name']} {{ font-family: var(--font-{fam}); font-size: {s['fontSize']}; line-height: {s['lineHeight']}; font-weight: {s['fontWeight']}; }}")
    os.makedirs(TMP, exist_ok=True)
    open(os.path.join(TMP, 'tokens.local.css'), 'w').write('\n'.join(lines) + '\n')
    # Noto Sans SC from the app's dependency when installed; otherwise system fonts.
    noto = os.path.join(ROOT, 'node_modules', '@fontsource-variable', 'noto-sans-sc', 'index.css')
    fonts = "@import url('%s');\n" % pathlib.Path(noto).as_uri() if os.path.exists(noto) else ''
    open(os.path.join(TMP, 'fonts.local.css'), 'w').write(fonts)
    # sanity: unique names across non-type families
    names = []
    for fam, block in t.items():
        if isinstance(block, dict) and 'tokens' in block: names += [x['name'] for x in block['tokens']]
    dup = {n for n in names if names.count(n) > 1}
    assert not dup, dup
    return len(names)

if __name__ == '__main__':
    print('bundle.js bytes', build_bundle())
    print('tokens', build_tokens_css())
