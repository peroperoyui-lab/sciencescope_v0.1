// Drive a kept preview (KEEP=1 node shot.cjs ...) and screenshot after actions.
// node interact.cjs <.sciencescope-local/temp/design-system/shots/_Comp-theme.html> <out.png> '<actions json>' [x,y,w,h] [WxH]
// actions: [["click", sel], ["hover", sel], ["press", key], ["wait", ms], ["eval", js]]
// Playwright from the repo's dependencies, else a global install.
function chromium() {
  for (const id of ['playwright', 'playwright-core', '/opt/node22/lib/node_modules/playwright']) {
    try {
      return require(id).chromium;
    } catch {}
  }
  throw new Error('Playwright is not installed (npm install, or a global playwright)');
}
const [file, out, acts, clip, vp] = process.argv.slice(2);
(async () => {
  const [vw, vh] = (vp || '1536x900').split('x').map(Number);
  const b = await chromium().launch();
  const p = await b.newPage({ viewport: { width: vw, height: vh } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto('file://' + require('path').resolve(file));
  await p.evaluate(() => document.fonts.ready);
  for (const [k, a] of JSON.parse(acts || '[]')) {
    if (k === 'click') await p.click(a);
    else if (k === 'hover') await p.hover(a);
    else if (k === 'rclick') await p.click(a, { button: 'right' });
    else if (k === 'drag') await p.dragAndDrop(a[0], a[1]);
    else if (k === 'press') await p.keyboard.press(a);
    else if (k === 'wait') await p.waitForTimeout(a);
    else if (k === 'eval') console.log(JSON.stringify(await p.evaluate(a)));
  }
  await p.waitForTimeout(300);
  const opt = { path: out };
  if (clip) { const [x, y, w, h] = clip.split(',').map(Number); opt.clip = { x, y, width: w, height: h }; }
  await p.screenshot(opt);
  if (errors.length) console.log('ERR', errors.join(' | '));
  await b.close();
})();
