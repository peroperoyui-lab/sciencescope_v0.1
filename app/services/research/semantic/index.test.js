import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { withCore, tempDir } from '../../../testing.js';
import { createResearch } from '../index.js';
import { createResearchSearch } from '../search.js';
import { createSemantic } from './index.js';
import { openDatabase } from '../../../core/db/database.js';
import { migrations } from '../../../core/db/migrations/index.js';
import { embeddingManifest } from './model-assets.js';

const hardware = async () => ({
  supported: true,
  avx2: true,
  memoryBytes: 16 * 1024 ** 3,
  freeBytes: 10 * 1024 ** 3,
});

test(
  'idle includes rebuilds requested while earlier indexing passes are running',
  { timeout: 30000 },
  async (t) => {
    await withCore('semantic-idle-rebuilds', async (core) => {
      const research = createResearch(core);
      const source = await material(research);
      let releaseThird = () => {};
      let enteredThird = () => {};
      const third = new Promise((resolve) => {
        enteredThird = () => resolve(undefined);
      });
      const gate = new Promise((resolve) => {
        releaseThird = () => resolve(undefined);
      });
      const embed = fakeEmbedding();
      const passages = embed.embedPassages;
      let calls = 0,
        passes = 0,
        settled = false,
        previousState;
      // Production scheduling is unref'ed; keep this gated test alive until its deadline.
      const keepAlive = setTimeout(() => {}, 30000);
      embed.embedPassages = async (texts) => {
        if (++calls === 3) {
          enteredThird();
          await gate;
        }
        return passages(texts);
      };
      const semantic = createSemantic(core, {
        embed,
        hardware,
        manifest: await embeddingManifest(),
      });
      const unsubscribe = core.events.subscribe((event) => {
        if (event.type !== 'research.semantic.changed') return;
        const changed = previousState !== event.payload.state;
        previousState = event.payload.state;
        if (!changed || event.payload.state !== 'indexing') return;
        if (++passes <= 2) {
          core.db
            .prepare('UPDATE rb_sources SET title=? WHERE id=?')
            .run(`Changed ${passes}`, source.id);
          semantic.rebuild();
        }
      });
      let draining,
        otherDraining,
        otherSettled = false;
      try {
        await semantic.start();
        await semantic.configure('enable');
        draining = semantic.idle().then(() => {
          settled = true;
        });
        otherDraining = semantic.idle().then(() => {
          otherSettled = true;
        });
        await third;
        t.diagnostic(
          JSON.stringify({
            passes,
            calls,
            idleSettled: settled,
            state: semantic.status().state,
            neighboursIsNull: (await semantic.sourceNeighbors([source.id])) === null,
          }),
        );
        assert.equal(semantic.status().state, 'indexing');
        assert.equal(
          settled,
          false,
          'idle returned before the queued third indexing pass completed',
        );
        assert.equal(otherSettled, false, 'concurrent idle must join the next indexing pass');
        releaseThird();
        await draining;
        await otherDraining;
        assert.equal(semantic.status().state, 'ready');
        assert.equal(passes, 3);
        assert.equal(calls, 3);
        assert.ok(await semantic.sourceNeighbors([source.id]));
      } finally {
        releaseThird();
        await draining;
        await otherDraining;
        await semantic.idle();
        unsubscribe();
        await semantic.close();
        clearTimeout(keepAlive);
      }
    });
  },
);

function fakeEmbedding() {
  const vector = (text) => {
    const result = new Float32Array(384);
    result[/heart|cardiac|cardiovascular/u.test(text) ? 0 : /garden|flower/u.test(text) ? 1 : 2] =
      1;
    return result;
  };
  return {
    warmup: async () => {},
    close: async () => {},
    embedQuery: async (text) => vector(text),
    embedPassages: async (texts) => texts.map(vector),
  };
}

async function material(research) {
  return research.importSource({
    name: 'methods.txt',
    bytes: Buffer.from(
      'Cardiac rehabilitation improves cardiovascular recovery.\n\nFlower gardens require soil and water.',
    ),
  });
}

test('shared local hybrid search ranks semantic passages and preserves source citations across index rebuild', async () => {
  await withCore('r4-1b-semantic', async (core) => {
    const research = createResearch(core);
    const source = await material(research);
    const semantic = createSemantic(core, { embed: fakeEmbedding(), hardware });
    const keyword = createResearchSearch(research.store).search;
    try {
      await semantic.start();
      assert.equal(semantic.status().enabled, false);
      await semantic.configure('enable');
      await semantic.idle();
      const result = await semantic.search('heart recovery', {}, keyword);
      assert.equal(result.mode, 'hybrid');
      assert.equal(result.hits[0].type, 'chunk');
      assert.match(result.hits[0].text, /Cardiac/u);
      assert.equal(result.hits[0].citation, '[S1]');
      assert.equal(
        (await core.workspace.read({ resource: 'settings', key: 'app' })).value.semantic.enabled,
        true,
      );
      core.db.exec('DELETE FROM rb_vec; DELETE FROM rb_vec_docs;');
      assert.equal((await semantic.search('heart recovery', {}, keyword)).mode, 'keyword');
      assert.equal(research.store.getSource(source.id).id, source.id);
      assert.ok(research.store.chunks(source.id).length);
      await semantic.idle();
      assert.equal((await semantic.search('heart recovery', {}, keyword)).mode, 'hybrid');
    } finally {
      await semantic.close();
    }
  });
});

test('missing model and timed out or mismatched vectors fall back for the complete keyword request', async () => {
  await withCore('r4-1b-fallback', async (core) => {
    const research = createResearch(core);
    await material(research);
    const keyword = createResearchSearch(research.store).search;
    let downloaded = 0;
    let semantic = createSemantic(core, {
      hardware,
      verifyFiles: async () => false,
      downloadFiles: async () => {
        downloaded++;
      },
    });
    try {
      await semantic.start();
      await semantic.configure('enable');
      await semantic.idle();
      assert.equal(semantic.status().state, 'model-missing');
      assert.equal(downloaded, 0);
      const missing = await semantic.search('recovery', {}, keyword);
      assert.equal(missing.mode, 'keyword');
      assert.deepEqual(missing.hits, keyword('recovery').hits);
      await semantic.download();
      await semantic.idle();
      assert.equal(downloaded, 1);
      await semantic.close();
      const embed = fakeEmbedding();
      embed.embedQuery = async () => new Promise(() => {});
      semantic = createSemantic(core, { embed, hardware, timeoutMs: 10 });
      await semantic.start();
      await semantic.idle();
      const timeout = await semantic.search('recovery', {}, keyword);
      assert.equal(timeout.mode, 'keyword');
      assert.equal(timeout.fallbackReason, 'timeout');
      assert.deepEqual(timeout.hits, keyword('recovery').hits);
      core.db.prepare("UPDATE rb_vec_docs SET model_version='old'").run();
      const mismatch = await semantic.search('recovery', {}, keyword);
      assert.equal(mismatch.mode, 'keyword');
      assert.equal(mismatch.fallbackReason, 'model-version-mismatch');
    } finally {
      await semantic.close();
    }
  });
});

test('dialogue pauses background indexing; completion resumes it with pushed progress and no private agent hits', async () => {
  await withCore('r4-1b-pause', async (core) => {
    const research = createResearch(core);
    await material(research);
    research.store.createItem({
      type: 'knowledge',
      subtype: 'finding',
      title: 'Private cardiac finding',
      body: 'heart recovery',
      visibility: 'private',
    });
    const meeting = await core.meetings.create({ title: 'Active research' });
    const turn = core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
    let batches = 0;
    const embed = fakeEmbedding();
    const embedPassages = embed.embedPassages;
    embed.embedPassages = async (texts) => {
      batches++;
      return embedPassages(texts);
    };
    const semantic = createSemantic(core, { embed, hardware });
    const events = [];
    const unsubscribe = core.events.subscribe((event) => {
      if (event.type === 'research.semantic.changed') events.push(event.payload);
    });
    try {
      await semantic.start();
      await semantic.configure('enable');
      await semantic.idle();
      assert.equal(semantic.status().state, 'paused');
      assert.equal(batches, 0);
      core.turns.end(turn.id, { status: 'done' });
      await semantic.idle();
      assert.equal(semantic.status().state, 'ready');
      assert.ok(events.some((event) => event.state === 'paused'));
      assert.ok(events.some((event) => event.state === 'ready'));
      const result = await semantic.search(
        'heart recovery',
        { audience: 'agent' },
        createResearchSearch(research.store).search,
      );
      assert.equal(result.mode, 'hybrid');
      assert.ok(result.hits.every((hit) => hit.type !== 'item'));
      await semantic.configure('disable');
      assert.equal(
        (await semantic.search('heart recovery', {}, createResearchSearch(research.store).search))
          .mode,
        'keyword',
      );
    } finally {
      unsubscribe();
      await semantic.close();
    }
  });
});

test('migration 004 upgrades an existing research database and preserves canonical source rows', async () => {
  const { dir, cleanup } = await tempDir('r4-1b-migration');
  const database = path.join(dir, 'sciencescope.sqlite');
  const backupDir = path.join(dir, 'backups');
  let db;
  try {
    db = await openDatabase(database, { migrations: migrations.slice(0, 3), backupDir });
    db.prepare(
      "INSERT INTO rb_sources(id,number,kind,title,created_at,updated_at) VALUES('kept',1,'paper','Canonical source','time','time')",
    ).run();
    db.close();
    // This test targets migration 004; later secretary migrations have their own upgrade test.
    db = await openDatabase(database, { migrations: migrations.slice(0, 4), backupDir });
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 4);
    assert.equal(
      db.prepare("SELECT title FROM rb_sources WHERE id='kept'").get().title,
      'Canonical source',
    );
    assert.equal(db.prepare('SELECT count(*) AS n FROM rb_vec_docs').get().n, 0);
    assert.equal((await readdir(backupDir)).length, 1);
  } finally {
    db?.close();
    await cleanup();
  }
});

test('settings callbacks cannot replace downloading status before the explicit model download finishes', async () => {
  await withCore('r4-1b-download-progress', async (core) => {
    let finishDownload = () => {};
    let beganDownload = () => {};
    const began = new Promise((resolve) => {
      beganDownload = () => resolve(undefined);
    });
    const release = new Promise((resolve) => {
      finishDownload = () => resolve(undefined);
    });
    const semantic = createSemantic(core, {
      embed: fakeEmbedding(),
      hardware,
      downloadFiles: async (_directory, _manifest, { onProgress }) => {
        onProgress({ file: 'fake.bin', bytes: 1, total: 2 });
        beganDownload();
        await release;
        onProgress({ done: true });
      },
    });
    const states = [];
    const unsubscribe = core.events.subscribe((event) => {
      if (event.type === 'research.semantic.changed') states.push(event.payload.state);
    });
    try {
      await semantic.start();
      await semantic.download();
      await began;
      await core.workspace.edit({
        resource: 'settings',
        key: 'app',
        op: 'patch',
        args: { changes: { appearance: { theme: 'dark' } } },
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(semantic.status().state, 'downloading');
      assert.ok(
        states.slice(states.indexOf('downloading')).every((state) => state === 'downloading'),
      );
      finishDownload();
      await semantic.idle();
      assert.equal(semantic.status().state, 'ready');
      assert.equal(semantic.status().download.done, true);
    } finally {
      finishDownload();
      unsubscribe();
      await semantic.close();
    }
  });
});

test('startup returns while the opted-in local model warms in the background and reports progress', async () => {
  await withCore('r4-1b-background-warm', async (core) => {
    await core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: { changes: { semantic: { enabled: true } } },
    });
    let releaseWarm = () => {};
    let beganWarm = () => {};
    const warmStarted = new Promise((resolve) => {
      beganWarm = () => resolve(undefined);
    });
    const warmFinished = new Promise((resolve) => {
      releaseWarm = () => resolve(undefined);
    });
    const embed = fakeEmbedding();
    embed.warmup = async () => {
      beganWarm();
      await warmFinished;
    };
    const semantic = createSemantic(core, { embed, hardware });
    try {
      await semantic.start();
      await warmStarted;
      assert.equal(semantic.status().state, 'warming');
      releaseWarm();
      await semantic.idle();
      assert.equal(semantic.status().state, 'ready');
    } finally {
      releaseWarm();
      await semantic.close();
    }
  });
});
