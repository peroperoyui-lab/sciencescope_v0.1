import json, re, sys
import pathlib
t = json.load(open(pathlib.Path(__file__).resolve().parent.parent / 'project' / 'tokens.json', encoding='utf-8'))
toks = {x['name']: x['value'] for x in t['color']['tokens']}
def val(name, theme):
    v = toks[name]
    v = v[theme] if isinstance(v, dict) else v
    m = re.fullmatch(r'\{(.+)\}', v)
    return val(m.group(1), theme) if m else v
def rgb(h):
    h = h.lstrip('#'); return [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
def lum(h):
    c = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in rgb(h)]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
def cr(a, b):
    la, lb = sorted([lum(a), lum(b)], reverse=True); return (la + 0.05) / (lb + 0.05)
TEXT = [  # (fg, [grounds], need)
  ('ink', ['paper', 'side', 'raised', 'sunken', 'hover', 'press', 'selected', 'accent-soft', 'warn-soft'], 4.5),
  ('ink-2', ['paper', 'side', 'raised', 'sunken', 'hover', 'selected'], 4.5),
  ('muted', ['paper', 'side', 'raised', 'sunken', 'hover', 'selected', 'press'], 4.5),
  ('accent', ['paper', 'side', 'raised', 'sunken'], 4.5),
  ('accent-ink', ['accent-soft', 'paper', 'raised'], 4.5),
  ('warn-ink', ['warn-soft', 'paper', 'raised'], 4.5),
  ('danger', ['danger-soft', 'paper', 'raised'], 4.5),
  ('auto-ink', ['auto-soft', 'paper', 'raised'], 4.5),
  ('on-auto', ['auto'], 4.5),
  ('on-accent', ['accent'], 4.5),
  ('on-primary', ['primary', 'primary-hover'], 4.5),
  ('on-danger', ['danger'], 4.5),
  ('on-tooltip', ['tooltip'], 4.5),
  ('ink-2', ['warn-soft', 'auto-soft'], 4.5),
]
MARKS = [
  ('focus', ['paper', 'side', 'raised', 'sunken'], 3),
  ('warn', ['warn-soft', 'paper'], 3),
  ('danger', ['danger-soft'], 3),
  ('accent', ['accent-soft', 'selected'], 3),
  ('faint', ['raised', 'paper', 'side'], 3),
  ('muted', ['raised'], 3),
  ('line-strong', ['paper', 'raised'], 3),
  ('auto', ['paper', 'raised'], 3),
]
bad = 0
for theme in ('light', 'dark'):
    for group, need_default in ((TEXT, None), (MARKS, None)):
        for fg, grounds, need in group:
            for g in grounds:
                r = cr(val(fg, theme), val(g, theme))
                flag = '' if r >= need else '  <-- below %.1f' % need
                if flag: bad += 1
                if flag or '-v' in sys.argv:
                    print(theme.ljust(5), fg.rjust(11), 'on', g.ljust(12), '%.2f' % r, flag)
print('failures:', bad)
