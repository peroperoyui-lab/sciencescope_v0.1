import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withCore } from '../testing.js';
import { LOCAL_USER_ID } from './defaults.js';

test('first start creates the local user and the default AIs as editable files', () =>
  withCore('participants', async (core) => {
    const ids = core.participants.list().map((participant) => participant.id);
    assert.deepEqual(ids, [LOCAL_USER_ID, 'agent_main', 'agent_secretary', 'agent_assistant']);

    const secretary = await core.participants.get('agent_secretary');
    assert.equal(secretary.name, '任务秘书');
    assert.match(secretary.definition.prompt, /纪要/);
    const file = await readFile(path.join(core.paths.agents, 'agent_secretary.md'), 'utf8');
    assert.match(file, /^---\nname: 任务秘书\n---/);
  }));

test('definition changes are revisions that can be undone', () =>
  withCore('participants', async (core) => {
    const reviewer = await core.participants.create({
      kind: 'ai',
      name: '统计审稿人',
      definition: { prompt: '检查统计方法。', skills: ['statistics-review'] },
    });
    await core.participants.updateDefinition(reviewer.id, {
      model: { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
    });
    const changed = await core.participants.get(reviewer.id);
    assert.equal(changed.definition.model.model, 'deepseek-v4.1-flash');
    assert.deepEqual(changed.definition.skills, ['statistics-review']);

    const [latest] = core.workspace.history({ resource: 'agent', key: reviewer.id });
    await core.workspace.undo(latest.id);
    assert.equal((await core.participants.get(reviewer.id)).definition.model, null);
  }));

test('a definition edited outside the app is picked up, including its name', () =>
  withCore('participants', async (core) => {
    const file = path.join(core.paths.agents, 'agent_main.md');
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace('name: 主专家', 'name: 首席研究员'), 'utf8');

    const main = await core.participants.get('agent_main');
    assert.equal(main.name, '首席研究员');
    assert.equal(core.participants.list().find((p) => p.id === 'agent_main').name, '首席研究员');
    const [external] = core.workspace.history({ resource: 'agent', key: 'agent_main' });
    assert.equal(external.op, 'external');
  }));
