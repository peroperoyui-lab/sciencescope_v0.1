// Assembles the core: database, events, workspace and the primitives.
// Everything above core (runtime, services, server, UI) receives this object.
import { openDatabase } from './db/database.js';
import { migrations } from './db/migrations/index.js';
import { ensureDefaultParticipants } from './defaults.js';
import { createEvents } from './events.js';
import { newId as defaultNewId, nowIso } from './ids.js';
import { createMeetings } from './meetings.js';
import { createMessages } from './messages.js';
import { createInputRecords } from './research-input.js';
import { createDeliverableRecords } from './deliverables.js';
import { createOutbox } from './outbox.js';
import { createGoals } from './goals.js';
import { createParticipants } from './participants.js';
import { dataPaths } from './paths.js';
import { createProjects } from './projects.js';
import { createTurns } from './turns.js';
import { createVersionCatalog } from './version-catalog.js';
import { versionNotesResource } from './workspace/resources/versions.js';
import { agent, minutes, notes, plans } from './workspace/resources/documents.js';
import { journalResource } from './workspace/resources/journal.js';
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
    resources: [
      map,
      plans,
      journalResource(db),
      minutes,
      notes,
      agent,
      settings,
      versionNotesResource(db),
    ],
  });
  const projects = createProjects({ db, events, paths, now, newId });
  const participants = createParticipants({ db, events, workspace, now, newId });
  const meetings = createMeetings({ db, events, now, newId, paths });
  const goals = createGoals({ db, events, meetings, now });
  goals.recover();
  const deliverables = createDeliverableRecords({ db, now, newId });
  const inputRecords = createInputRecords(db);
  const messages = createMessages({ db, events, meetings, now, newId, deliverables, inputRecords });
  const outbox = createOutbox({ db, events, meetings, messages, now, newId });
  outbox.recover();
  const turns = createTurns({ db, events, meetings, now, newId });

  await ensureDefaultParticipants({ db, participants });

  const core = {
    db,
    paths,
    events,
    workspace,
    projects,
    participants,
    meetings,
    goals,
    messages,
    deliverables,
    outbox,
    turns,
    close: () => db.close(),
  };
  return { ...core, versionCatalog: createVersionCatalog(core) };
}

/** @typedef {Awaited<ReturnType<typeof createCore>>} Core */
