// Report the in-flow content height of previews vs their marker height.
// node measure.cjs <Comp,...|all>
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
const DS = path.join(__dirname, '..', 'project');
const TMP = path.join(__dirname, '..', '..', '..', '..', '.sciencescope-local', 'temp', 'design-system');
const which = process.argv[2] || 'all';
const comps = which === 'all'
  ? fs.readdirSync(path.join(DS, 'components')).filter((d) => fs.existsSync(path.join(DS, 'components', d, 'preview.html')))
  : which.split(',');
const css = fs.readFileSync(path.join(DS, 'components', 'bundle.css'), 'utf8').replace(/@import url\([^)]*\);/, '');
const tokens = fs.readFileSync(path.join(TMP, 'tokens.local.css'), 'utf8');
const fonts = fs.readFileSync(path.join(TMP, 'fonts.local.css'), 'utf8');
const js = fs.readFileSync(path.join(DS, 'components', 'bundle.js'), 'utf8');
(async () => {
  const b = await chromium().launch();
  for (const c of comps) {
    const src = fs.readFileSync(path.join(DS, 'components', c, 'preview.html'), 'utf8');
    const marker = src.split('\n')[0];
    if (/\bpage\b/.test(marker)) { console.log(c.padEnd(18), 'page'); continue; }
    const h = Number((marker.match(/height=(\d+)/) || [])[1] || 0);
    const w = Number((marker.match(/width=(\d+)/) || [])[1] || 880);
    const head = `<style>${fonts}</style><style>${tokens}</style><style>${css}</style><script>${js}</script>`;
    const html = src.replace('<head>', '<head>' + head);
    fs.mkdirSync(path.join(TMP, 'shots'), { recursive: true });
    const tmp = path.join(TMP, 'shots', `_m_${c}.html`);
    fs.writeFileSync(tmp, html);
    const p = await b.newPage({ viewport: { width: w, height: 2400 } });
    await p.goto('file://' + tmp);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(150);
    const need = await p.evaluate(() => {
      let m = 0;
      for (const el of document.body.children) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' || cs.display === 'none' || el.tagName === 'SCRIPT') continue;
        m = Math.max(m, el.getBoundingClientRect().bottom);
      }
      return Math.ceil(m);
    });
    console.log(c.padEnd(18), 'marker', String(h).padStart(4), 'content', String(need).padStart(4), need > h ? 'OVER' : need < h - 12 ? 'slack ' + (h - need) : '');
    await p.close();
    fs.unlinkSync(tmp);
  }
  await b.close();
})();
