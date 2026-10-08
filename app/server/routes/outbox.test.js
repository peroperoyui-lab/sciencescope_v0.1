import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../../testing.js';
import { createAppServer } from '../server.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';
import { createConductor } from '../../services/conductor.js';
import { createTurnRunner } from '../../services/turn-runner.js';
import { createContextAssembly } from '../../services/context-assembly.js';
import { createTools } from '../../services/tools.js';

test('meeting outbox API supports enqueue, edit, cancel, pause, resume and cancel all', () =>
  withCore('outbox-http', async (core) => {
    const server = createAppServer({ core, token: 'test' });
    const url = await server.listen();
    const call = async (method, route, body) => {
      const response = await fetch(url + route, {
        method,
        headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    try {
      const meeting = core.meetings.create({});
      const base = '/api/meetings/' + meeting.id + '/outbox';
      const first = await call('POST', base, {
        text: '待发1',
        refs: { attachments: [{ name: '材料' }] },
      });
      const second = await call('POST', base, { text: '待发2' });
      const listed = await call('GET', base);
      assert.equal(listed.items.length, 2);
      assert.ok(listed.version > first.state.version);
      assert.equal(core.messages.since(meeting.id, 0).length, 0);
      assert.equal(
        (await call('PATCH', base + '/' + first.item.id, { text: '已编辑' })).items[0].text,
        '已编辑',
      );
      assert.equal((await call('DELETE', base + '/' + second.item.id)).items.length, 1);
      assert.equal((await call('POST', base + '/pause')).paused, true);
      assert.equal((await call('POST', base + '/resume')).paused, false);
      assert.equal((await call('DELETE', base)).items.length, 0);
    } finally {
      await server.close();
    }
  }));

test('ordinary message HTTP submission returns queue acknowledgments while another answer runs', () =>
  withCore('outbox-submit-http', async (core) => {
    let release = () => {};
    const held = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    let calls = 0;
    const runtime = createScriptedRuntime({
      script: async function* () {
        calls++;
        if (calls === 1) await held;
        yield '已回答';
      },
    });
    const runner = createTurnRunner({
      core,
      runtime,
      runtimeName: 'scripted',
      tools: createTools(core),
      contextAssembly: createContextAssembly({
        core,
        defaultModel: async () => ({ provider: 'test', model: 'test' }),
      }),
    });
    const conductor = createConductor({ core, runner });
    conductor.start();
    const server = createAppServer({ core, conductor, token: 'test' });
    const url = await server.listen();
    try {
      const meeting = core.meetings.create({ members: [{ participantId: 'agent_main' }] });
      const send = async (text) => {
        const response = await fetch(url + '/api/meetings/' + meeting.id + '/messages', {
          method: 'POST',
          headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        assert.equal(response.status, 200);
        return response.json();
      };
      const first = await send('立即发送');
      assert.ok(first.id);
      const second = await send('持久排队');
      assert.equal(second.queued, true);
      assert.equal(second.item.text, '持久排队');
      assert.equal(second.state.items.length, 1);
      assert.equal(
        core.messages.since(meeting.id, 0).filter((message) => message.authorId === 'person_user')
          .length,
        1,
      );
      release();
      await conductor.idle();
      assert.equal(core.outbox.list(meeting.id).items.length, 0);
      assert.equal(calls, 2);
    } finally {
      release();
      conductor.stop();
      await conductor.idle();
      await server.close();
    }
  }));
