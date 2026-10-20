// Writes the gallery's brand cards from the sources the app and packaging use:
// tools/brand/*.svg / *.html (icon, installer) and app/ui/illustrations.js.
// Run from the repository root: node docs/design/system/build/art.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const components = path.join(root, 'docs/design/system/project/components');
const brand = (name) => readFile(path.join(root, 'tools/brand', name), 'utf8');
const { ART } = await import(pathToFileURL(path.join(root, 'app/ui/illustrations.js')).href);

const card = (title, meta, body) => `<!-- @dsCard ${meta} -->
<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
${body}
<script>window.SS && SS.mount(document.body)</script>
</body>
</html>
`;
const sized = (svg, size) => svg.replace(/<svg /u, `<svg width="${size}" height="${size}" `);
const label = (text) => `<span class="ds-label">${text}</span>`;

async function write(name, html) {
  await mkdir(path.join(components, name), { recursive: true });
  await writeFile(path.join(components, name, 'preview.html'), html);
}

const icon = await brand('icon.svg');
const small = await brand('icon-small.svg');
const green = await brand('icon-green.svg');
const strip = (background) =>
  `<div class="ds-row" style="gap:20px;align-items:flex-end;padding:16px;border-radius:var(--r-md);background:${background}">
    ${[256, 64, 48, 32, 24, 16]
      .map(
        (size) =>
          `<div class="ds-col" style="justify-items:center">${sized(size <= 32 ? small : icon, size === 256 ? 96 : size)}${label(size === 256 ? '256（缩小显示）' : size)}</div>`,
      )
      .join('')}
  </div>`;
await write(
  'AppIcon',
  card(
    'AppIcon',
    'group="品牌" height=540 subtitle="Windows 应用图标：纸色底板、细描边，墨色标志；32px 以下用加粗的小尺寸画法"',
    `<div class="ds" style="display:grid;gap:16px">
  ${strip('#fbfbf9')}
  ${strip('#202020')}
  <div class="ds-row" style="gap:20px;align-items:center">
    <div class="ds-col" style="justify-items:center">${sized(green, 64)}${label('备选：品牌绿底板、纸色标志（2026-10-20 换下，留作参考）')}</div>
  </div>
  <p class="ds-note">一个 .ico 里放 16、20、24、32、40、48、64、256 八个尺寸。底板用 paper 色加一圈细描边，深色任务栏上也有边界；标志用 ink 色，不加渐变和阴影。源文件在 tools/brand/，运行 node tools/brand/render.mjs 生成 tools/package/brand/icon.ico。</p>
</div>`,
  ),
);

const sidebar = await brand('installer-sidebar.html');
const header = await brand('installer-header.html');
const sidebarGreen = await brand('installer-sidebar-green.html');
await write(
  'Installer',
  card(
    'Installer',
    'group="品牌" height=640 subtitle="安装程序：欢迎页和完成页的左侧图 164×314，各步骤页头右侧图 150×57"',
    `<div class="ds ds-row" style="gap:24px;align-items:flex-start">
  <div class="ds-col">
    <div style="display:flex;width:497px;height:314px;border:1px solid var(--line-strong);background:#fff">
      ${sidebar}
      <div style="padding:16px 20px;color:#1f2420;font-size:13px;line-height:20px">
        <div style="font-size:15px;font-weight:600;margin-bottom:12px">欢迎使用 ScienceScope 安装程序</div>
        <div>安装程序将指导你完成 ScienceScope 的安装。</div>
        <div style="margin-top:8px">点击「下一步」继续。</div>
      </div>
    </div>
    ${label('欢迎页（左侧图 164×314）')}
  </div>
  <div class="ds-col">
    <div style="display:flex;justify-content:space-between;align-items:center;width:497px;height:57px;border:1px solid var(--line-strong);background:#fff;color:#1f2420">
      <div style="padding-left:16px;font-size:13px;line-height:18px"><b>选择安装位置</b><br><span style="font-size:12px">选择 ScienceScope 的安装文件夹。</span></div>
      ${header}
    </div>
    ${label('步骤页头（右侧图 150×57）')}
    <div class="ds-row" style="gap:12px;align-items:flex-end;margin-top:16px">${sidebarGreen}${label('备选：品牌绿左侧图（2026-10-20 换成纸色，留作参考）')}</div>
  </div>
</div>
<p class="ds-note" style="padding:0 16px">两张图都生成为 24 位 BMP（tools/package/brand/），由打包配置的 sidebarImage 和 headerImage 引用。左侧图和应用图标一致：纸色底、墨色标志，右边一条细线和安装程序的白色内容区分开；文字中英各一行，安装程序的语言选择不影响它。</p>`,
  ),
);

const empty = (name, title, text, action) => `<div class="ds-box"><div class="ss-empty">
      <span class="ss-empty__art">${ART[name]}</span>
      <div class="ss-empty__title">${title}</div>
      <div class="ss-empty__text">${text}</div>
      ${action ? `<div class="ss-empty__actions"><button class="ss-btn ss-btn--primary" type="button">${action}</button></div>` : ''}
    </div></div>`;
await write(
  'Illustrations',
  card(
    'Illustrations',
    'group="品牌" height=760 subtitle="插画：欢迎页和较大的空状态用线描插画代替图标；颜色全部来自令牌，跟随深浅主题"',
    `<div class="ds" style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px">
  ${empty('welcome', '今天想推进哪一步？', '和专家一起读文献、做分析、写论文。', '')}
  ${empty('knowledge', '知识库还是空的', '导入论文、数据说明或网页，专家回答时会引用原文。', '<i data-i="import"></i>导入材料')}
  ${empty('desk', '选择一份文稿开始编辑', '从项目文件夹打开 Word 或 LaTeX 文件；每次修改都能单独撤回。', '<i data-i="folder-open"></i>打开文稿')}
  ${empty('folder', '项目文件夹是空的', '放进论文、数据和代码，应用会建立索引。', '<i data-i="import"></i>导入到此文件夹')}
</div>
<p class="ds-note" style="padding:0 16px">160×120 的线描：线宽 1.5，圆头，和 Lucide 图标一致。线用 ink-2，虚线用 faint，纸面用 raised，浅底用 accent-soft，点睛的四角星用 accent。一屏最多一张插画；小的空状态（列表里、侧栏里）仍用图标或一句话。源在 app/ui/illustrations.js。</p>`,
  ),
);

await write(
  'PageAbout',
  card(
    'PageAbout',
    'group="品牌" height=600 subtitle="设置 → 关于：标志、名称、版本和一句话；署名、许可证、数据位置各一行"',
    `<div class="ds" style="max-width:680px">
  <div class="ss-about__head">
    <i data-logo class="ss-about__mark"></i>
    <div class="ss-about__name">ScienceScope</div>
    <div class="ss-about__version">1.0.0-alpha.0 预览版</div>
    <div class="ss-about__text">本地学术研究助手：几位 AI 专家和你一起读文献、做分析、写论文。</div>
  </div>
  <div class="ss-setting-row">
    <div class="ss-setting-row__text"><span class="ss-setting-row__label">发布者</span><span class="ss-setting-row__desc">peroperoyui</span></div>
  </div>
  <div class="ss-setting-row">
    <div class="ss-setting-row__text"><span class="ss-setting-row__label">参与开发</span><span class="ss-setting-row__desc">Codex（AI 辅助开发）、Claude（Anthropic，AI 辅助审阅与开发）</span></div>
  </div>
  <div class="ss-setting-row">
    <div class="ss-setting-row__text"><span class="ss-setting-row__label">许可证</span><span class="ss-setting-row__desc">MIT；随附的第三方软件各有自己的许可证</span></div>
    <div class="ss-setting-row__control"><button class="ss-btn" type="button">第三方声明</button></div>
  </div>
  <div class="ss-setting-row">
    <div class="ss-setting-row__text"><span class="ss-setting-row__label">数据位置</span><span class="ss-setting-row__desc">所有内容都在安装目录的 data 文件夹里，卸载时默认保留</span></div>
    <div class="ss-setting-row__control"><button class="ss-btn" type="button"><i data-i="folder-open"></i>打开文件夹</button></div>
  </div>
  <p class="ds-note">版本号来自安装包。检查更新等 R6b 做完再出现，不放占位。署名不是数字签名。</p>
</div>`,
  ),
);
console.log('Brand cards written.');
