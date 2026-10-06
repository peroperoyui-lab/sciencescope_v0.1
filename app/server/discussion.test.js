// HTTP user paths for persisted meeting policy, reviewer adoption and targeted
// continuation. The real app runs with a scripted model and a fresh data root.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.js';
import { createScriptedRuntime } from '../runtime/scripted.js';

const TOKEN = 'discussion-token';
const MODEL = { provider: 'fixture', model: 'fixture' };
async function createFixture(script) {
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  const parent = path.join(repository, '.sciencescope-local', 'temp', 'r4-3a');
  await mkdir(parent, { recursive: true });
  const folder = await mkdtemp(path.join(parent, 'discussion-api-'));
  let app;
  let url;
  let runtime;
  async function start() {
    runtime = createScriptedRuntime({ script });
    app = await createApp({ dataRoot: folder, token: TOKEN, runtime, runtimeName: 'scripted' });
    url = await app.listen();
  }
  await start();
  return {
    get app() {
      return app;
    },
    get runtime() {
      return runtime;
    },
    async call(method, route, body) {
      const response = await fetch(url + route, {
        method,
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    async restart() {
      await app.close();
      await start();
    },
    async close() {
      await app.close();
      await rm(folder, { recursive: true, force: true });
    },
  };
}
async function panel(fixture) {
  const experts = [];
  for (const [name, panelKind] of [
    ['统计专家', 'expert'],
    ['方法专家', 'expert'],
    ['审核专家', 'reviewer'],
  ]) {
    const response = await fixture.call('POST', '/api/participants', {
      kind: 'ai',
      name,
      definition: {
        name,
        prompt: '研究职责：' + name,
        panel: panelKind,
        enabled: true,
        model: MODEL,
      },
    });
    assert.equal(response.status, 200);
    experts.push(response.body);
  }
  const response = await fixture.call('POST', '/api/meetings', {
    title: '方法讨论',
    members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
  });
  assert.equal(response.status, 200);
  return { meeting: response.body, experts };
}
async function say(fixture, meetingId, text) {
  const posted = await fixture.call('POST', `/api/meetings/${meetingId}/messages`, { text });
  assert.equal(posted.status, 200);
  await fixture.app.conductor.idle();
  return (await fixture.call('GET', `/api/meetings/${meetingId}/messages`)).body.messages;
}

test('a person saves the ordered panel and it survives an application restart', async () => {
  const fixture = await createFixture(async function* () {
    yield 'ready';
  });
  try {
    const { meeting, experts } = await panel(fixture);
    const policy = {
      mode: 'round',
      order: [experts[1].id, experts[0].id],
      reviewer: experts[2].id,
    };
    const saved = await fixture.call('PATCH', `/api/meetings/${meeting.id}`, { policy });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.policy.order, policy.order);
    await fixture.restart();
    const reloaded = await fixture.call('GET', `/api/meetings/${meeting.id}`);
    assert.equal(reloaded.status, 200);
    assert.deepEqual(reloaded.body.policy.order, policy.order);
    assert.equal(reloaded.body.policy.mode, 'round');
    assert.equal(reloaded.body.policy.reviewer, policy.reviewer);
  } finally {
    await fixture.close();
  }
});

test('the API rejects incomplete review adoption and locks an adopted review after Main reads it', async () => {
  const inputs = [];
  const fixture = await createFixture(async function* ({ instructions, input, inputs: history }) {
    inputs.push({ instructions, input });
    if (instructions.includes('你是：审核专家')) {
      if (history.length === 1) {
        yield '审核未完成';
        yield { stop: 'max_tokens' };
      } else yield 'REVIEW_FINAL:两位专家的方法均有依据。';
    } else if (instructions.includes('你是：统计专家')) yield 'STATISTICS_FINAL:检查估计。';
    else if (instructions.includes('你是：方法专家')) yield 'METHOD_FINAL:检查设计。';
    else yield 'MAIN_FOLLOWUP';
  });
  try {
    const { meeting, experts } = await panel(fixture);
    await fixture.call('PATCH', '/api/settings', { models: { default: MODEL } });
    await fixture.call('PATCH', `/api/meetings/${meeting.id}`, {
      policy: { mode: 'round', order: [experts[0].id, experts[1].id], reviewer: experts[2].id },
    });
    const first = await say(fixture, meeting.id, '比较这两种研究方法。');
    assert.deepEqual(
      first.filter((message) => message.turnId).map((message) => message.authorId),
      experts.map((expert) => expert.id),
    );
    const incomplete = first.find((message) => message.authorId === experts[2].id);
    assert.equal(incomplete.status, 'max_tokens');
    assert.equal(incomplete.adopted, false);
    const denied = await fixture.call('PATCH', `/api/messages/${incomplete.id}`, { adopted: true });
    assert.equal(denied.status, 409);
    assert.equal(denied.body.code, 'REVIEW_INCOMPLETE');
    const before = inputs.length;
    const continuation = await fixture.call('POST', `/api/messages/${incomplete.id}/continue`);
    assert.equal(continuation.status, 200);
    await fixture.app.conductor.idle();
    assert.equal(inputs.length, before + 1, 'review continuation runs only the reviewer');
    const second = (await fixture.call('GET', `/api/meetings/${meeting.id}/messages`)).body
      .messages;
    const review = second.at(-1);
    assert.equal(review.authorId, experts[2].id);
    assert.equal(review.status, 'done');
    assert.equal(review.adopted, false);
    const adopted = await fixture.call('PATCH', `/api/messages/${review.id}`, { adopted: true });
    assert.equal(adopted.status, 200);
    assert.equal(adopted.body.adopted, true);
    await fixture.call('PATCH', `/api/meetings/${meeting.id}`, {
      policy: { mode: 'direct', respondent: 'agent_main' },
    });
    await say(fixture, meeting.id, '请主专家根据讨论继续。');
    const main = inputs.findLast((entry) => entry.instructions.includes('你是：主专家'));
    assert.match(main.input, /STATISTICS_FINAL/);
    assert.match(main.input, /METHOD_FINAL/);
    assert.match(main.input, /REVIEW_FINAL/);
    assert.equal(
      (main.input.match(/审核未完成/g) ?? []).length,
      1,
      'the completed adopted review carries its earlier partial once',
    );
    const withdraw = await fixture.call('PATCH', `/api/messages/${review.id}`, { adopted: false });
    assert.equal(withdraw.status, 409);
    assert.equal(withdraw.body.code, 'REVIEW_ALREADY_READ');
    const messages = (await fixture.call('GET', `/api/meetings/${meeting.id}/messages`)).body
      .messages;
    assert.equal(messages.find((message) => message.id === review.id).adoptionLocked, true);
  } finally {
    await fixture.close();
  }
});

test('continuing one expert over HTTP updates only that expert and the latest context usage', async () => {
  const fixture = await createFixture(async function* ({ instructions, inputs }) {
    if (instructions.includes('你是：统计专家') && inputs.length === 1) {
      yield '未完成的统计回答';
      yield { stop: 'max_tokens' };
      return;
    }
    yield instructions.includes('你是：统计专家') ? '统计续写完成' : '方法回答完成';
  });
  try {
    const { meeting, experts } = await panel(fixture);
    await fixture.call('PATCH', `/api/meetings/${meeting.id}`, {
      policy: { mode: 'round', order: [experts[0].id, experts[1].id], reviewer: null },
    });
    const first = await say(fixture, meeting.id, '检验统计识别。');
    const answer = first.find((message) => message.authorId === experts[0].id);
    assert.equal(answer.status, 'max_tokens');
    const priorTurns = fixture.app.core.turns.running().length;
    assert.equal(priorTurns, 0);
    await fixture.call('POST', `/api/messages/${answer.id}/continue`);
    await fixture.app.conductor.idle();
    const messages = (await fixture.call('GET', `/api/meetings/${meeting.id}/messages`)).body
      .messages;
    assert.deepEqual(
      messages.filter((message) => message.turnId).map((message) => message.authorId),
      [experts[0].id, experts[1].id, experts[0].id],
    );
    const latest = messages.at(-1);
    assert.equal(latest.text, '统计续写完成');
    const response = await fixture.call('GET', `/api/meetings/${meeting.id}/contexts`);
    assert.equal(response.status, 200);
    assert.equal(response.body.length, 2);
    const alpha = response.body.find((entry) => entry.participantId === experts[0].id);
    assert.equal(alpha.turnId, latest.turnId);
    assert.ok(alpha.context.usedTokens > 0);
    assert.equal(
      response.body.find((entry) => entry.participantId === experts[1].id).turnId,
      messages.find((message) => message.authorId === experts[1].id).turnId,
    );
  } finally {
    await fixture.close();
  }
});
