# Assembles a page mock from shared shell parts: python3 -I assemble.py <Comp> '<marker>' part1 part2 ...
# A part named shell_top / shell_bottom comes from parts/; other parts too.
import sys, pathlib
HERE = pathlib.Path(__file__).resolve().parent
comp, marker, parts = sys.argv[1], sys.argv[2], sys.argv[3:]
body = ''.join((HERE / 'parts' / (p + '.html')).read_text() for p in parts)
out = (marker.strip() + '\n<!doctype html>\n<html lang="zh-CN">\n<head><meta charset="utf-8"><title>' + comp +
       '</title></head>\n<body>\n' + body.rstrip('\n') + '\n<script>window.SS && SS.mount(document.body)</script>\n</body>\n</html>\n')
dest = HERE.parent / 'project' / 'components' / comp / 'preview.html'
dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_text(out)
print(dest.relative_to(HERE.parent), len(out.encode()), 'bytes')
