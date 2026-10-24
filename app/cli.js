#!/usr/bin/env node
// Command line access to the core, for development and quick checks.
// Uses the same data root rules as app/main.js.
//
//   node app/cli.js projects
//   node app/cli.js project-create <name>
//   node app/cli.js meetings [projectId]
//   node app/cli.js meeting-create <title> [--project <id>]
//   node app/cli.js post <meetingId> <text> [--as <participantId>]
//   node app/cli.js messages <meetingId>
//   node app/cli.js read <resource> <key>
//   node app/cli.js edit <resource> <key> <op> <json-args>
//   node app/cli.js history [resource] [key]
//   node app/cli.js undo <revisionId>
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

process.removeAllListeners('warning');

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    data: { type: 'string' },
    project: { type: 'string' },
    as: { type: 'string' },
  },
});
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot =
  values.data ??
  process.env.SCIENCESCOPE_DATA ??
  path.join(repoRoot, '.sciencescope-local', 'data');

const { createCore } = await import('./core/index.js');
const { LOCAL_USER_ID } = await import('./core/defaults.js');
const { providerSettings } = await import('./services/provider-settings.js');
const { migrateProviderHeaders } = await import('./services/provider-header-migration.js');
const core = await createCore({ dataRoot, settingsResource: providerSettings(dataRoot) });
const user = { actorId: LOCAL_USER_ID };
const [command, ...args] = positionals;

const commands = {
  projects: () => core.projects.list(),
  'project-create': () => core.projects.create({ name: args[0] }, user),
  meetings: () => core.meetings.list({ projectId: args[0] }),
  'meeting-create': () =>
    core.meetings.create(
      {
        projectId: values.project ?? null,
        title: args[0],
        members: [{ participantId: LOCAL_USER_ID }, { participantId: 'agent_main' }],
      },
      user,
    ),
  post: () =>
    core.messages.post({
      meetingId: args[0],
      authorId: values.as ?? LOCAL_USER_ID,
      text: args[1],
    }),
  messages: () => core.messages.list(args[0], { limit: 1000 }).messages,
  read: () => core.workspace.read({ resource: args[0], key: args[1] }),
  edit: () =>
    core.workspace.edit(
      { resource: args[0], key: args[1], op: args[2], args: JSON.parse(args[3] ?? '{}') },
      user,
    ),
  history: () => core.workspace.history({ resource: args[0], key: args[1] }),
  undo: () => core.workspace.undo(args[0], user),
};

try {
  await migrateProviderHeaders(core);
  const run = commands[command];
  if (!run) {
    console.error(`Unknown command. Available: ${Object.keys(commands).join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(await run(), null, 2));
  }
} catch (error) {
  console.error(error.code ? `${error.code}: ${error.message}` : error);
  process.exitCode = 1;
} finally {
  core.close();
}
