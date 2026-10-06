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

const { createApp } = await import('./app.js');

const token = randomBytes(32).toString('hex');
let closing;
const app = await createApp({ dataRoot, token, onShutdown: () => void shutdown() });
const url = await app.listen({ port: Number(values.port ?? 0) });
// `ui` opens the interface in the native window or, during development, a browser.
const ui = `${url}/?token=${token}`;
process.stdout.write(
  `${JSON.stringify({ url, token, ui, dataRoot: app.core.paths.root, shutdownPath: '/api/shutdown', shutdownToken: token })}\n`,
);

async function shutdown() {
  closing ??= app.close();
  await closing;
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
