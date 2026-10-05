#!/usr/bin/env node
// Start ScienceScope's local host: open the data root, start the HTTP server
// and print one JSON line `{ "url", "token" }` for the native shell.
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

const { createCore } = await import('./core/index.js');
const { createAppServer } = await import('./server/server.js');

const core = await createCore({ dataRoot });
const token = randomBytes(32).toString('hex');
const server = createAppServer({ core, token });
const url = await server.listen({ port: Number(values.port ?? 0) });
process.stdout.write(`${JSON.stringify({ url, token, dataRoot: core.paths.root })}\n`);

async function shutdown() {
  await server.close();
  core.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
