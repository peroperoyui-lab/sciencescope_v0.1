from pathlib import Path
import re,json
root=Path(__file__).resolve().parents[1]
s=(root/'src/original-base.html').read_text()
css=(root/'src/interaction-v2.css').read_text()
js=(root/'src/interaction-v2.js').read_text()
# Strip dispensable product copy, while retaining functional labels and help documentation.
for phrase in ['保留出处，探索另一种方法或解释。','用户决定 · 专家协作','记下下一步，按自己的节奏推进','选择材料、提出问题，或者从最近工作继续。']:
 s=s.replace(phrase,'')
# Correct original icon fallback for new lightweight controls.
js=js.replace("const V={", "iconPaths.copy ||= '<rect x=\"8\" y=\"8\" width=\"12\" height=\"12\" rx=\"2\"/><path d=\"M16 8V4H4v12h4\"/>';\niconPaths.branch ||= '<circle cx=\"6\" cy=\"5\" r=\"2\"/><circle cx=\"6\" cy=\"19\" r=\"2\"/><circle cx=\"18\" cy=\"5\" r=\"2\"/><path d=\"M6 7v10m0-5c8 0 12-2 12-5\"/>';\niconPaths.trash ||= '<path d=\"M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v7m4-7v7\"/>';\nconst V={")
# Capture original document before the inherited renderer replaces the body.
pre="<script>window.SS_SOURCE_HTML='<!DOCTYPE html>'+document.documentElement.outerHTML;</script>"
# Capturing before final parsing would truncate scripts. Capture after all source is available, before render instead.
s=s.replace('</style>', '</style><style>'+css+'</style>',1)
last=s.rfind('render();\n</script>')
assert last>0
spec_updates=json.loads((root/'docs/page-manifest.json').read_text())
js+='\nfor(const d of '+json.dumps(spec_updates,ensure_ascii=False).replace('<','\\u003c')+'){const p=window.PAGE_SPECS.find(p=>p.route===d.route);if(p)Object.assign(p,d);}'
s=s.replace('48 个页面','49 个页面').replace('P01 / 48','P01 / 49')
capture="window.SS_SOURCE_HTML='<!DOCTYPE html>'+document.documentElement.outerHTML;\n"
s=s[:last]+js+'\n'+capture+'render();\n'+s[last+len('render();\n'):]
(root/'ScienceScope.html').write_text(s)
print('Built',root/'ScienceScope.html',len(s))
