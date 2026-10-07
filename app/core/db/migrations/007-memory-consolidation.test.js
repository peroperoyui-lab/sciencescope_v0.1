import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { tempDir } from '../../../testing.js';
import { openDatabase } from '../database.js';
import { migrations } from './index.js';
import { createCore } from '../../index.js';
import { createResearch } from '../../../services/research/index.js';
import { createMemoryService } from '../../../services/memory/index.js';

test('v6 upgrade and reopen preserve proposal history plus an extracted checkpoint that resumes verification', async () => {
  const { dir, cleanup } = await tempDir('memory-migration');
  const file = path.join(dir, 'sciencescope.sqlite');
  const backupDir = path.join(dir, 'backups');
  let database;
  let core;
  let service;
  try {
    database = await openDatabase(file, { migrations: migrations.slice(0, 6), backupDir });
    database.close();
    database = null;
    core = await createCore({ dataRoot: dir });
    const project = await core.projects.create({ name: '重启保留' });
    const meeting = core.meetings.create({ projectId: project.id });
    const source = core.messages.post({
      meetingId: meeting.id,
      authorId: 'person_user',
      text: '来源决定',
    });
    const revision = await core.workspace.edit(
      { resource: 'minutes', key: meeting.id, op: 'write', args: { text: '来源决定 #1' } },
      { actorId: 'agent_secretary' },
    );
    core.db
      .prepare('INSERT INTO minutes_coverage VALUES (?, ?, ?, ?)')
      .run(revision.revisionId, meeting.id, 1, JSON.stringify([source.id]));
    const minutes = { coverage: () => 1, coveredMessageIds: () => [source.id] };
    core.db.prepare('INSERT INTO memory_checkpoints VALUES (?, ?)').run(
      meeting.id,
      JSON.stringify({
        model: { provider: 'test', model: 'test' },
        input: {
          meetingId: meeting.id,
          minutesRevision: revision.revisionId,
          throughSeq: 1,
          minutesHash: (await import('../../../services/memory/store.js')).hash('来源决定 #1'),
          messages: [
            {
              id: source.id,
              text: source.text,
              sha256: (await import('../../../services/memory/store.js')).hash(source.text),
            },
          ],
          delta: {},
        },
        pages: [],
        pageIndex: 0,
        stage: 'verify',
        verificationIndex: 0,
        outputs: [],
        candidates: [
          {
            subtype: 'decision',
            title: '恢复的候选',
            body: '来源决定',
            evidence: [{ meetingId: meeting.id, messageId: source.id, seq: 1, quote: source.text }],
            originTrust: 'user',
            sourceRefs: [],
            candidateHash: 'saved',
          },
        ],
      }),
    );
    core.close();
    core = await createCore({ dataRoot: dir });
    const research = createResearch(core);
    let requests = 0;
    const runner = {
      prepare: async () => ({
        model: { provider: 'test', model: 'test' },
        prompt: '',
        outputTokens: 100,
      }),
      close: async () => {},
      run: async (meetingId, instructions) => {
        assert.match(instructions, /memory verification/);
        requests += 1;
        const turn = core.turns.start({ meetingId, participantId: 'agent_secretary' });
        core.turns.end(turn.id, { status: 'done' });
        return {
          text: JSON.stringify({
            decisions: [
              { candidateIndex: 0, supported: true, duplicateOf: null, rationale: '已核对' },
            ],
          }),
          turnId: turn.id,
          usage: { totalTokens: 100 },
        };
      },
    };
    service = createMemoryService({ core, research, minutes, runner });
    await service.consolidate(meeting.id);
    assert.equal(requests, 1);
    const item = service.inbox(project.id).items[0];
    const accepted = service.update(item.id, { status: 'active' });
    await service.close();
    service = null;
    core.close();
    core = await createCore({ dataRoot: dir });
    service = createMemoryService({ core, research: createResearch(core), minutes, runner });
    assert.equal(service.history(item.id).length, 2);
    assert.equal(service.undo(accepted.historyId).status, 'proposed');
    assert.equal(core.db.prepare('PRAGMA user_version').get().user_version, 7);
    assert.equal(
      (await readdir(backupDir)).filter((name) => name.startsWith('sciencescope-v6-')).length,
      1,
    );
  } finally {
    await service?.close();
    database?.close();
    core?.close();
    await cleanup();
  }
});
