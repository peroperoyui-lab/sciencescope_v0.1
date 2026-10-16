# python3 -I sheet.py Comp1,Comp2 out.png [light|dark|both]: contact sheet of rendered shots
import sys, os, pathlib
SHOTS = pathlib.Path(__file__).resolve().parents[4] / '.sciencescope-local' / 'temp' / 'design-system' / 'shots'
from PIL import Image, ImageDraw
names = sys.argv[1].split(',')
out = sys.argv[2]
mode = sys.argv[3] if len(sys.argv) > 3 else 'both'
rows = []
for n in names:
    ims = []
    for th in (['light', 'dark'] if mode == 'both' else [mode]):
        p = SHOTS / f'{n}-{th}.png'
        if os.path.exists(p): ims.append(Image.open(p).convert('RGB'))
    if not ims: continue
    w = sum(i.width for i in ims) + 8 * (len(ims) - 1); h = max(i.height for i in ims)
    row = Image.new('RGB', (w, h), (120, 120, 120)); x = 0
    for i in ims: row.paste(i, (x, 0)); x += i.width + 8
    rows.append(row)
W = max(r.width for r in rows); H = sum(r.height for r in rows) + 8 * (len(rows) - 1)
sheet = Image.new('RGB', (W, H), (120, 120, 120)); y = 0
for r in rows: sheet.paste(r, (0, y)); y += r.height + 8
sheet.save(out)
print(sheet.size)
