# Regenerates icons.json / icons_groups.json from icons_meta.GROUPS and the Lucide 1.49.0 SVGs.
# python3 -I gen_icons.py [<lucide>/package/icons]  (default: .sciencescope-local/temp/lucide/package/icons)
import re, json, pathlib, sys
HERE = pathlib.Path(__file__).resolve().parent
SRC = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parents[3] / '.sciencescope-local' / 'temp' / 'lucide' / 'package' / 'icons'
ns = {}
exec((HERE / 'icons_meta.py').read_text(encoding='utf-8'), ns)
icons, groups = {}, []
for gname, items in ns['GROUPS']:
    groups.append([gname, [[n, m] for n, m in items]])
    for n, m in items:
        svg = (SRC / ('%s.svg' % n)).read_text()
        inner = svg.split('>', 2)[2] if svg.startswith('<!--') else svg.split('>', 1)[1]
        inner = inner.rsplit('</svg>', 1)[0]
        parts = [re.sub(r'\s+', ' ', p).replace(' />', '/>') for p in re.findall(r'<[^>]+?/>', inner, re.S)]
        icons[n] = ''.join(parts)
json.dump(icons, open(HERE / 'icons.json', 'w'), ensure_ascii=False, separators=(',', ':'))
json.dump(groups, open(HERE / 'icons_groups.json', 'w'), ensure_ascii=False)
print(len(icons), 'icons')
