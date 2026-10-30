import test from 'node:test';
import assert from 'node:assert/strict';
import { channel } from 'node:diagnostics_channel';
import { readFile, writeFile } from 'node:fs/promises';
import { withCore } from '../testing.js';
import { settings } from '../core/workspace/resources/settings.js';
import { createScriptedRuntime } from '../runtime/scripted.js';
import { createResearch } from './research/index.js';
import { createSemantic } from './research/semantic/index.js';
import { createPaperCards } from './knowledge/cards.js';
import { createKnowledgeJobs } from './knowledge/jobs.js';
import { createCardQueue } from './knowledge/card-queue.js';
import { paragraphHash } from './knowledge/card-input.js';
import { createMemoryService } from './memory/index.js';

function seedFinished(core, research) {
  const source = research.store.createSource({ title: 'Settings evidence', kind: 'paper' });
  research.store.addChunks(source.id, [{ text: 'Recorded evidence.', page: 1 }]);
  const version = paragraphHash(research.store.chunks(source.id));
  const insert = core.db
    .prepare(`INSERT INTO kb_jobs(source_id,layer,topic,state,content_version,error,updated_at)
    VALUES(?,?,'',?,?,?,'2026-10-30')`);
  insert.run(source.id, 'derived', 'done', version, null);
  insert.run(source.id, 'card', 'skipped', version, 'no-model');
  return source;
}

test('settings consumers skip unrelated fields, reuse committed revisions and retain model, similarity and memory updates', () =>
  withCore('settings-consumers', async (core) => {
    const research = createResearch(core);
    const source = seedFinished(core, research);
    const project = await core.projects.create({ name: 'Settings project' });
    const meetings = Array.from({ length: 2 }, () =>
      core.meetings.create({ projectId: project.id }),
    );
    core.turns.start({ meetingId: meetings[0].id, participantId: 'agent_main' });
    const semantic = createSemantic(core, {
      manifest: { modelId: 'synthetic', revision: '1', dimensions: 384 },
      hardware: async () => ({ supported: true }),
      embed: { warmup: async () => {}, close: async () => {} },
    });
    const runtime = createScriptedRuntime({
      script: async function* () {
        yield assert.fail('A settings edit must not run a model in this fixture.');
      },
    });
    const cards = createPaperCards({ core, research, semantic, runtime });
    const selected = [];
    const selectModel = cards.model;
    cards.model = async (value) => {
      const model = await selectModel(value);
      selected.push(model);
      return model;
    };
    const jobs = createKnowledgeJobs({ core, research, semantic, cards });
    const memory = createMemoryService({
      core,
      research,
      minutes: {},
      runner: { close: async () => {} },
    });
    const observations = channel('sciencescope.settings.performance');
    const seen = [];
    const record = (observation) => seen.push(observation);
    const patch = (changes) =>
      core.workspace.edit({ resource: 'settings', key: 'app', op: 'patch', args: { changes } });
    const settle = async () => {
      await jobs.idle();
      await semantic.idle();
      await memory.idle();
    };
    const count = (stage) =>
      seen.filter((entry) => entry.stage === stage).reduce((sum, entry) => sum + entry.count, 0);
    const replay = (revisionId) =>
      core.events.transient('resource.changed', { resource: 'settings', key: 'app', revisionId });
    try {
      await semantic.start();
      await jobs.start();
      memory.start();
      await core.workspace.read({ resource: 'settings', key: 'app' });
      await settle();
      observations.subscribe(record);
      const initialCalls = selected.length;
      for (const changes of [
        { appearance: { knowledgeView: 'graph' } },
        { profile: { bio: 'Research profile' } },
      ]) {
        seen.length = 0;
        await patch(changes);
        await settle();
        assert.equal(count('workspace.read'), 1);
        assert.equal(count('knowledge.cards.configure'), 0);
        assert.equal(count('knowledge.cards.model'), 0);
        assert.equal(count('knowledge.cards.backfill'), 0);
        assert.equal(count('memory.schedule'), 0);
        assert.equal(count('research.semantic.refreshSettings'), 0);
      }
      assert.equal(selected.length, initialCalls);
      const beforeSimilarity = core.db
        .prepare("SELECT content_version FROM kb_jobs WHERE topic='similar'")
        .get().content_version;
      await patch({ knowledge: { similarity: { threshold: 0.91 } } });
      await settle();
      assert.notEqual(
        core.db.prepare("SELECT content_version FROM kb_jobs WHERE topic='similar'").get()
          .content_version,
        beforeSimilarity,
      );
      const choice = (model) => ({ provider: 'synthetic-provider', model });
      const expectModel = async (changes, model) => {
        core.db
          .prepare("UPDATE kb_jobs SET state='skipped',error='no-model' WHERE layer='card'")
          .run();
        const previous = selected.length;
        await patch(changes);
        await settle();
        assert.equal(selected.length, previous + 1);
        assert.deepEqual(selected.at(-1), choice(model));
        assert.equal(
          core.db
            .prepare("SELECT state FROM kb_jobs WHERE source_id=? AND layer='card'")
            .get(source.id).state,
          'queued',
        );
      };
      await expectModel({ knowledge: { cards: { model: choice('card') } } }, 'card');
      const oldRevision = core.workspace.history({ resource: 'settings', key: 'app', limit: 1 })[0]
        .id;
      await expectModel(
        { knowledge: { cards: { model: null } }, memory: { model: choice('memory') } },
        'memory',
      );
      await expectModel(
        { memory: { model: null }, models: { default: choice('default') } },
        'default',
      );
      seen.length = 0;
      await patch({ memory: { idleMinutes: 20, tokenLimit: 200000 } });
      await settle();
      assert.equal(count('memory.schedule'), meetings.length);
      assert.equal(count('memory.readSettings'), 0);
      assert.equal(count('workspace.read'), 1);
      await expectModel(
        {
          providers: [
            {
              id: 'synthetic-provider',
              baseUrl: 'https://example.invalid',
              api: 'openai-completions',
              keyRef: 'synthetic-ref',
              models: [],
            },
          ],
        },
        'default',
      );
      await core.participants.updateDefinition('agent_secretary', { model: choice('secretary') });
      await settle();
      await expectModel({ models: { default: null } }, 'secretary');
      const latestRevision = core.workspace.history({
        resource: 'settings',
        key: 'app',
        limit: 1,
      })[0].id;
      seen.length = 0;
      const calls = selected.length;
      replay(latestRevision);
      replay(oldRevision);
      await settle();
      assert.equal(count('workspace.read'), 0);
      assert.equal(count('knowledge.cards.configure'), 0);
      assert.equal(count('memory.schedule'), 0);
      assert.equal(selected.length, calls);
      await patch({ appearance: { theme: 'dark' } });
      await settle();
      assert.equal(selected.length, calls);
      const beforeSecretary = selected.length;
      await core.participants.updateDefinition('agent_secretary', {
        model: choice('new-secretary'),
      });
      await settle();
      assert.equal(selected.length, beforeSecretary + 1);
      assert.deepEqual(selected.at(-1), choice('new-secretary'));
      const externallyEdited = JSON.parse(await readFile(core.paths.settings, 'utf8'));
      externallyEdited.profile.bio = 'Externally edited profile';
      await writeFile(core.paths.settings, JSON.stringify(externallyEdited));
      const beforeExternal = selected.length;
      await core.participants.updateDefinition('agent_secretary', {
        model: choice('external-secretary'),
      });
      await settle();
      assert.equal(selected.length, beforeExternal + 1);
      assert.deepEqual(selected.at(-1), choice('external-secretary'));
      assert.equal(
        core.workspace.history({ resource: 'settings', key: 'app', limit: 1 })[0].op,
        'external',
      );
      const beforeOther = selected.length;
      await core.participants.updateDefinition('agent_main', { model: choice('unrelated') });
      await settle();
      assert.equal(selected.length, beforeOther);
      await patch({ semantic: { enabled: true } });
      const enabledRevision = core.workspace.history({
        resource: 'settings',
        key: 'app',
        limit: 1,
      })[0].id;
      await patch({ semantic: { enabled: false }, memory: { enabled: false } });
      await settle();
      replay(enabledRevision);
      await settle();
      assert.equal(semantic.status().enabled, false);
      seen.length = 0;
      await memory.status(meetings[0].id);
      assert.equal(count('memory.readSettings'), 1);
      assert.equal(count('workspace.read'), 1);
    } finally {
      observations.unsubscribe(record);
      await memory.close();
      await jobs.close();
      await semantic.close();
    }
  }));

test('card configuration coalesces pending work and a late model result cannot override a newer disable', () =>
  withCore('settings-card-race', async (core) => {
    const research = createResearch(core);
    const source = seedFinished(core, research);
    /** @type {(value:any)=>void} */
    let release = () => assert.fail('The pending model lookup has not started.');
    let calls = 0;
    const worker = {
      model: async () => {
        calls++;
        if (calls === 1)
          return new Promise((resolve) => {
            release = resolve;
          });
        return null;
      },
      close: async () => {},
    };
    const queue = createCardQueue({
      core,
      research,
      worker,
      busy: () => true,
      notify: () => {},
      schedule: () => {},
    });
    const value = settings.parse(null);
    try {
      const first = queue.configure(value);
      const duplicate = queue.configure(value);
      assert.equal(calls, 1);
      await queue.configure({
        ...value,
        knowledge: { ...value.knowledge, cards: { ...value.knowledge.cards, enabled: false } },
      });
      release({ provider: 'synthetic', model: 'late-result' });
      await Promise.all([first, duplicate]);
      assert.equal(calls, 2);
      assert.equal(
        core.db
          .prepare("SELECT state FROM kb_jobs WHERE source_id=? AND layer='card'")
          .get(source.id).state,
        'skipped',
      );
      assert.deepEqual(queue.pending(), []);
    } finally {
      await queue.close();
    }
  }));

test('a failed card model lookup remains retryable for the same configuration', () =>
  withCore('settings-card-retry', async (core) => {
    const research = createResearch(core);
    const source = seedFinished(core, research);
    let calls = 0;
    const worker = {
      model: async () => {
        if (++calls === 1) throw new Error('temporary definition read failure');
        return { provider: 'synthetic', model: 'recovered' };
      },
      close: async () => {},
    };
    const queue = createCardQueue({
      core,
      research,
      worker,
      busy: () => true,
      notify: () => {},
      schedule: () => {},
    });
    try {
      await assert.rejects(queue.configure(settings.parse(null)), /temporary definition/u);
      await queue.configure(settings.parse(null));
      assert.equal(calls, 2);
      assert.equal(
        core.db
          .prepare("SELECT state FROM kb_jobs WHERE source_id=? AND layer='card'")
          .get(source.id).state,
        'queued',
      );
    } finally {
      await queue.close();
    }
  }));

test('knowledge jobs retry a failed settings revision when its committed event is replayed', () =>
  withCore('settings-jobs-retry', async (core) => {
    const research = createResearch(core);
    const source = seedFinished(core, research);
    const meeting = core.meetings.create({});
    core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
    const saved = await core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: { changes: { profile: { bio: 'Committed settings' } } },
    });
    let calls = 0;
    const cards = {
      start: async () => {},
      close: async () => {},
      model: async () => {
        if (++calls === 1) throw new Error('temporary model lookup failure');
        return { provider: 'synthetic', model: 'recovered' };
      },
    };
    const jobs = createKnowledgeJobs({
      core,
      research,
      cards,
      semantic: { status: () => ({ state: 'disabled' }) },
    });
    try {
      await assert.rejects(jobs.start(), /temporary model lookup/u);
      core.events.transient('resource.changed', {
        resource: 'settings',
        key: 'app',
        revisionId: saved.revisionId,
      });
      await jobs.idle();
      assert.equal(calls, 2);
      assert.equal(
        core.db
          .prepare("SELECT state FROM kb_jobs WHERE source_id=? AND layer='card'")
          .get(source.id).state,
        'queued',
      );
    } finally {
      await jobs.close();
    }
  }));
