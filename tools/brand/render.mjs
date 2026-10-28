// Renders the brand sources in this folder into the files packaging uses:
// the Windows icon (every size in one .ico) and the two NSIS installer
// bitmaps. Run: node tools/brand/render.mjs [--preview <folder>]
// Chromium draws the SVG and HTML sources, so text uses the app's own
// Noto Sans SC; the .ico and .bmp containers are written here.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = path.join(root, 'tools/package/brand');
const previewArg = process.argv.indexOf('--preview');
const preview = previewArg > 0 ? path.resolve(process.argv[previewArg + 1]) : null;
const temp = path.join(root, '.sciencescope-local/temp/brand');
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const font = pathToFileURL(
  path.join(root, 'node_modules/@fontsource-variable/noto-sans-sc/index.css'),
).href;

// Windows asks for these icon sizes; 16-32 use the thickened small drawing.
const ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 256];

/** @param {string} body @param {number} width @param {number} height */
const page = (body, width, height) => `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="${font}">
<style>html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:transparent}
body{font-family:'Noto Sans SC Variable',sans-serif}svg{display:block}</style>${body}`;

/** 24-bit bottom-up BMP from RGBA pixels (NSIS needs plain BMP). */
function bmp(rgba, width, height) {
  const row = Math.ceil((width * 3) / 4) * 4;
  const data = Buffer.alloc(54 + row * height);
  data.write('BM', 0);
  data.writeUInt32LE(data.length, 2);
  data.writeUInt32LE(54, 10);
  data.writeUInt32LE(40, 14);
  data.writeInt32LE(width, 18);
  data.writeInt32LE(height, 22);
  data.writeUInt16LE(1, 26);
  data.writeUInt16LE(24, 28);
  data.writeUInt32LE(row * height, 34);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      const to = 54 + (height - 1 - y) * row + x * 3;
      data[to] = rgba[from + 2];
      data[to + 1] = rgba[from + 1];
      data[to + 2] = rgba[from];
    }
  return data;
}

/** An .ico whose entries are PNG images. @param {{size:number,png:Buffer}[]} images */
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header[entry] = size >= 256 ? 0 : size;
    header[entry + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.png)]);
}

const browser = await chromium.launch({ executablePath: CHROMIUM });
try {
  await mkdir(out, { recursive: true });
  await mkdir(temp, { recursive: true });
  if (preview) await mkdir(preview, { recursive: true });
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  const tab = await context.newPage();

  /** Screenshot an HTML document at an exact size. */
  async function shoot(html, width, height, transparent) {
    const file = path.join(temp, 'render.html');
    await writeFile(file, page(html, width, height));
    await tab.setViewportSize({ width, height });
    await tab.goto(pathToFileURL(file).href);
    await tab.evaluate(() => document.fonts.ready);
    return tab.screenshot({ omitBackground: transparent, type: 'png' });
  }

  /** Raw RGBA pixels of a PNG, decoded by the browser. @param {Buffer} png */
  async function pixels(png, width, height) {
    await tab.setViewportSize({ width, height });
    const data = await tab.evaluate(
      async ({ src, width, height }) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        return Array.from(context.getImageData(0, 0, width, height).data);
      },
      { src: `data:image/png;base64,${png.toString('base64')}`, width, height },
    );
    return Uint8Array.from(data);
  }

  const large = await readFile(path.join(here, 'icon.svg'), 'utf8');
  const small = await readFile(path.join(here, 'icon-small.svg'), 'utf8');
  const icons = [];
  for (const size of ICON_SIZES) {
    const svg = (size <= 32 ? small : large).replace(
      '<svg ',
      `<svg width="${size}" height="${size}" `,
    );
    const png = await shoot(svg, size, size, true);
    icons.push({ size, png });
    if (preview) await writeFile(path.join(preview, `icon-${size}.png`), png);
  }
  // Largest first: the Windows build takes the .ico's first entry as the
  // window and taskbar icon, and a 16 px first entry looked blurred there.
  await writeFile(path.join(out, 'icon.ico'), ico([...icons].reverse()));

  for (const [name, width, height] of [
    ['installer-sidebar', 164, 314],
    ['installer-header', 150, 57],
  ]) {
    const html = await readFile(path.join(here, `${name}.html`), 'utf8');
    const png = await shoot(html, width, height, false);
    await writeFile(
      path.join(out, `${name}.bmp`),
      bmp(await pixels(png, width, height), width, height),
    );
    if (preview) await writeFile(path.join(preview, `${name}.png`), png);
  }
  console.log(`Brand files written to ${path.relative(root, out)}`);
} finally {
  await browser.close();
}
