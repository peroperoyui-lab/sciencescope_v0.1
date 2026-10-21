import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempDir } from '../../../testing.js';
import { openDatabase } from '../database.js';
import { migrations } from './index.js';

test('v24 catalogs upgrade card checkpoints and entity provenance without changing existing jobs', async () => {
  const fixture = await tempDir('card-upgrade');
  const file = path.join(fixture.dir, 'app.sqlite'),
    backupDir = path.join(fixture.dir, 'backups');
  let db = await openDatabase(file, { migrations: migrations.slice(0, 24), backupDir });
  try {
    db.exec(`INSERT INTO rb_sources(id,number,kind,title,name,created_at,updated_at) VALUES('paper',1,'paper','Title','Title','old','old');
      INSERT INTO kb_jobs(source_id,layer,state,content_version,attempts,updated_at) VALUES('paper','derived','done','hash',0,'old');`);
    db.close();
    db = await openDatabase(file, { migrations: migrations.slice(0, 25), backupDir });
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 25);
    const job = db.prepare('SELECT * FROM kb_jobs').get();
    assert.equal(job.state, 'done');
    assert.equal(job.content_version, 'hash');
    assert.equal(job.result_json, null);
    assert.equal(job.meeting_id, null);
    assert.equal(job.manual, 0);
    assert.ok(
      db
        .prepare('PRAGMA table_info(kb_entities)')
        .all()
        .some((row) => row.name === 'produced_from'),
    );
  } finally {
    db.close();
    await fixture.cleanup();
  }
});
