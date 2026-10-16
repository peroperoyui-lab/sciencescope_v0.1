// Render design-system previews the way the gallery frame does: tokens.css,
// bundle.css, bundle.js preloaded, <html data-theme>. Usage:
//   node shot.cjs <Component|all> [light|dark|both] [scale]
// Playwright from the repo's dependencies, else a global install.
function chromium() {
  for (const id of ['playwright', 'playwright-core', '/opt/node22/lib/node_modules/playwright']) {
    try {
      return require(id).chromium;
    } catch {}
  }
  throw new Error('Playwright is not installed (npm install, or a global playwright)');
}
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const DS = path.join(HERE, '..', 'project');
const TMP = path.join(HERE, '..', '..', '..', '..', '.sciencescope-local', 'temp', 'design-system');
const OUT = path.join(TMP, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const which = process.argv[2] || 'all';
const themes = (process.argv[3] || 'both') === 'both' ? ['light', 'dark'] : [process.argv[3]];
const scale = Number(process.argv[4] || 1);
const comps = which === 'all'
  ? fs.readdirSync(path.join(DS, 'components')).filter((d) => fs.existsSync(path.join(DS, 'components', d, 'preview.html')))
  : which.split(',');
const css = fs.readFileSync(path.join(DS, 'components', 'bundle.css'), 'utf8').replace(/@import url\([^)]*\);/, '');
const tokens = fs.readFileSync(path.join(TMP, 'tokens.local.css'), 'utf8');
const fonts = fs.readFileSync(path.join(TMP, 'fonts.local.css'), 'utf8');
const js = fs.readFileSync(path.join(DS, 'components', 'bundle.js'), 'utf8');
(async () => {
  const browser = await chromium().launch();
  for (const c of comps) {
    const file = path.join(DS, 'components', c, 'preview.html');
    const src = fs.readFileSync(file, 'utf8');
    const marker = src.split('\n')[0];
    const h = Number((marker.match(/height=(\d+)/) || [])[1] || 160);
    const w = Number((marker.match(/width=(\d+)/) || [])[1] || (c === 'Cover' ? 960 : 880));
    for (const theme of themes) {
      const head = `<style>${fonts}</style><style>${tokens}</style><style>${css}</style><script>${js}</script>`;
      let html = src.replace(/<html([^>]*)>/i, `<html$1 data-theme="${theme}">`);
      html = html.includes('<head>') ? html.replace('<head>', '<head>' + head) : head + html;
      const tmp = path.join(OUT, `_${c}-${theme}.html`);
      fs.writeFileSync(tmp, html);
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto('file://' + tmp);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      const full = await page.evaluate(() => document.documentElement.scrollHeight);
      const out = path.join(OUT, `${c}-${theme}.png`);
      await page.screenshot({ path: out, fullPage: full > h + 4 });
      console.log(c, theme, `${w}x${h}`, full > h + 4 ? `overflow ${full}px` : 'ok', errors.length ? 'ERR ' + errors.join(' | ') : '');
      await page.close();
      if (!process.env.KEEP) fs.unlinkSync(tmp);
    }
  }
  await browser.close();
})();
