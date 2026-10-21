import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { openDatabase } from '../../core/db/database.js';
import { migrations } from '../../core/db/migrations/index.js';
import { createEvents } from '../../core/events.js';
import { tempDir } from '../../testing.js';
import { createResearchStore } from './store.js';
import { createResearchSearch } from './search.js';

async function withStore(work) {
  const { dir, cleanup } = await tempDir('research-store');
  const db = await openDatabase(path.join(dir, 'app.sqlite'), {
    migrations,
    backupDir: path.join(dir, 'backups'),
  });
  let id = 0;
  const now = () => '2026-10-06T12:00:00.000Z';
  const events = createEvents(db, { now });
  const store = createResearchStore({ db, events, now, newId: (prefix) => `${prefix}_${++id}` });
  try {
    await work(store, events, db);
  } finally {
    db.close();
    await cleanup();
  }
}

test('a v2 research upgrade backs up and preserves project and meeting messages', async () => {
  const { dir, cleanup } = await tempDir('research-upgrade');
  const file = path.join(dir, 'app.sqlite');
  const backupDir = path.join(dir, 'backups');
  try {
    const old = await openDatabase(file, { migrations: migrations.slice(0, 2), backupDir });
    old
      .prepare(
        `INSERT INTO projects (id, name, dir_name, created_at, updated_at)
      VALUES ('project', 'Kept project', 'kept-project', 'now', 'now')`,
      )
      .run();
    old
      .prepare(
        `INSERT INTO participants (id, kind, name, created_at)
      VALUES ('person', 'human', 'User', 'now')`,
      )
      .run();
    old
      .prepare(
        `INSERT INTO meetings (id, project_id, title, policy_json, created_at, updated_at)
      VALUES ('meeting', 'project', 'Kept meeting', '{}', 'now', 'now')`,
      )
      .run();
    old
      .prepare(
        `INSERT INTO messages (id, meeting_id, seq, author_id, text, created_at, updated_at)
      VALUES ('message', 'meeting', 1, 'person', 'Kept research discussion', 'now', 'now')`,
      )
      .run();
    old.close();

    const upgraded = await openDatabase(file, { migrations, backupDir });
    try {
      assert.equal(upgraded.prepare('PRAGMA user_version').get().user_version, migrations.length);
      assert.equal(upgraded.prepare('SELECT name FROM projects').get().name, 'Kept project');
      assert.equal(
        upgraded.prepare('SELECT text FROM messages').get().text,
        'Kept research discussion',
      );
      assert.equal(upgraded.prepare('SELECT COUNT(*) AS n FROM rb_sources').get().n, 0);
    } finally {
      upgraded.close();
    }
    const backups = await readdir(backupDir);
    assert.equal(backups.length, 1);
    assert.match(backups[0], /^sciencescope-v2-/u);
    const backedUp = await openDatabase(path.join(backupDir, backups[0]), {
      migrations: migrations.slice(0, 2),
      backupDir: path.join(dir, 'unused'),
    });
    try {
      assert.equal(backedUp.prepare('PRAGMA user_version').get().user_version, 2);
      assert.equal(
        backedUp.prepare('SELECT text FROM messages').get().text,
        'Kept research discussion',
      );
    } finally {
      backedUp.close();
    }
  } finally {
    await cleanup();
  }
});

test('sources keep original identity while parser passages and their index are replaced', async () => {
  await withStore((store, events, db) => {
    db.prepare(
      `INSERT INTO projects (id, name, dir_name, created_at, updated_at)
      VALUES ('project', 'Project', 'project', 'now', 'now')`,
    ).run();
    const source = store.createSource({
      projectId: 'project',
      title: 'Imported paper',
      name: 'paper.pdf',
      mime: 'application/pdf',
      originalPath: 'originals/original.pdf',
      metadata: { doi: '10.1/example' },
      contentStatus: 'queued',
    });
    const personal = store.createSource({ title: 'Personal note' });
    assert.equal(source.label, 'S1');
    assert.equal(personal.label, 'S1');
    assert.equal(events.since(0).length, 1);
    const notifications = [];
    events.subscribe((event) => {
      notifications.push(event);
      assert.equal(store.getSource(source.id).contentStatus, 'parsed');
    });
    store.addChunks(
      source.id,
      [
        {
          text: 'Old sentence',
          page: 4,
          section: 'Results',
          charStart: 10,
          charEnd: 22,
          anchor: { heading: 'Results' },
        },
      ],
      { parser: 'pdfjs', pages: 6 },
    );
    assert.equal(notifications.length, 1);
    const passage = store.chunks(source.id)[0];
    assert.equal(store.getChunk(passage.id).page, 4);
    assert.equal(passage.charStart, 10);
    assert.equal(store.findSource('S1', 'project').id, source.id);
    assert.equal(store.findSource('S99', 'project'), null);
    assert.equal(store.listSources({ projectId: 'project' }).length, 2);
    assert.equal(store.listSources({ projectId: 'project', includePersonal: false }).length, 1);

    db.prepare('DELETE FROM rb_fts').run();
    store.addChunks(source.id, [{ text: 'New sentence', page: 5 }], { parser: 'pdfjs', pages: 6 });
    assert.equal(store.getSource(source.id).originalPath, 'originals/original.pdf');
    assert.deepEqual(store.getSource(source.id).metadata, { doi: '10.1/example' });
    assert.equal(store.chunks(source.id).length, 1);
    assert.equal(store.chunks(source.id)[0].text, 'New sentence');
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM rb_fts WHERE rb_fts MATCH 'Old'").get().n,
      0,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM rb_fts WHERE rb_fts MATCH 'New'").get().n,
      1,
    );

    assert.throws(() => store.addChunks(source.id, [{ text: '' }]), {
      code: 'INVALID_RESEARCH_RECORD',
    });
    assert.equal(store.chunks(source.id)[0].text, 'New sentence');
    assert.equal(notifications.length, 2);
  });
});

test('item edits keep immutable old versions and supersession retains provenance atomically', async () => {
  await withStore((store, events, db) => {
    const original = store.createItem(
      {
        title: 'Finding',
        type: 'knowledge',
        body: 'First version',
        payload: { statement: 'Measured effect' },
        origin: { sourceId: 'S1' },
        visibility: 'private',
      },
      { actorId: 'person' },
    );
    const edited = store.updateItem(
      original.id,
      { body: 'Second version', expectedRevision: 1 },
      {
        actorId: 'agent',
        meetingId: 'meeting',
      },
    );
    assert.equal(edited.revision, 2);
    assert.equal(store.revisions(original.id)[0].snapshot.body, 'First version');
    assert.equal(store.revisions(original.id)[0].changedBy, 'agent');
    assert.equal(store.listItems()[0].visibility, 'private');
    assert.throws(() => store.updateItem(original.id, { body: 'Stale', expectedRevision: 1 }), {
      code: 'REVISION_CONFLICT',
    });
    assert.equal(store.revisions(original.id).length, 1);
    assert.equal(events.since(0).length, 2);

    assert.throws(() =>
      store.supersedeItem(original.id, {
        id: original.id,
        title: 'Duplicate replacement',
        expectedRevision: 2,
      }),
    );
    assert.equal(store.getItem(original.id).status, 'active');
    assert.equal(events.since(0).length, 2);

    const result = store.supersedeItem(
      original.id,
      {
        title: 'Refined finding',
        body: 'Third version',
        expectedRevision: 2,
      },
      { actorId: 'person' },
    );
    assert.equal(result.superseded.status, 'superseded');
    assert.equal(result.superseded.supersededBy, result.item.id);
    assert.equal(result.superseded.revision, 3);
    assert.equal(result.item.visibility, 'private');
    assert.equal(store.revisions(original.id).length, 2);
    assert.equal(store.revisions(original.id)[1].snapshot.body, 'First version');
    assert.equal(store.listItems().length, 1);
    assert.equal(store.listItems({ includeSuperseded: true }).length, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM rb_fts WHERE doc_type = 'item'").get().n, 2);
    assert.equal(events.since(0).length, 3);
    assert.throws(() => store.getItem('missing'), { code: 'ITEM_NOT_FOUND' });
    assert.throws(() => store.getSource('missing'), { code: 'SOURCE_NOT_FOUND' });
  });
});

test('the global knowledge base lists global sources and project literature, not project data', async () => {
  await withStore((store, events, db) => {
    db.prepare(
      `INSERT INTO projects (id, name, dir_name, created_at, updated_at)
      VALUES ('project', 'Project', 'project', 'now', 'now')`,
    ).run();
    const paper = store.createSource({
      projectId: 'project',
      title: 'Project paper',
      kind: 'paper',
    });
    const data = store.createSource({
      projectId: 'project',
      title: 'Project table',
      kind: 'dataset',
    });
    const own = store.createSource({ title: 'Global note' });
    for (const source of [paper, data, own])
      store.addChunks(source.id, [{ text: 'Regional resilience evidence' }], { parser: 'text' });
    const ids = (rows) => rows.map((row) => row.id).sort();
    assert.deepEqual(ids(store.listSources({ knowledge: true })), ids([paper, own]));
    assert.equal(store.countSources({ knowledge: true }), 2);
    assert.deepEqual(
      ids(store.listSources({ projectId: 'project', includePersonal: false })),
      ids([paper, data]),
    );
    const hits = createResearchSearch(store).search('resilience', {
      knowledge: true,
      limit: 20,
    }).hits;
    assert.deepEqual([...new Set(hits.map((hit) => hit.sourceId))].sort(), ids([paper, own]));
  });
});
