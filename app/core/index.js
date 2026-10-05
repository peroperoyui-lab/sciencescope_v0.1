// Assembles the core: database, events, workspace and the primitives.
// Everything above core (runtime, services, server, UI) receives this object.
import { openDatabase } from './db/database.js';
import { migrations } from './db/migrations/index.js';
import { ensureDefaultParticipants } from './defaults.js';
import { createEvents } from './events.js';
import { newId as defaultNewId, nowIso } from './ids.js';
import { createMeetings } from './meetings.js';
import { createMessages } from './messages.js';
import { createParticipants } from './participants.js';
import { dataPaths } from './paths.js';
import { createProjects } from './projects.js';
import { createTurns } from './turns.js';
import { agent, log, minutes, notes, plans } from './workspace/resources/documents.js';
import { map } from './workspace/resources/map.js';
import { settings } from './workspace/resources/settings.js';
import { createWorkspace } from './workspace/workspace.js';

/**
 * @param {{ dataRoot: string, now?: () => string, newId?: (prefix: string) => string }} options
 */
export async function createCore({ dataRoot, now = nowIso, newId = defaultNewId }) {
  const paths = dataPaths(dataRoot);
  const db = await openDatabase(paths.database, { migrations, backupDir: paths.backups });
  const events = createEvents(db, { now });
  const workspace = createWorkspace({
    db,
    events,
    paths,
    now,
    newId,
    resources: [map, plans, log, minutes, notes, agent, settings],
  });
  const projects = createProjects({ db, events, paths, now, newId });
  const participants = createParticipants({ db, events, workspace, now, newId });
  const meetings = createMeetings({ db, events, now, newId });
  const messages = createMessages({ db, events, meetings, now, newId });
  const turns = createTurns({ db, events, meetings, now, newId });

  await ensureDefaultParticipants({ db, participants });

  return {
    paths,
    events,
    workspace,
    projects,
    participants,
    meetings,
    messages,
    turns,
    close: () => db.close(),
  };
}

/** @typedef {Awaited<ReturnType<typeof createCore>>} Core */
