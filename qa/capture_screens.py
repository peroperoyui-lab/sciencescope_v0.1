from pathlib import Path
import json,html
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
source=(ROOT/'ScienceScope.html').read_text()
specs=json.loads((ROOT/'docs/page-manifest.json').read_text())
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 ctx=b.new_context(viewport={'width':1440,'height':960},device_scale_factor=1)
 for s in specs:
  pg=ctx.new_page();pg.set_content(source);pg.evaluate(f"SS.navigate('{s['route']}')");pg.wait_for_timeout(80)
  pg.screenshot(path=str(ROOT/'screenshots'/f"{s['id']}_{s['route']}.png"));pg.close()
 pg=ctx.new_page();pg.set_content(source);pg.evaluate("SS.navigate('work')");pg.wait_for_timeout(80)
 pg.locator('#overview-trigger').click();pg.screenshot(path=str(ROOT/'screenshots/Detail_Project_Overview.png'))
 pg.locator('[data-v="overview-close"]').click();pg.locator('[data-v="object-menu"][data-id="e-theory"]').first.click();pg.screenshot(path=str(ROOT/'screenshots/Detail_Context_Menu.png'))
 pg.keyboard.press('Escape');pg.locator('[data-usage="main"]').hover();pg.screenshot(path=str(ROOT/'screenshots/Detail_Context_Usage.png'))
 pg.locator('.mainhead').hover();pg.keyboard.press('Control+k');pg.locator('#command-query').fill('研究');pg.screenshot(path=str(ROOT/'screenshots/Detail_Command_Palette.png'));pg.keyboard.press('Escape')
 pg.evaluate("SS.navigate('workbench')");pg.wait_for_timeout(70);pg.locator('[data-v="new-record"][data-kind="plan"]').click();pg.locator('#record-title').fill('复核论文第三部分');pg.locator('#record-text').fill('比较理论表述与实际分析结果。');pg.evaluate("SSV2.appendRecordFiles([new File(['# notes'],'核查说明.md',{type:'text/markdown'})])");pg.screenshot(path=str(ROOT/'screenshots/Detail_Plan_Attachment.png'))
 pg.locator('[data-v="close-editor"]').first.click()
 with pg.expect_popup() as w:pg.locator('[data-v="open-global"]').click()
 child=w.value;child.wait_for_timeout(70);child.set_viewport_size({'width':460,'height':730});child.screenshot(path=str(ROOT/'screenshots/Detail_Assistant_Window.png'));child.locator('[data-v="toggle-orb"]').click();child.set_viewport_size({'width':160,'height':165});child.screenshot(path=str(ROOT/'screenshots/Detail_Assistant_Orb.png'));child.close()
 pg.close();b.close()
extras=[(p.name,p.stem.replace('Detail_','').replace('_',' ')) for p in sorted((ROOT/'screenshots').glob('Detail_*.png'))]
items=[(f"{s['id']}_{s['route']}.png",s['id']+' '+s['title']) for s in specs]+extras
index='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>ScienceScope 页面图册 v0.3</title><style>body{font:14px 'Segoe UI','Microsoft YaHei',sans-serif;background:#f6f7f3;color:#273326;margin:36px}h1{font-size:26px}p{color:#7a8372}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:22px}article{background:white;padding:14px;border:1px solid #dfe5d6;border-radius:12px}img{width:100%;object-fit:contain;max-height:410px}a{color:inherit;text-decoration:none}h2{font-size:13px;font-weight:500}header{margin-bottom:25px}</style><header><h1>ScienceScope · 页面图册</h1><p>49 个页面状态与 7 个交互细节。点击查看原尺寸；交互体验请打开 ../ScienceScope.html。</p></header><main>'''
for name,title in items:index+=f'<article><a href="{html.escape(name)}"><img loading="lazy" src="{html.escape(name)}" alt="{html.escape(title)}"><h2>{html.escape(title)}</h2></a></article>'
index+='</main></html>'
(ROOT/'screenshots/index.html').write_text(index)
print('Captured',len(items),'images')
