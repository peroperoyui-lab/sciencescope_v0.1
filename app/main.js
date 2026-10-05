#!/usr/bin/env node
// Start ScienceScope's local host and print one JSON line `{ url, token,
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
const app = await createApp({ dataRoot, token });
const url = await app.listen({ port: Number(values.port ?? 0) });
process.stdout.write(`${JSON.stringify({ url, token, dataRoot: app.core.paths.root })}\n`);

async function shutdown() {
  await app.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
