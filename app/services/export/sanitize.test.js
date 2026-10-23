import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { sanitizeSnapshot, REMOVED_VALUE } from './sanitize.js';

test('redaction discovers provider configuration while preserving ordinary metadata and relationship identities', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE revisions (resource TEXT,before_text TEXT,after_text TEXT,after_hash TEXT);
      CREATE TABLE resource_snapshots (resource TEXT,content_text TEXT,content_hash TEXT);
      CREATE TABLE sources (id TEXT PRIMARY KEY,name TEXT,metadata_json TEXT);
      CREATE TABLE links (source_id TEXT REFERENCES sources(id),from_ref TEXT,payload_json TEXT);
      CREATE TABLE events (payload_json TEXT);
    `);
    const publicId = 'shared-public-value';
    const oldHeader = 'FAKE_OLD_PROVIDER_HEADER';
    const currentHeader = 'FAKE_CURRENT_PROVIDER_HEADER';
    const provider = (header) => ({
      providers: [
        { id: publicId, name: publicId, headers: { 'X-Token': header, 'X-Common': publicId } },
      ],
    });
    db.prepare('INSERT INTO revisions VALUES(?,?,?,?)').run(
      'settings',
      JSON.stringify(provider(oldHeader)),
      JSON.stringify(provider(currentHeader)),
      'old-hash',
    );
    db.prepare('INSERT INTO resource_snapshots VALUES(?,?,?)').run(
      'settings',
      JSON.stringify(provider(oldHeader)),
      'old-hash',
    );
    db.prepare('INSERT INTO sources VALUES(?,?,?)').run(
      publicId,
      publicId,
      JSON.stringify({
        headers: { 'Research field': 'ordinary metadata value' },
        id: publicId,
      }),
    );
    db.prepare('INSERT INTO links VALUES(?,?,?)').run(
      publicId,
      `source:${publicId}`,
      JSON.stringify({
        sourceId: publicId,
        ref: `source:${publicId}`,
        keyRef: publicId,
        name: publicId,
        text: `Historical values: ${oldHeader}; ${currentHeader}; ${publicId}`,
      }),
    );
    db.prepare('INSERT INTO events VALUES(?)').run(
      JSON.stringify({
        headers: { 'Article section': 'ordinary metadata value' },
        nested: JSON.stringify({ old: oldHeader, current: currentHeader }),
      }),
    );
    const result = sanitizeSnapshot(db, provider(currentHeader), () => {});
    assert.equal(result.configuration.providers[0].id, publicId);
    assert.equal(result.configuration.providers[0].name, publicId);
    assert.deepEqual(result.configuration.providers[0].headers, {
      'X-Token': REMOVED_VALUE,
      'X-Common': REMOVED_VALUE,
    });
    const source = db.prepare('SELECT * FROM sources').get();
    assert.equal(source.id, publicId);
    assert.equal(source.name, publicId);
    assert.deepEqual(JSON.parse(String(source.metadata_json)).headers, {
      'Research field': 'ordinary metadata value',
    });
    const link = db.prepare('SELECT * FROM links').get();
    assert.equal(link.source_id, publicId);
    assert.equal(link.from_ref, `source:${publicId}`);
    const payload = JSON.parse(String(link.payload_json));
    for (const key of ['sourceId', 'keyRef', 'name']) assert.equal(payload[key], publicId);
    assert.equal(payload.ref, `source:${publicId}`);
    assert.equal(
      payload.text,
      `Historical values: ${REMOVED_VALUE}; ${REMOVED_VALUE}; ${REMOVED_VALUE}`,
    );
    const event = JSON.parse(String(db.prepare('SELECT * FROM events').get().payload_json));
    assert.deepEqual(event.headers, { 'Article section': 'ordinary metadata value' });
    assert.deepEqual(JSON.parse(event.nested), { old: REMOVED_VALUE, current: REMOVED_VALUE });
  } finally {
    db.close();
  }
});
