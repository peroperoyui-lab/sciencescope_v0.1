# python3 -I setheight.py Comp=H [Comp=H ...]  rewrites height=N in the @dsCard marker
import sys, re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent / 'project' / 'components'
for arg in sys.argv[1:]:
    comp, h = arg.split('=')
    f = root / comp / 'preview.html'
    s = f.read_text()
    first, rest = s.split('\n', 1)
    new = re.sub(r'height=\d+', 'height=' + h, first)
    f.write_text(new + '\n' + rest)
    print(comp, '->', h)
