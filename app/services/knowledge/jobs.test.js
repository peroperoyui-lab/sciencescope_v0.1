import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { withCore } from '../../testing.js';
import { createResearch } from '../research/index.js';
import { createSemantic } from '../research/semantic/index.js';
import { createKnowledgeJobs } from './jobs.js';

const disabled = { status: () => ({ state: 'disabled' }), sourceNeighbors: async () => null };
const edges = (core, relation) =>
  core.db
    .prepare("SELECT * FROM kb_edges WHERE layer='derived' AND relation=? ORDER BY from_ref,to_ref")
    .all(relation);

test('five imported papers resolve DOI/title references, backfill, pause, and reparse without duplicate history', () =>
  withCore('kb-derived-citations', async (core) => {
    const research = createResearch(core);
    const jobs = createKnowledgeJobs({ core, research, semantic: disabled });
    const events = [];
    const unsubscribe = core.events.subscribe((event) => events.push(event));
    await jobs.start();
    try {
      const meeting = await core.meetings.create({ title: 'Research' });
      const turn = core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
      const titles = ['Alpha Study', 'Beta Evidence', 'Gamma Methods', 'Delta Results', '中文研究'];
      const sources = [];
      for (let index = 0; index < titles.length; index++) {
        const next = (index + 1) % titles.length;
        let citation =
          index === 0
            ? 'Doe. Unknown title. https://doi.org/10.1234/BETA.'
            : `Author. 2024. ${titles[next]}. Journal.`;
        if (index === 1) citation = 'Unrelated bibliography entry.\n\n'.repeat(100) + citation;
        if (index === 3) citation = '[4] 张三.中 文，研 究[J].研究学报,2024.';
        sources.push(
          await research.importSource({
            name: `${index}.md`,
            title: titles[index],
            kind: 'paper',
            metadata: index === 1 ? { doi: '10.1234/beta' } : {},
            bytes: Buffer.from(
              `# ${titles[index]}\n\nEvidence ${index}.\n\n## References\n\n${citation}\n`,
            ),
          }),
        );
        await jobs.idle();
        assert.equal(edges(core, 'cites').length, 0);
      }
      assert.equal(jobs.summary().counts.queued, 5);
      core.turns.end(turn.id, { status: 'done' });
      await jobs.idle();
      assert.equal(jobs.summary().counts.skipped, 5);
      assert.equal(edges(core, 'cites').length, 5);
      for (let index = 0; index < sources.length; index++) {
        assert.ok(
          edges(core, 'cites').some(
            (edge) =>
              edge.from_ref === 'source:' + sources[index].id &&
              edge.to_ref === 'source:' + sources[(index + 1) % sources.length].id,
          ),
        );
      }
      const before = edges(core, 'cites');
      await research.reparseSource(sources[0].id);
      await jobs.idle();
      assert.deepEqual(edges(core, 'cites'), before);
      await writeFile(
        path.join(core.paths.library, sources[0].originalPath),
        '# Alpha Study\n\nChanged evidence.\n\n## Bibliography\n\n中文研究\n',
      );
      await research.reparseSource(sources[0].id);
      await jobs.idle();
      const after = edges(core, 'cites');
      assert.equal(after.length, 5);
      assert.ok(
        after.some(
          (edge) =>
            edge.from_ref === 'source:' + sources[0].id &&
            edge.to_ref === 'source:' + sources[4].id,
        ),
      );
      assert.equal(core.db.prepare('SELECT count(*) AS n FROM kb_revisions').get().n, 0);
      assert.equal(core.db.prepare('SELECT count(*) AS n FROM kb_versions').get().n, 0);
      assert.ok(events.some((event) => event.type === 'knowledge.changed'));
      assert.ok(
        events
          .filter((event) => event.type === 'knowledge.jobs.changed')
          .every((event) => event.seq === null),
      );
      assert.ok(after.every((edge) => edge.origin === 'system' && edge.method === 'citation'));
    } finally {
      unsubscribe();
      await jobs.close();
    }
  }));

test('late citations backfill and persistent jobs recover interrupted work with three failures and explicit retry', () =>
  withCore('kb-derived-retry', async (core) => {
    const research = createResearch(core);
    let jobs = createKnowledgeJobs({ core, research, semantic: disabled });
    await jobs.start();
    try {
      const first = await research.importSource({
        name: 'first.md',
        title: 'First',
        kind: 'paper',
        bytes: Buffer.from('# First\n\n## 参考文献\n\nLater Study\n'),
      });
      await jobs.idle();
      assert.equal(edges(core, 'cites').length, 0);
      const second = await research.importSource({
        name: 'later.md',
        title: 'Later Study',
        kind: 'paper',
        bytes: Buffer.from('# Later\n\nEvidence.\n'),
      });
      await jobs.idle();
      assert.equal(edges(core, 'cites')[0].to_ref, 'source:' + second.id);
      await jobs.close();
      core.db
        .prepare("UPDATE kb_jobs SET state='running' WHERE source_id=? AND topic=''")
        .run(first.id);
      let calls = 0,
        broken = true;
      jobs = createKnowledgeJobs({
        core,
        research,
        semantic: disabled,
        derived: {
          reset() {},
          async run() {
            calls++;
            if (broken) throw new Error('fixture index unavailable');
            return 'done';
          },
        },
      });
      await jobs.start();
      await jobs.idle();
      assert.equal(calls, 3);
      assert.equal(jobs.summary().counts.failed, 1);
      assert.equal(jobs.summary().failed[0].error, 'fixture index unavailable');
      assert.equal(jobs.summary().failed[0].attempts, 3);
      await jobs.idle();
      assert.equal(calls, 3);
      broken = false;
      jobs.retryFailed();
      await jobs.idle();
      assert.equal(calls, 4);
      assert.equal(jobs.summary().counts.failed, 0);
    } finally {
      await jobs.close();
    }
  }));

test('enabling semantic indexing backfills cosine edges only between papers, with three neighbours per endpoint', () =>
  withCore('kb-derived-similar', async (core) => {
    const research = createResearch(core);
    const semantic = createSemantic(core, {
      hardware: async () => ({ supported: true }),
      embed: {
        warmup: async () => {},
        close: async () => {},
        embedPassages: async (texts) =>
          texts.map((text) => {
            const values = new Float32Array(384);
            const angle = Number(/Study (\d)/u.exec(text)?.[1] ?? 0) * 0.1;
            values[0] = Math.cos(angle);
            values[1] = Math.sin(angle);
            if (text.includes('Unrelated')) {
              values[0] = 0;
              values[1] = 0;
              values[2] = 1;
            }
            return values;
          }),
      },
    });
    const jobs = createKnowledgeJobs({ core, research, semantic });
    await semantic.start();
    await jobs.start();
    try {
      const sources = [];
      for (let index = 0; index < 7; index++)
        sources.push(
          await research.importSource({
            name: `${index}.md`,
            title: index === 6 ? 'Unrelated' : `Study ${index}`,
            kind: index === 5 ? 'dataset' : 'paper',
            bytes: Buffer.from(
              index === 0 ? '# Evidence\n\n## References\n\nStudy 1\n' : `Evidence ${index}.`,
            ),
          }),
        );
      await jobs.idle();
      assert.equal(jobs.summary().counts.skipped, 7);
      await semantic.configure('enable');
      await semantic.idle();
      await jobs.idle();
      const result = edges(core, 'similar-to');
      assert.ok(result.length > 0);
      const degrees = new Map();
      for (const edge of result) {
        assert.ok(Number(edge.weight) >= 0.85 && Number(edge.weight) <= 1);
        assert.equal(edge.method, 'similar');
        assert.equal(edge.origin, 'system');
        for (const ref of [edge.from_ref, edge.to_ref]) {
          assert.notEqual(ref, 'source:' + sources[5].id);
          assert.notEqual(ref, 'source:' + sources[6].id);
          degrees.set(ref, (degrees.get(ref) ?? 0) + 1);
        }
      }
      assert.ok([...degrees.values()].every((count) => count <= 3));
      const neighbours = await semantic.sourceNeighbors(
        sources.slice(0, 2).map((source) => source.id),
      );
      assert.ok(Math.abs(neighbours.rankings[0].neighbours[0].score - Math.cos(0.1)) < 1e-6);
      await semantic.configure('rebuild');
      await semantic.idle();
      await jobs.idle();
      assert.deepEqual(edges(core, 'similar-to'), result);
      assert.equal(jobs.summary().counts.failed, 0);

      const citations = edges(core, 'cites');
      assert.equal(citations.length, 1);
      const setting = async (changes) => {
        await core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { knowledge: { similarity: changes } } },
        });
        await jobs.idle();
      };
      assert.deepEqual(
        (await core.workspace.read({ resource: 'settings', key: 'app' })).value.knowledge
          .similarity,
        { threshold: 0.85, maxPerPaper: 3 },
      );
      const meeting = await core.meetings.create({ title: 'Pause rebuild' });
      const turn = core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
      await setting({ maxPerPaper: 1 });
      assert.deepEqual(edges(core, 'similar-to'), result);
      assert.equal(jobs.summary().similarity.state, 'queued');
      core.turns.end(turn.id, { status: 'done' });
      await semantic.idle();
      await jobs.idle();
      const single = edges(core, 'similar-to');
      assert.ok(single.length > 0);
      assert.equal(
        new Set(single.flatMap((edge) => [edge.from_ref, edge.to_ref])).size,
        single.length * 2,
      );
      assert.deepEqual(edges(core, 'cites'), citations);
      // A closer newcomer cannot evict established neighbours with full slots.
      const occupied = research.store.getSource(String(single[0].from_ref).slice(7));
      await research.importSource({
        name: 'new.md',
        title: occupied.title,
        kind: 'paper',
        bytes: Buffer.from('A newly imported paper.'),
      });
      await semantic.idle();
      await jobs.idle();
      for (const previous of single)
        assert.deepEqual(
          edges(core, 'similar-to').find((edge) => edge.id === previous.id),
          previous,
        );
      await setting({ threshold: 1, maxPerPaper: 2 });
      await semantic.idle();
      await jobs.idle();
      assert.ok(edges(core, 'similar-to').every((edge) => edge.weight >= 1));
      assert.deepEqual(edges(core, 'cites'), citations);
      await semantic.configure('disable');
      await setting({ maxPerPaper: 0 });
      assert.equal(edges(core, 'similar-to').length, 0);
      assert.deepEqual(edges(core, 'cites'), citations);
      assert.equal(jobs.summary().similarity.state, 'done');
    } finally {
      await jobs.close();
      await semantic.close();
    }
  }));

test('reparsed paragraphs backfill after indexing even when source-level vectors did not change', () =>
  withCore('kb-derived-reparse-vectors', async (core) => {
    const research = createResearch(core);
    let phase = 'ready';
    const semantic = {
      status: () => ({ state: phase }),
      sourceNeighbors: async (ids, options) =>
        phase === 'ready'
          ? {
              rankings: options.sourceIds.map((id) => ({
                id,
                neighbours: ids
                  .filter((other) => other !== id)
                  .map((other) => ({ id: other, score: 0.9 })),
              })),
            }
          : null,
    };
    const jobs = createKnowledgeJobs({ core, research, semantic });
    await jobs.start();
    try {
      const first = await research.importSource({
        name: 'first.md',
        title: 'First',
        kind: 'paper',
        bytes: Buffer.from('First text.'),
      });
      await research.importSource({
        name: 'second.md',
        title: 'Second',
        kind: 'paper',
        bytes: Buffer.from('Second text.'),
      });
      await jobs.idle();
      assert.equal(edges(core, 'similar-to').length, 1);
      phase = 'indexing';
      research.store.addChunks(first.id, [
        { kind: 'paragraph', text: 'Reparsed text; title and metadata are unchanged.' },
        { kind: 'reference', text: 'Second' },
      ]);
      await jobs.idle();
      assert.equal(jobs.summary().counts.skipped, 1);
      assert.equal(edges(core, 'similar-to').length, 0);
      phase = 'ready';
      core.events.transient('research.semantic.changed', { state: phase });
      await jobs.idle();
      assert.equal(jobs.summary().counts.done, 2);
      assert.equal(edges(core, 'similar-to').length, 1);
      assert.equal(edges(core, 'cites').length, 1);
    } finally {
      await jobs.close();
    }
  }));
