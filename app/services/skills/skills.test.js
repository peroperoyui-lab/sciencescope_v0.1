import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { tempDir } from '../../testing.js';
import { createApp } from '../../app.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';
import { createBackgroundRunner } from '../secretary/background.js';

test('skills import, appear for every role, load on demand, bind, disable and preserve user copies', async () => {
  const temporary = await tempDir('skills');
  const seen = [];
  const runtime = createScriptedRuntime({
    script: async function* ({ instructions, call }) {
      seen.push(instructions);
      if (instructions.includes('## 已绑定技能')) {
        assert.match(instructions, /固定正文：结论与证据/);
        yield '绑定已生效';
      } else if (instructions.includes('review-format：固定回答格式')) {
        assert.doesNotMatch(instructions, /固定正文：结论与证据/);
        const result = await call('use_skill', { name: 'review-format' });
        assert.match(result.body, /固定正文：结论与证据/);
        assert.equal(path.isAbsolute(result.directory), true);
        yield '按技能回答';
      } else {
        assert.doesNotMatch(instructions, /review-format：/);
        assert.deepEqual(await call('use_skill', { name: 'review-format' }), {
          message: '这个技能已停用。',
        });
        yield '停用已生效';
      }
    },
  });
  const app = await createApp({
    dataRoot: path.join(temporary.dir, 'data'),
    token: 'test',
    runtime,
  });
  const base = await app.listen();
  async function request(method, route, body, expected = 200) {
    const response = await fetch(base + route, {
      method,
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json();
    assert.equal(response.status, expected, JSON.stringify(value));
    return value;
  }
  const skillText =
    '---\nname: review-format\ndescription: 固定回答格式\nlicense: MIT\nextra: {kind: test}\n---\n\n固定正文：结论与证据\n';
  try {
    await request('PATCH', '/api/settings', {
      models: { default: { provider: 'test', model: 'test' } },
      python: { defaultEnvironment: 'system' },
      memory: { enabled: false },
      summary: { onEnterProject: false, onLeaveProject: false },
    });
    const source = path.join(temporary.dir, '输入技能');
    await mkdir(source);
    assert.equal(
      (await request('POST', '/api/skills/import', { path: source }, 400)).code,
      'SKILL_FILE_MISSING',
    );
    await writeFile(path.join(source, 'SKILL.md'), '---\nname: review-format\n---\ninvalid');
    assert.equal(
      (await request('POST', '/api/skills/import', { path: source }, 400)).code,
      'INVALID_SKILL_HEADER',
    );
    await writeFile(path.join(source, 'SKILL.md'), skillText);
    await writeFile(path.join(source, 'reference.txt'), '原件参考');
    const imported = await request('POST', '/api/skills/import', { path: source });
    assert.equal(imported.metadata.extra.kind, 'test');
    assert.equal(
      await readFile(path.join(imported.directory, 'reference.txt'), 'utf8'),
      '原件参考',
    );
    await request('POST', '/api/skills/import', { path: source }, 409);
    const meeting = await request('POST', '/api/meetings', {
      members: [{ participantId: 'agent_main' }],
    });
    await request('POST', `/api/meetings/${meeting.id}/messages`, { text: '按格式审阅' });
    await app.conductor.idle();
    assert.equal(app.core.messages.since(meeting.id, 0).at(-1).text, '按技能回答');
    const tools = await request('GET', '/api/tools');
    assert.ok(
      tools.some(
        (item) => item.name === 'shell' && item.source === 'builtin' && item.needsApproval,
      ),
    );
    assert.ok(tools.some((item) => item.name === 'use_skill' && !item.needsApproval));
    assert.ok(
      tools.some(
        (item) => item.name === 'review-format' && item.source === 'skill' && item.enabled,
      ),
    );
    await request('PATCH', '/api/participants/agent_secretary', {
      skills: ['review-format', 'missing'],
    });
    const background = createBackgroundRunner({
      core: app.core,
      runtime,
      defaultModel: async () => ({ provider: 'test', model: 'test' }),
    });
    const prepared = await background.prepare(meeting.id);
    assert.match(prepared.prompt, /固定正文：结论与证据/);
    assert.doesNotMatch(prepared.prompt, /## 可用技能|use_skill/);
    await background.close();
    const secretary = await request('POST', '/api/meetings', {
      members: [{ participantId: 'agent_secretary' }],
      policy: { mode: 'direct', respondent: 'agent_secretary' },
    });
    await request('POST', `/api/meetings/${secretary.id}/messages`, { text: '按绑定格式整理' });
    await app.conductor.idle();
    assert.equal(app.core.messages.since(secretary.id, 0).at(-1).text, '绑定已生效');
    assert.deepEqual(
      (await request('GET', '/api/skills'))
        .find((item) => item.name === 'review-format')
        .boundRoles.map((item) => item.id),
      ['agent_secretary'],
    );
    await request('PATCH', '/api/settings', { skills: { disabled: ['review-format', 'example'] } });
    await request('POST', `/api/meetings/${secretary.id}/messages`, { text: '技能停用了' });
    await app.conductor.idle();
    assert.equal(app.core.messages.since(secretary.id, 0).at(-1).text, '停用已生效');
    assert.doesNotMatch(seen.at(-1), /## 可用技能|## 已绑定技能/);
    await request('DELETE', '/api/skills/example', undefined, 400);
    const copy = await request('POST', '/api/skills/example/copy');
    assert.equal(copy.source, 'user');
    await writeFile(
      path.join(copy.directory, 'SKILL.md'),
      '---\nname: example\ndescription: 用户修改\n---\n我的副本',
    );
    assert.equal((await request('GET', '/api/skills/example')).body, '我的副本');
    await request('DELETE', '/api/skills/example');
    assert.equal((await request('GET', '/api/skills/example')).source, 'builtin');
    const zip = new JSZip();
    zip.file('打包技能/SKILL.md', skillText.replaceAll('review-format', 'zip-review'));
    zip.file('打包技能/reference.txt', 'ZIP参考');
    const zipped = await request('POST', '/api/skills/import', {
      dataBase64: await zip.generateAsync({ type: 'base64' }),
    });
    assert.equal(zipped.name, 'zip-review');
    assert.equal(await readFile(path.join(zipped.directory, 'reference.txt'), 'utf8'), 'ZIP参考');
    await request('DELETE', '/api/skills/review-format');
    assert.deepEqual(await app.skills.use('review-format'), { message: '找不到这个技能。' });
    assert.equal(seen.length, 3);
  } finally {
    await app.close();
    await temporary.cleanup();
  }
});
