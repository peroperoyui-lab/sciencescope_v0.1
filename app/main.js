#!/usr/bin/env node
// Start ScienceScope's local host and print one JSON line `{ url, token, ui,
// dataRoot }` for the native shell.
//
//   node app/main.js [--data <folder>] [--port <number>]
//
// Data root: --data, else SCIENCESCOPE_DATA, else .sciencescope-local/data
// (development). The installed app passes its `data/` folder.
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createStartupLog } from './services/startup.js';

// node:sqlite is still marked experimental; its warning is noise for users.
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name !== 'ExperimentalWarning') console.warn(warning);
});

const { values } = parseArgs({
  options: { data: { type: 'string' }, port: { type: 'string' } },
});
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot =
  values.data ??
  process.env.SCIENCESCOPE_DATA ??
  path.join(repoRoot, '.sciencescope-local', 'data');

const startup = createStartupLog(dataRoot, {
  nativeStart: Number(process.env.SCIENCESCOPE_STARTUP_NATIVE_MS) || undefined,
  nodeSpawn: Number(process.env.SCIENCESCOPE_STARTUP_NODE_MS) || undefined,
  nodeStart: performance.timeOrigin,
});
startup.mark('appImportStart');
const { createApp } = await import('./app.js');
startup.mark('appImportEnd');

const token = randomBytes(32).toString('hex');
let closing;
startup.mark('createAppStart');
const app = await createApp({ dataRoot, token, startup, onShutdown: () => void shutdown() });
startup.mark('createAppEnd');
startup.mark('httpListenStart');
const url = await app.listen({ port: Number(values.port ?? 0) });
startup.mark('httpListening');
// `ui` opens the interface in the native window or, during development, a browser.
const ui = `${url}/?token=${token}`;
process.stdout.write(
  `${JSON.stringify({ url, token, ui, dataRoot: app.core.paths.root, shutdownPath: '/api/shutdown', shutdownToken: token })}\n`,
);

async function shutdown() {
  closing ??= app.close();
  await closing;
  await startup.finish();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
