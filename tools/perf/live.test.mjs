import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { runLive } from './live.mjs';

test('live measurement keeps production triggers, sends twenty distinct rounds and retains a failed attempt', async () => {
  const parent = path.resolve('.sciencescope-local/temp/p4b');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'live-fake-'));
  function fixture(failed = false) {
    const calls = [];
    let latest;
    const api = async (method, route, body) => {
      calls.push({ method, route, body });
      if (route === '/api/settings')
        return {
          summary: {
            everyMessages: { enabled: true, n: 20 },
            everyTokens: { enabled: true, n: 30000 },
          },
          memory: { enabled: true, idleMinutes: 10, tokenLimit: 100000 },
          knowledge: { cards: { enabled: true } },
        };
      if (route === '/api/projects') return { id: 'prj_fake' };
      if (route.startsWith('/api/version-preferences/')) return { autoOrganize: true };
      if (route === '/api/meetings') return { id: 'mtg_fake' };
      if (route.endsWith('/focus')) return {};
      if (method === 'POST' && route.endsWith('/messages')) {
        const round = body.refs.p4aRound;
        latest = { id: `msg_${round}`, round };
        return { id: latest.id };
      }
      if (route.includes('/messages?'))
        return {
          messages: [
            {
              id: `answer_${latest.round}`,
              authorId: 'agent_main',
              replyTo: latest.id,
              status: failed ? 'failed' : 'done',
              turnId: `turn_${latest.round}`,
              text: '合成确认。',
            },
          ],
        };
      if (route === '/api/research/sources') return { id: 'src_fake' };
      if (route === '/api/versions/import')
        return {
          group: { id: 'group_fake' },
          versions: [{ id: 'version_1' }, { id: 'version_2' }],
        };
      if (route.endsWith('/memory/status'))
        return { state: 'completed', tokenLimit: 100000, proposalIds: ['proposal_fake'] };
      if (route.endsWith('/minutes'))
        return { throughSeq: 40, latestSeq: 40, newMessages: 0, updating: false };
      if (route.startsWith('/api/versions?'))
        return [
          {
            versions: [
              { id: 'version_1', notesStatus: 'completed' },
              { id: 'version_2', notesStatus: 'completed' },
            ],
          },
        ];
      if (route === '/api/knowledge/jobs') return { counts: {}, cards: { counts: { done: 1 } } };
      throw new Error(`Unexpected fake request ${method} ${route}`);
    };
    return { calls, api };
  }
  const good = fixture();
  const report = await runLive(good.api, { out: path.join(root, 'complete.json'), idleMs: 0 });
  assert.equal(report.ok, true);
  assert.equal(report.defaults.memory.tokenLimit, 100000);
  assert.equal(report.defaults.versionPreferences.autoOrganize, true);
  const submissions = good.calls.filter(
    (call) => call.method === 'POST' && call.route.endsWith('/messages'),
  );
  assert.equal(submissions.length, 20);
  assert.equal(new Set(submissions.map((call) => call.body.text)).size, 20);
  assert.equal(
    good.calls.some((call) => call.method === 'PATCH'),
    false,
  );
  assert.equal(
    good.calls.some((call) => /consolidate|\/update$/u.test(call.route)),
    false,
  );
  const bad = fixture(true);
  const failedOut = path.join(root, 'failed.json');
  await assert.rejects(runLive(bad.api, { out: failedOut, idleMs: 0 }), /retained attempts/);
  const failed = JSON.parse(await readFile(failedOut, 'utf8'));
  assert.equal(failed.ok, false);
  assert.equal(failed.rounds.length, 1);
  assert.equal(failed.rounds[0].status, 'failed');
  const before = bad.calls.length;
  await assert.rejects(runLive(bad.api, { out: failedOut, idleMs: 0 }), /already exists/);
  assert.equal(bad.calls.length, before);
});
