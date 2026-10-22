import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withCore, tempDir } from '../../testing.js';
import { createApp } from '../../app.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';
import { createVersions } from '../versions/index.js';
import { createProjectFiles } from '../project-files.js';
import { createDesk } from './index.js';
import { createAppServer } from '../../server/server.js';
import { readText, joinText, proposeText, inverseText } from './text.js';
import { writeAtomic } from './storage.js';

test('TeX HTTP edits preserve CRLF, undo a deletion, flush once and create a child version', () =>
  withCore('desk-tex', async (core, dir) => {
    const folder = path.join(dir, '中文文稿');
    await mkdir(folder);
    const project = await core.projects.create({ name: '方法章节', folder });
    const file = path.join(folder, '方法.tex');
    const original =
      '\uFEFF\\section{方法}\r\n\r\n原段。\r\n \t\r\n删段。\r\n\r\n保留公式 $x=1$。\r\n';
    await writeFile(file, original);
    let callback = async () => assert.fail('No idle write scheduled');
    let writes = 0;
    const versions = createVersions(core);
    const desk = createDesk(core, {
      versions,
      projectFiles: createProjectFiles(core),
      schedule: (next) => {
        callback = next;
        return 1;
      },
      cancel: () => {},
      writeWorking: async (target, bytes) => {
        writes++;
        await writeAtomic(target, bytes);
      },
    });
    const server = createAppServer({ core, versions, desk, token: 'text-test' });
    const url = await server.listen();
    const api = async (method, route, body, status = 200) => {
      const response = await fetch(url + '/api/desk/' + route, {
        method,
        headers: { authorization: 'Bearer text-test', 'content-type': 'application/json' },
        body: body == null ? undefined : JSON.stringify(body),
      });
      const value = await response.json();
      assert.equal(response.status, status, JSON.stringify(value));
      return value;
    };
    try {
      const group = await api('POST', 'documents', { projectId: project.id, path: '方法.tex' });
      assert.equal(
        (await desk.registerDocument({ projectId: project.id, path: '方法.tex' })).id,
        group.id,
      );
      assert.equal(group.format, 'tex');
      const opened = await api('POST', 'sessions', { groupId: group.id });
      const id = opened.session.id;
      assert.equal(opened.text, original);
      assert.equal(opened.blocks[0].kind, 'heading');
      const edited =
        original.replace('原段。', '修改段。').replace('删段。\r\n\r\n', '') + '\r\n插段。';
      assert.equal((await api('PUT', `sessions/${id}/text`, { baseSeq: 0, text: edited })).seq, 1);
      assert.equal((await api('PUT', `sessions/${id}/text`, { baseSeq: 1, text: edited })).seq, 1);
      const conflict = await api('PUT', `sessions/${id}/text`, { baseSeq: 0, text: original }, 409);
      assert.equal(conflict.code, 'DESK_CONFLICT');
      assert.equal(conflict.details.text, edited);
      assert.equal(
        (await api('PATCH', `sessions/${id}/blocks`, { baseSeq: 1, blocks: {} }, 400)).code,
        'DESK_FORMAT',
      );
      const changes = (await desk.getSession(id)).changes;
      const removal = changes.find((change) => change.op === 'remove-block');
      assert.ok(removal);
      await desk.undoChange(removal.id);
      const expected = edited.replace('保留公式', '删段。\r\n\r\n保留公式');
      assert.equal((await desk.getSession(id)).text, expected);
      await callback();
      assert.equal(writes, 1);
      await desk.save(id, { to: 'project' });
      assert.deepEqual(await readFile(file), Buffer.from(expected));
      await desk.save(id, { to: 'project' });
      assert.equal(versions.list(project.id)[0].versions.length, 1);
      await desk.settleChanges(id);
      assert.deepEqual((await desk.getSession(id)).changes, []);
      const closed = await desk.closeSession(id);
      assert.equal(closed.version.parentId, opened.session.baseVersionId);
      assert.equal(closed.version.origin, 'desk');
      assert.deepEqual(
        await readFile(core.versionCatalog.file(closed.version.id)),
        Buffer.from(expected),
      );
    } finally {
      await server.close();
      await desk.shutdown();
    }
  }));

test('Markdown source, fences, whitespace and final newline round-trip without normalization', () => {
  const source =
    ' \n# 笔记\n\n段落  \n第二行\n \t\n```python\nprint(1)\n\nprint(2)\n```\n\n## 后记\n';
  const document = readText(Buffer.from(source), 'md');
  assert.equal(joinText(document.blocks), source);
  assert.equal(document.blocks[0].level, 1);
  assert.equal(document.blocks.at(-1).level, 2);
  assert.equal(document.blocks.filter((block) => block.text.includes('print')).length, 1);
  assert.equal(document.blocks[2].text, '```python\nprint(1)\n\nprint(2)\n```');
  for (const value of ['', '\n\t\n', '\uFEFF# 标题\r\n\r\n尾段', '# 标题\n\n尾段\n'])
    assert.equal(joinText(readText(Buffer.from(value), 'md').blocks), value);
  assert.throws(() => readText(Buffer.from([0xff, 0xfe, 0x80]), 'tex'), { code: 'DESK_ENCODING' });
  const original = '\uFEFF首段\n\n末段\n';
  const documentWithBom = readText(Buffer.from(original), 'md');
  let next = 2;
  const state = {
    document: documentWithBom,
    blocks: documentWithBom.blocks,
    session: { seq: 0 },
    allocateId: () => `t:${next++}`,
  };
  const removed = proposeText(state, { baseSeq: 0, text: '\uFEFF末段\n' });
  state.blocks = removed.blocks;
  assert.equal(
    joinText(
      inverseText(
        state,
        removed.records.find((record) => record.op === 'remove-block'),
      ).blocks,
    ),
    original,
  );
});

test('Markdown restart preserves identities, edits and undo; external changes use the saved source hash', async () => {
  const temporary = await tempDir('desk-md');
  let app;
  const make = () =>
    createApp({
      dataRoot: temporary.dir,
      token: 'desk-text',
      runtime: createScriptedRuntime({
        script: async function* () {
          yield 'unused';
        },
      }),
    });
  try {
    app = await make();
    const folder = path.join(temporary.dir, '稿件');
    await mkdir(folder);
    const project = await app.core.projects.create({ name: '笔记', folder });
    const file = path.join(folder, '笔记.markdown');
    const original = '# 笔记\n\n待改。\n\n```js\nlet x = 1;\n\nconsole.log(x);\n```\n';
    await writeFile(file, original);
    const group = await app.desk.registerDocument({ projectId: project.id, path: '笔记.markdown' });
    assert.equal(group.format, 'md');
    const opened = await app.desk.openSession({ groupId: group.id });
    const id = opened.session.id;
    const edited = original.replace('待改。', '已改。');
    await app.desk.updateText(id, { baseSeq: 0, text: edited });
    const before = await app.desk.getSession(id);
    assert.equal(before.changes.length, 1);
    await app.close();
    app = null;
    app = await make();
    const after = await app.desk.openSession({ groupId: group.id });
    assert.equal(after.text, edited);
    assert.deepEqual(after.blocks, before.blocks);
    assert.equal(after.session.seq, 1);
    await app.desk.updateText(id, { baseSeq: 1, text: edited.replace('已改。', '再改。') });
    await assert.rejects(app.desk.undoChange(before.changes[0].id), { code: 'DESK_UNDO_BLOCKED' });
    const last = (await app.desk.getSession(id)).changes.at(-1);
    await app.desk.undoChange(last.id);
    await app.desk.undoChange(before.changes[0].id);
    assert.equal((await app.desk.getSession(id)).text, original);
    await app.desk.updateText(id, { baseSeq: 4, text: edited });
    await app.desk.save(id, { to: 'project' });
    await app.desk.updateText(id, { baseSeq: 5, text: edited + '\n追加。\n' });
    await app.desk.save(id, { to: 'project' });
    await app.desk.closeSession(id);
    await writeFile(file, original + '\n外部修改。\n');
    const external = await app.desk.openSession({ groupId: group.id });
    assert.equal(external.text, original + '\n外部修改。\n');
    assert.equal(app.core.versionCatalog.get(external.session.baseVersionId).origin, 'external');
    await app.desk.updateText(external.session.id, {
      baseSeq: 0,
      text: external.text + '\n未保存。',
    });
    await writeFile(file, original);
    await assert.rejects(app.desk.save(external.session.id, { to: 'project' }), {
      code: 'DESK_EXTERNAL_CHANGE',
    });
  } finally {
    await app?.close();
    await temporary.cleanup();
  }
});
