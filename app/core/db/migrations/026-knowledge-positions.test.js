import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempDir } from '../../../testing.js';
import { openDatabase } from '../database.js';
import { migrations } from './index.js';

test('v25 catalogs gain empty layout positions without rewriting knowledge or its history', async () => {
  const fixture = await tempDir('positions-upgrade');
  const file = path.join(fixture.dir, 'app.sqlite'),
    backupDir = path.join(fixture.dir, 'backups');
  let db = await openDatabase(file, { migrations: migrations.slice(0, 25), backupDir });
  try {
    db.exec(`INSERT INTO kb_entities(id,kind,name,layer,origin,created_by,created_at,updated_at)
      VALUES('method','method','Existing method','curated','user','person_user','old','old')`);
    db.close();
    db = await openDatabase(file, { migrations: migrations.slice(0, 26), backupDir });
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 26);
    assert.equal(db.prepare('SELECT name FROM kb_entities').get().name, 'Existing method');
    assert.equal(db.prepare('SELECT count(*) AS n FROM kb_positions').get().n, 0);
    db.exec("INSERT INTO kb_positions(ref,x,y,updated_at) VALUES('entity:method',1.25,-2.5,'now')");
    assert.equal(db.prepare('SELECT pinned FROM kb_positions').get().pinned, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM kb_revisions').get().n, 0);
  } finally {
    db.close();
    await fixture.cleanup();
  }
});
