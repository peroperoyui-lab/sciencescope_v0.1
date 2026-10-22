import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../testing.js';
import { createAppServer } from './server.js';

const TOKEN = 'test-token';

/** Start a server on a fresh core and give the test a small fetch helper. */
function withServer(work) {
  return withCore('server', async (core) => {
    const server = createAppServer({ core, token: TOKEN });
    const url = await server.listen();
    const call = async (method, route, body) => {
      const response = await fetch(`${url}${route}`, {
        method,
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };
    try {
      return await work({ url, call, core });
    } finally {
      await server.close();
    }
  });
}

test('the API creates a project and meeting, posts messages and pages them', () =>
  withServer(async ({ call }) => {
    const project = (await call('POST', '/api/projects', { name: '项目' })).body;
    const meeting = (
      await call('POST', '/api/meetings', {
        projectId: project.id,
        title: '讨论',
        members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
      })
    ).body;
    await call('POST', `/api/meetings/${meeting.id}/messages`, { text: '你好' });
    const page = (await call('GET', `/api/meetings/${meeting.id}/messages?limit=10`)).body;
    assert.deepEqual(
      page.messages.map((message) => [message.authorId, message.text]),
      [['person_user', '你好']],
    );
    const meetings = (await call('GET', `/api/meetings?projectId=${project.id}`)).body;
    assert.equal(meetings.length, 1);
  }));

test('resource edits, history and undo go through the API', () =>
  withServer(async ({ call }) => {
    const project = (await call('POST', '/api/projects', { name: '项目' })).body;
    const edited = await call('POST', '/api/resources/plans', {
      key: project.id,
      op: 'append',
      args: { text: '- [ ] 写引言' },
    });
    assert.equal(edited.body.value, '- [ ] 写引言');
    const history = (await call('GET', `/api/revisions?resource=plans&key=${project.id}`)).body;
    assert.equal(history[0].actorId, 'person_user');
    await call('POST', `/api/revisions/${history[0].id}/undo`);
    const plans = (await call('GET', `/api/resources/plans?key=${project.id}`)).body;
    assert.equal(plans.exists, false);

    const settings = (await call('PATCH', '/api/settings', { appearance: { theme: 'dark' } })).body;
    assert.equal(settings.appearance.theme, 'dark');
  }));

test('errors carry a code and a status; the token is required', () =>
  withServer(async ({ url, call }) => {
    const missing = await call('GET', '/api/meetings/nope');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, 'MEETING_NOT_FOUND');
    const anonymous = await fetch(`${url}/api/projects`);
    assert.equal(anonymous.status, 401);
  }));

test('the event stream replays stored events and then sends live ones', () =>
  withServer(async ({ url, call }) => {
    await call('POST', '/api/projects', { name: '早先的项目' });
    const controller = new AbortController();
    const response = await fetch(`${url}/api/events?since=0&token=${TOKEN}`, {
      signal: controller.signal,
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const waitFor = async (needle) => {
      while (!text.includes(needle)) {
        const { value } = await reader.read();
        text += decoder.decode(value);
      }
    };
    await waitFor('早先的项目');
    await call('POST', '/api/projects', { name: '新的项目' });
    await waitFor('新的项目');
    assert.match(text, /event: project.created/);
    controller.abort();
  }));

test('event stream reconnects from Last-Event-ID, not the original since', () =>
  withServer(async ({ url, call }) => {
    await call('POST', '/api/projects', { name: '重连前的项目' });
    const { seq } = (await call('GET', '/api/events/head')).body;
    await call('POST', '/api/projects', { name: '重连后的项目' });
    const controller = new AbortController();
    const response = await fetch(`${url}/api/events?since=0&token=${TOKEN}`, {
      signal: controller.signal,
      headers: { 'last-event-id': String(seq) },
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes('重连后的项目')) text += decoder.decode((await reader.read()).value);
    assert.doesNotMatch(text, /重连前的项目/u);
    controller.abort();
  }));

test('history API captures, previews, restores and deletes saved versions', () =>
  withServer(async ({ call }) => {
    const project = (await call('POST', '/api/projects', { name: '历史项目' })).body;
    const key = project.id;
    await call('POST', '/api/resources/plans', { key, op: 'write', args: { text: '第一版' } });
    const snapshot = (await call('POST', '/api/snapshots', { resource: 'plans', key })).body;
    const unchanged = await call('POST', '/api/snapshots', { resource: 'plans', key });
    assert.equal(unchanged.body, null);
    const listed = (await call('GET', '/api/snapshots?projectId=' + key + '&resource=plans')).body;
    assert.equal(listed[0].id, snapshot.id);
    assert.equal((await call('GET', '/api/snapshots/' + snapshot.id)).body.text, '第一版');
    await call('POST', '/api/resources/plans', { key, op: 'write', args: { text: '第二版' } });
    const restored = (await call('POST', '/api/snapshots/' + snapshot.id + '/restore')).body;
    assert.equal(restored.value, '第一版');
    assert.equal(
      (await call('GET', '/api/snapshots/' + restored.preservedSnapshotId)).body.text,
      '第二版',
    );
    assert.equal((await call('DELETE', '/api/snapshots/' + snapshot.id)).body.deleted, true);
    assert.equal((await call('GET', '/api/snapshots/' + snapshot.id)).status, 404);
  }));
