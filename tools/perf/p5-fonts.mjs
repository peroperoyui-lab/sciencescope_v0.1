// Measure font variants only in an isolated installed test product. Application
// sources and the installed baseline are restored after each cold/warm pair.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { launchNative, prepareCold, until } from './native-host.mjs';
import { safeRoute } from './native-profile.mjs';
import { sanitizeTrace, summarizeStartupSplit } from './p4c-startup-summary.mjs';
import { summarizeFontTrace, summarizeFontResources } from './p5-font-summary.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (file) => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/u, ''));
const contained = (base, file) => {
  const relative = path.relative(path.resolve(base), path.resolve(file));
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
};

function filterStack(css, variable, installed, extra = []) {
  const pattern = new RegExp('(' + variable + ':)([^;]+);', 'u');
  assert.ok(pattern.test(css), 'Missing font variable: ' + variable);
  return css.replace(pattern, (_, prefix, stack) => {
    const kept = stack
      .split(',')
      .map((name) => name.trim())
      .filter((name) => {
        const family = name.replace(/^['"]|['"]$/gu, '');
        return !/^['"]/u.test(name) || installed.has(family) || extra.includes(family);
      });
    return prefix + ' ' + kept.join(', ') + ';';
  });
}

/**
 * Install-copy overrides are present before WebView navigation and stay fixed
 * across the cold/warm pair. The callback must close native windows before exit.
 */
export async function withFontVariant({ install, out, variant, families }, run) {
  const allowed = path.resolve('.sciencescope-local');
  install = path.resolve(install);
  out = path.resolve(out);
  assert.ok(contained(allowed, install), 'Use an isolated install under .sciencescope-local.');
  assert.ok(contained(path.join(allowed, 'temp/p5'), out), 'Use a new P5 evidence directory.');
  assert.match(variant, /^[ABCD]$/u);
  await mkdir(out, { recursive: true });
  const indexFile = path.join(install, 'app/ui/index.html');
  const cssFile = path.join(install, 'app/ui/styles/tokens.css');
  const originalIndex = await readFile(indexFile, 'utf8');
  const originalCss = await readFile(cssFile, 'utf8');
  // An un-restored prior override must be investigated rather than made a baseline.
  assert.ok(originalIndex.includes('/vendor/fonts/noto-sans-sc/index.css'));
  assert.ok(originalCss.includes("'PingFang SC'") && originalCss.includes("'Songti SC'"));
  await writeFile(path.join(out, 'original-index.html'), originalIndex, { flag: 'wx' });
  await writeFile(path.join(out, 'original-tokens.css'), originalCss, { flag: 'wx' });
  // The default 250 ResourceTiming entries can omit late font requests on this
  // unbundled page. Apply identical early observation to every variant.
  let index = originalIndex.replace(
      '<head>',
      '<head><script>performance.setResourceTimingBufferSize(10000);window.__P5_RESOURCE_OVERFLOW__=0;performance.addEventListener("resourcetimingbufferfull",()=>window.__P5_RESOURCE_OVERFLOW__++);</script>',
    ),
    css = originalCss;
  const installed = new Set(families);
  if (variant === 'B') {
    assert.ok(installed.has('Microsoft YaHei'));
    index = index.replace(
      /^\s*<link rel="stylesheet" href="\/vendor\/fonts\/noto-sans-sc\/index\.css" \/>\r?\n/mu,
      '',
    );
    assert.ok(!index.includes('/vendor/fonts/noto-sans-sc/index.css'));
    for (const variable of ['--font-sans', '--font-sans-default'])
      css = css.replace(
        new RegExp('(' + variable + ':)[^;]+;', 'u'),
        "$1 'Microsoft YaHei', sans-serif;",
      );
  } else if (variant === 'C' || variant === 'D') {
    for (const variable of ['--font-sans', '--font-sans-default'])
      css = filterStack(css, variable, installed, ['Noto Sans SC Variable']);
    if (variant === 'D') css = filterStack(css, '--font-serif', installed);
  }
  const configuration = {
    variant,
    original: { index: digest(originalIndex), css: digest(originalCss) },
    override: { index: digest(index), css: digest(css) },
    families: [...installed],
    stacks: Object.fromEntries(
      ['--font-sans', '--font-sans-default', '--font-serif'].map((variable) => [
        variable,
        css.match(new RegExp(variable + ':([^;]+);', 'u'))?.[1].trim(),
      ]),
    ),
  };
  await writeFile(path.join(out, 'configuration.json'), JSON.stringify(configuration, null, 2), {
    flag: 'wx',
  });
  try {
    if (index !== originalIndex) await writeFile(indexFile, index);
    if (css !== originalCss) await writeFile(cssFile, css);
    return await run(configuration);
  } finally {
    if (index !== originalIndex) await writeFile(indexFile, originalIndex);
    if (css !== originalCss) await writeFile(cssFile, originalCss);
    assert.equal(digest(await readFile(indexFile)), configuration.original.index);
    assert.equal(digest(await readFile(cssFile)), configuration.original.css);
    await writeFile(
      path.join(out, 'restored.json'),
      JSON.stringify(
        {
          restoredAt: new Date().toISOString(),
          ...configuration.original,
        },
        null,
        2,
      ),
      { flag: 'wx' },
    );
  }
}

async function lines(file) {
  try {
    return (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function sample(options, mode) {
  const folder = path.join(options.out, mode);
  await mkdir(folder, { recursive: true });
  const receipt = await open(path.join(folder, 'sample.json'), 'wx');
  const rawTrace = path.join(folder, 'trace.raw.json');
  const nativeFile = path.join(folder, 'native.jsonl');
  const startupFile = path.join(options.data, 'logs/startup.log');
  const row = {
    variant: options.variant,
    repetition: options.repetition,
    mode,
    startedAt: new Date().toISOString(),
  };
  let native;
  try {
    const previous = (await lines(startupFile)).length;
    if (mode === 'cold') row.purge = await prepareCold(options.coldHook, options.coldNumber);
    // Every reported sample has exactly this instrumentation, including warm runs.
    const argumentsText =
      '--trace-startup=devtools.timeline,blink.user_timing,loading ' +
      '--trace-startup-file="' +
      rawTrace +
      '" --trace-startup-duration=30 --trace-startup-format=json';
    row.spawnEpochMs = Date.now();
    native = await launchNative({
      install: options.install,
      data: options.data,
      port: options.port,
      nativeStartupOutput: nativeFile,
      extraBrowserArguments: argumentsText,
      onPage: async () => {},
    });
    const main = native.main;
    await main.getByRole('textbox', { name: '主输入框', exact: true }).waitFor();
    await until(() =>
      main.evaluate(
        () => performance.getEntriesByName('sciencescope.first-render-report').length > 0,
      ),
    );
    // Waiting before the first render could resolve fonts.ready while no fonts
    // have been requested. The measured boundary itself does not wait for fonts.
    await main.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    row.page = await main.evaluate(async () => ({
      timeOrigin: performance.timeOrigin,
      capturedAtMs: performance.now(),
      fontStatus: document.fonts.status,
      devicePixelRatio,
      visualScale: visualViewport.scale,
      innerWidth,
      innerHeight,
      nativeScaleFactor: await window.__TAURI__.window.getCurrentWindow().scaleFactor(),
      routeHash: location.hash,
      marks: performance
        .getEntriesByType('mark')
        .filter((entry) => entry.name.startsWith('sciencescope.'))
        .map(({ name, startTime }) => ({ name, startTime })),
      paints: performance
        .getEntriesByType('paint')
        .map(({ name, startTime }) => ({ name, startTime })),
      navigation: performance.getEntriesByType('navigation').map((entry) => ({
        startTime: entry.startTime,
        requestStart: entry.requestStart,
        responseStart: entry.responseStart,
        responseEnd: entry.responseEnd,
        domInteractive: entry.domInteractive,
        domContentLoadedEventEnd: entry.domContentLoadedEventEnd,
        loadEventEnd: entry.loadEventEnd,
      })),
      resources: performance.getEntriesByType('resource').map((entry) => ({
        route: new URL(entry.name).pathname,
        initiatorType: entry.initiatorType,
        startTime: entry.startTime,
        requestStart: entry.requestStart,
        responseStart: entry.responseStart,
        responseEnd: entry.responseEnd,
        duration: entry.duration,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
      })),
      fonts: [...document.fonts]
        .filter((font) => font.status === 'loaded')
        .map(({ family, style, weight, unicodeRange }) => ({
          family,
          style,
          weight,
          unicodeRange,
        })),
      bodyFont: getComputedStyle(document.body).fontFamily,
      resourceBufferOverflow: window.__P5_RESOURCE_OVERFLOW__,
    }));
    row.page.resources.forEach((resource) => {
      resource.route = safeRoute('http://local' + resource.route);
    });
    assert.equal(
      row.page.devicePixelRatio,
      1.25,
      'Keep actual Windows scale 125% for all timing samples.',
    );
    assert.equal(row.page.nativeScaleFactor, 1.25);
    assert.equal(row.page.visualScale, 1);
    assert.equal(row.page.fontStatus, 'loaded');
    assert.equal(
      row.page.resourceBufferOverflow,
      0,
      'ResourceTiming overflow makes font counts incomplete.',
    );
    assert.ok(['#/', ''].includes(row.page.routeHash), 'Measure the same home route.');
    row.startup = await until(async () =>
      (await lines(startupFile)).slice(previous).find((entry) => entry.points.pageRendered),
    );
    row.native = await lines(nativeFile);
    row.split = summarizeStartupSplit(row.startup, row.native, row.page);
    const first = row.page.marks.find((mark) => mark.name === 'sciencescope.first-render-report');
    row.firstScreenFromSpawnMs = row.page.timeOrigin + first.startTime - row.spawnEpochMs;
    row.cdpAttachedMs = native.attachedMs;
    row.fontResources = summarizeFontResources(row.page);
    assert.equal(row.fontResources.complete, true);
    await until(async () => {
      try {
        return (await stat(rawTrace)).size > 0;
      } catch {
        return false;
      }
    }, 60000);
  } catch (error) {
    row.error = error.message;
  } finally {
    if (native) {
      try {
        row.shutdown = await native.close();
      } catch (error) {
        row.shutdownError = error.message;
      }
    }
    try {
      const trace = sanitizeTrace(await json(rawTrace));
      row.trace = summarizeFontTrace(trace);
      await writeFile(path.join(folder, 'trace.json'), JSON.stringify(trace), { flag: 'wx' });
      await unlink(rawTrace);
      if (!row.trace.complete) row.error ??= row.trace.reason;
    } catch (error) {
      row.error ??= 'Trace: ' + error.message;
    }
    row.finishedAt = new Date().toISOString();
    row.complete = !row.error && !row.shutdownError && row.shutdown?.remaining.length === 0;
    await receipt.writeFile(JSON.stringify(row, null, 2));
    await receipt.close();
  }
  console.log(
    JSON.stringify({
      variant: row.variant,
      repetition: row.repetition,
      mode,
      complete: row.complete,
      firstScreenFromSpawnMs: row.firstScreenFromSpawnMs,
      trace: row.trace,
      error: row.error,
      shutdownError: row.shutdownError,
    }),
  );
  assert.equal(row.complete, true, 'Preserve this failed sample; do not silently retry it.');
  return row;
}

async function main() {
  assert.equal(process.platform, 'win32');
  const { values } = parseArgs({
    options: {
      install: { type: 'string' },
      data: { type: 'string' },
      out: { type: 'string' },
      variant: { type: 'string' },
      repetition: { type: 'string', default: '1' },
      inventory: { type: 'string' },
      port: { type: 'string', default: '9411' },
      mode: { type: 'string', default: 'pair' },
      'cold-hook': { type: 'string' },
      'cold-number': { type: 'string' },
    },
  });
  for (const key of ['install', 'data', 'out', 'variant', 'inventory'])
    assert.ok(values[key], '--' + key + ' required');
  assert.ok(['pair', 'probe', 'warm'].includes(values.mode));
  if (values.mode === 'pair') assert.ok(values['cold-hook'] && values['cold-number']);
  const inventory = await json(values.inventory);
  const families = inventory.families ?? [
    ...inventory.Fonts.InstalledSans,
    ...inventory.Fonts.InstalledSerif,
  ];
  const options = {
    install: path.resolve(values.install),
    data: path.resolve(values.data),
    out: path.resolve(values.out),
    variant: values.variant,
    repetition: Number(values.repetition),
    families,
    port: Number(values.port),
    coldHook: values['cold-hook'],
    coldNumber: Number(values['cold-number']),
  };
  assert.equal(options.data, path.join(options.install, 'data'));
  await withFontVariant(options, async (configuration) => {
    const samples = [];
    const modes =
      values.mode === 'pair'
        ? ['cold', 'warm']
        : values.mode === 'warm'
          ? ['warmup', 'warm']
          : ['probe'];
    for (const mode of modes) samples.push(await sample(options, mode));
    await writeFile(
      path.join(options.out, 'pair.json'),
      JSON.stringify(
        {
          configuration,
          samples,
          protocol:
            'Identical startup tracing in every sample. Windows file/standby caches purged only before cold; persistent browser and Windows font caches are not separately cleared. The warm sample follows without changing files.',
        },
        null,
        2,
      ),
      { flag: 'wx' },
    );
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
