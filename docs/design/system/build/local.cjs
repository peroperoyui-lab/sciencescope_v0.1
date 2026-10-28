// A local copy of the design-system gallery that any agent or person with the
// repository can open in a browser, without the private claude.ai link. Each
// card is framed the way the gallery frames it (tokens, bundle.css, bundle.js,
// <html data-theme>), as shot.cjs does. Run build.py first. Usage:
//   python3 -I docs/design/system/build/build.py
//   node docs/design/system/build/local.cjs
// then open .sciencescope-local/temp/design-system/gallery/index.html.
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const DS = path.join(HERE, '..', 'project');
const TMP = path.join(HERE, '..', '..', '..', '..', '.sciencescope-local', 'temp', 'design-system');
const OUT = path.join(TMP, 'gallery');
for (const file of ['tokens.local.css', 'fonts.local.css'])
  if (!fs.existsSync(path.join(TMP, file))) {
    console.error(`${file} is missing: run python3 -I docs/design/system/build/build.py first.`);
    process.exit(1);
  }
fs.mkdirSync(OUT, { recursive: true });
const css = fs.readFileSync(path.join(DS, 'components', 'bundle.css'), 'utf8').replace(/@import url\([^)]*\);/, '');
const tokens = fs.readFileSync(path.join(TMP, 'tokens.local.css'), 'utf8');
const fonts = fs.readFileSync(path.join(TMP, 'fonts.local.css'), 'utf8');
const js = fs.readFileSync(path.join(DS, 'components', 'bundle.js'), 'utf8');
fs.writeFileSync(path.join(OUT, 'gallery.css'), `${fonts}\n${tokens}\n${css}`);
fs.writeFileSync(path.join(OUT, 'gallery.js'), js);
// The theme comes from the address (?dark), so the index can switch every card.
const theme = `<script>document.documentElement.dataset.theme = location.search === '?dark' ? 'dark' : 'light';</script>`;
const head = `${theme}<link rel="stylesheet" href="gallery.css"><script src="gallery.js"></script>`;
const escape = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const cards = [];
for (const name of fs.readdirSync(path.join(DS, 'components')).sort()) {
  const file = path.join(DS, 'components', name, 'preview.html');
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, 'utf8');
  const marker = src.split('\n')[0];
  const attr = (key) => (marker.match(new RegExp(`${key}="([^"]*)"`)) || [])[1] || '';
  cards.push({
    name,
    group: attr('group') || '其他',
    subtitle: attr('subtitle'),
    height: Number((marker.match(/height=(\d+)/) || [])[1] || 160),
    width: Number((marker.match(/width=(\d+)/) || [])[1] || (name === 'Cover' ? 960 : 880)),
  });
  const html = src.includes('<head>') ? src.replace('<head>', `<head>${head}`) : head + src;
  fs.writeFileSync(path.join(OUT, `${name}.html`), html);
}

const groups = [...new Set(cards.map((card) => card.group))];
const readme = (name) => `../../../../docs/design/system/project/components/${name}/README.md`;
const index = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>ScienceScope 设计系统（本地）</title>
<style>
  body { margin: 0; font: 14px/1.5 system-ui, sans-serif; background: #f4f3ef; color: #24261f; }
  header { position: sticky; top: 0; z-index: 1; display: flex; gap: 12px; align-items: center; padding: 10px 20px; background: #fff; border-bottom: 1px solid #ddd; }
  header b { margin-right: auto; }
  nav { padding: 8px 20px; font-size: 13px; }
  nav a { margin-right: 10px; color: inherit; }
  h2 { margin: 24px 20px 8px; font-size: 16px; }
  .card { margin: 0 20px 16px; background: #fff; border: 1px solid #ddd; border-radius: 8px; overflow: auto; }
  .card > div { display: flex; gap: 8px; align-items: baseline; padding: 8px 12px; border-bottom: 1px solid #eee; }
  .card span { color: #666; font-size: 12px; }
  .card a { margin-left: auto; font-size: 12px; color: #666; }
  iframe { display: block; border: 0; }
  body.dark { background: #1c1d1a; color: #e8e6df; }
  body.dark header, body.dark .card { background: #262723; border-color: #3a3b36; }
</style>
</head>
<body>
<header><b>ScienceScope 设计系统 · 本地画廊（${cards.length} 张卡片）</b>
  <button type="button" data-theme="light">浅色</button><button type="button" data-theme="dark">深色</button></header>
<nav>${groups.map((group) => `<a href="#g-${escape(group)}">${escape(group)}</a>`).join('')}</nav>
${groups
  .map(
    (group) => `<h2 id="g-${escape(group)}">${escape(group)}</h2>
${cards
  .filter((card) => card.group === group)
  .map(
    (card) => `<section class="card"><div><b>${card.name}</b><span>${escape(card.subtitle)}</span><a href="${readme(card.name)}">README</a></div>
<iframe loading="lazy" src="${card.name}.html?light" width="${card.width}" height="${card.height}" title="${card.name}"></iframe></section>`,
  )
  .join('\n')}`,
  )
  .join('\n')}
<script>
  for (const button of document.querySelectorAll('header button'))
    button.onclick = () => {
      const dark = button.dataset.theme === 'dark';
      document.body.classList.toggle('dark', dark);
      for (const frame of document.querySelectorAll('iframe')) {
        frame.src = frame.src.replace(/\\?.*$/, dark ? '?dark' : '?light');
      }
    };
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(OUT, 'index.html'), index);
console.log(`${cards.length} cards → ${path.relative(process.cwd(), path.join(OUT, 'index.html'))}`);
