import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { withCore, tempDir } from '../../testing.js';
import { createApp } from '../../app.js';
import { createCore } from '../../core/index.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';
import { createVersions } from '../versions/index.js';
import { createProjectFiles } from '../project-files.js';
import { createDesk } from './index.js';
import { writeAtomic } from './storage.js';
import { readDocx } from './docx/read.js';
import { writeDocx } from './docx/write.js';
import { WORD } from './docx/xml.js';
import { WORD14 } from './docx/ids.js';
import { createAppServer } from '../../server/server.js';

const p = (id, text, props = '') =>
  `<w:p w14:paraId="${id}">${props}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const text = (value) => [{ text: value }];
async function fixture() {
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="${WORD}" xmlns:w14="${WORD14}"><w:body>` +
      p('00000001', '第一段') +
      p('00000002', '第二段') +
      p('00000003', '第三段') +
      p('00000004', '分节', '<w:pPr><w:sectPr/></w:pPr>') +
      `<w:tbl><w:tr><w:tc>${p('00000005', '单元格')}</w:tc></w:tr></w:tbl>` +
      '<w:p><w:r><w:t>无标识段</w:t></w:r></w:p>' +
      p('00000007', '有书签', '')
        .replace('<w:r>', '<w:bookmarkStart w:id="1" w:name="a"/><w:r>')
        .replace('</w:p>', '<w:bookmarkEnd w:id="1"/></w:p>') +
      '<w:sectPr/></w:body></w:document>',
  );
  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function setup(core, dir) {
  const folder = path.join(dir, '用户文稿');
  await mkdir(folder, { recursive: true });
  const project = await core.projects.create({ name: '论文', folder });
  const file = path.join(folder, '论文.docx');
  await writeFile(file, await fixture());
  return { project, file };
}

test('desk HTTP lifecycle records each block, undoes deletion in place and creates the version lineage', () =>
  withCore('desk-lifecycle', async (core, dir) => {
    const { project, file } = await setup(core, dir);
    const versions = createVersions(core);
    const desk = createDesk(core, { versions, projectFiles: createProjectFiles(core) });
    const server = createAppServer({ core, versions, desk, token: 'desk-test' });
    const url = await server.listen();
    async function api(method, route, body, status = 200) {
      const response = await fetch(url + '/api/desk/' + route, {
        method,
        headers: { authorization: 'Bearer desk-test', 'content-type': 'application/json' },
        body: body == null ? undefined : JSON.stringify(body),
      });
      const value = await response.json();
      assert.equal(response.status, status, JSON.stringify(value));
      return value;
    }
    try {
      const group = await api('POST', 'documents', { projectId: project.id, path: '论文.docx' });
      assert.equal(
        (await api('POST', 'documents', { projectId: project.id, path: '论文.docx' })).id,
        group.id,
      );
      assert.equal(versions.list(project.id).length, 1);
      const opened = await api('POST', 'sessions', { groupId: group.id });
      const id = opened.session.id;
      assert.equal((await api('POST', 'sessions', { groupId: group.id })).session.id, id);
      const result = await api('PATCH', `sessions/${id}/blocks`, {
        baseSeq: 0,
        blocks: { 'p:00000001': text('第一段改写') },
        inserted: [{ id: 'new', after: 'p:00000001', inlines: text('拆开的后半段') }],
        removed: ['p:00000002'],
      });
      assert.match(result.inserted.new, /^p:[0-7][0-9A-F]{7}$/u);
      const changed = await api('GET', `sessions/${id}`);
      assert.equal(changed.changes.length, 3);
      assert.ok(changed.changes.every((entry) => entry.actorId === 'person_user'));
      await api(
        'POST',
        `changes/${changed.changes.find((entry) => entry.op === 'remove-block').id}/undo`,
        {},
      );
      const restored = await desk.getSession(id);
      assert.deepEqual(
        restored.blocks.slice(0, 4).map((block) => block.id),
        ['p:00000001', result.inserted.new, 'p:00000002', 'p:00000003'],
      );
      await api('POST', `sessions/${id}/settle`, {});
      assert.equal((await desk.getSession(id)).changes.length, 0);
      await api('POST', `sessions/${id}/save`, { to: 'project' });
      const reread = await readDocx(await readFile(file));
      assert.deepEqual(
        reread.blocks.map((block) => block.text),
        restored.blocks.map((block) => block.text),
      );
      const saved = await api('POST', `sessions/${id}/save`, { to: 'version', label: '初修' });
      assert.equal(saved.version.parentId, opened.session.baseVersionId);
      assert.equal(saved.version.origin, 'desk');
      assert.equal(saved.version.sessionId, id);
      assert.ok(
        core.db
          .prepare('SELECT version_id FROM desk_changes WHERE session_id=?')
          .all(id)
          .every((row) => row.version_id === saved.version.id),
      );
      const closed = await api('POST', `sessions/${id}/close`, {});
      assert.equal(closed.version, null);
      assert.equal(closed.session.status, 'closed');
      assert.equal(versions.list(project.id)[0].versions.length, 2);
      assert.ok(
        core.events
          .since(0)
          .some((event) => event.type === 'desk.changed' && event.payload.changeIds.length === 3),
      );
    } finally {
      await server.close();
      await desk.shutdown();
    }
  }));

test('desk accepts stale edits on other blocks, rejects conflicts and prevents out-of-order undo', () =>
  withCore('desk-conflicts', async (core, dir) => {
    const { project } = await setup(core, dir);
    const desk = createDesk(core, {
      versions: createVersions(core),
      projectFiles: createProjectFiles(core),
    });
    try {
      const group = await desk.registerDocument({ projectId: project.id, path: '论文.docx' });
      const { session } = await desk.openSession({ groupId: group.id });
      await desk.updateBlocks(
        session.id,
        { baseSeq: 0, blocks: { 'p:00000001': text('A') } },
        {
          actorId: 'agent_main',
          meetingId: 'meeting-test',
          turnId: 'turn-test',
          instruction: '改写',
        },
      );
      const first = (await desk.getSession(session.id)).changes[0];
      assert.equal(first.instruction, '改写');
      assert.equal(first.turnId, 'turn-test');
      await desk.updateBlocks(session.id, { baseSeq: 0, blocks: { 'p:00000002': text('B') } });
      await assert.rejects(
        desk.updateBlocks(session.id, { baseSeq: 0, blocks: { 'p:00000001': text('C') } }),
        (error) =>
          /** @type {any} */ (error).code === 'DESK_CONFLICT' &&
          /** @type {any} */ (error).details.blocks[0].text === 'A',
      );
      await desk.updateBlocks(session.id, { baseSeq: 2, blocks: { 'p:00000001': text('D') } });
      await assert.rejects(desk.undoChange(first.id), { code: 'DESK_UNDO_BLOCKED' });
      const last = (await desk.getSession(session.id)).changes.at(-1);
      await desk.undoChange(last.id);
      await desk.undoChange(first.id);
      assert.equal((await desk.getSession(session.id)).blocks[0].text, '第一段');
      await desk.closeSession(session.id);
    } finally {
      await desk.shutdown();
    }
  }));

test('writer failures leave the journal, sequence and file unchanged; idle batches write once', () =>
  withCore('desk-atomic', async (core, dir) => {
    const { project } = await setup(core, dir);
    /** @type {()=>Promise<void>} */
    let callback;
    let writes = 0;
    const desk = createDesk(core, {
      versions: createVersions(core),
      projectFiles: createProjectFiles(core),
      schedule: (work) => {
        callback = work;
        return 1;
      },
      cancel: () => {
        callback = null;
      },
      writeWorking: async (file, bytes) => {
        writes++;
        await writeAtomic(file, bytes);
      },
    });
    try {
      const group = await desk.registerDocument({ projectId: project.id, path: '论文.docx' });
      const { session } = await desk.openSession({ groupId: group.id });
      let working = path.join(
        core.workspace.locate.projectDir(project.id),
        'desk',
        session.id,
        '论文.docx',
      );
      const before = await readFile(working);
      await assert.rejects(desk.updateBlocks(session.id, { baseSeq: 0, removed: ['p:00000004'] }), {
        code: 'DOCX_SECTION_BREAK',
      });
      await assert.rejects(desk.updateBlocks(session.id, { baseSeq: 0, removed: ['p:00000005'] }), {
        code: 'DOCX_LAST_CELL_PARAGRAPH',
      });
      const initial = await desk.getSession(session.id);
      const markerBlock = initial.blocks.find((block) => block.id === 'p:00000007');
      await assert.rejects(
        desk.updateBlocks(session.id, {
          baseSeq: 0,
          blocks: { 'p:00000001': markerBlock.inlines },
        }),
        { code: 'DOCX_DUPLICATE_ATOM' },
      );
      assert.equal((await desk.getSession(session.id)).session.seq, 0);
      assert.deepEqual(await readFile(working), before);
      assert.equal(writes, 0);
      const split = await desk.updateBlocks(session.id, {
        baseSeq: 0,
        inserted: [{ id: 'new', after: 'p:00000005', inlines: text('单元格第二段') }],
      });
      await desk.updateBlocks(session.id, {
        baseSeq: 1,
        blocks: { [split.inserted.new]: text('新段已编辑'), 'b:5': text('稳定标识') },
      });
      assert.equal(writes, 0);
      const previousWorking = working;
      await core.projects.update(project.id, { name: '改名后的论文' });
      working = path.join(
        core.workspace.locate.projectDir(project.id),
        'desk',
        session.id,
        '论文.docx',
      );
      await callback();
      assert.equal(writes, 1);
      await assert.rejects(readFile(previousWorking), { code: 'ENOENT' });
      const parsed = await readDocx(await readFile(working));
      assert.equal(
        parsed.blocks.find((block) => block.id === split.inserted.new).kind,
        'table-cell',
      );
      assert.equal(
        parsed.blocks.find((block) => block.id === split.inserted.new).text,
        '新段已编辑',
      );
      assert.ok(parsed.blocks.some((block) => block.text === '稳定标识'));
      assert.equal(
        (await desk.getSession(session.id)).blocks.find((block) => block.id === 'b:5').text,
        '稳定标识',
      );
      await desk.closeSession(session.id);
    } finally {
      await desk.shutdown();
    }
  }));

test('open and save import external versions, retain dirty copies and confirm an old-version overwrite', () =>
  withCore('desk-external', async (core, dir) => {
    const { project, file } = await setup(core, dir);
    const versions = createVersions(core);
    const desk = createDesk(core, { versions, projectFiles: createProjectFiles(core) });
    const modify = async (value) =>
      writeFile(file, (await writeDocx(await readFile(file), { 'p:00000001': text(value) })).bytes);
    try {
      const group = await desk.registerDocument({ projectId: project.id, path: '论文.docx' });
      const first = await desk.openSession({ groupId: group.id });
      await modify('Word 外部修改');
      const fresh = await desk.openSession({ groupId: group.id });
      assert.notEqual(fresh.session.id, first.session.id);
      assert.equal(fresh.blocks[0].text, 'Word 外部修改');
      assert.equal(versions.get(fresh.session.baseVersionId).origin, 'external');
      await desk.updateBlocks(fresh.session.id, {
        baseSeq: 0,
        blocks: { 'p:00000002': text('编辑台未保存') },
      });
      await modify('Word 再次修改');
      await assert.rejects(desk.openSession({ groupId: group.id }), {
        code: 'DESK_EXTERNAL_CHANGE',
      });
      assert.equal((await desk.getSession(fresh.session.id)).blocks[1].text, '编辑台未保存');
      const branch = await desk.save(fresh.session.id, { to: 'version' });
      assert.equal(branch.version.parentId, fresh.session.baseVersionId);
      await desk.closeSession(fresh.session.id);
      const old = await desk.openSession({ groupId: group.id });
      await desk.closeSession(old.session.id);
      const previous = await desk.openSession({
        groupId: group.id,
        versionId: first.session.baseVersionId,
      });
      await assert.rejects(desk.save(previous.session.id, { to: 'project' }), {
        code: 'DESK_SAVE_CONFIRM',
      });
      await desk.save(previous.session.id, { to: 'project', confirm: true });
      assert.equal((await readDocx(await readFile(file))).blocks[0].text, '第一段');
      await desk.closeSession(previous.session.id);
    } finally {
      await desk.shutdown();
    }
  }));

test('saving to the project file twice is not an external edit, and an old-version overwrite asks once', () =>
  withCore('desk-saved-source', async (core, dir) => {
    const { project, file } = await setup(core, dir);
    const versions = createVersions(core);
    const desk = createDesk(core, { versions, projectFiles: createProjectFiles(core) });
    const edit = (session, seq, value) =>
      desk.updateBlocks(session.session.id, {
        baseSeq: seq,
        blocks: { 'p:00000001': text(value) },
      });
    try {
      const group = await desk.registerDocument({ projectId: project.id, path: '论文.docx' });
      const first = await desk.openSession({ groupId: group.id });
      await edit(first, 0, '第一次保存');
      await desk.save(first.session.id, { to: 'project' });
      await edit(first, 1, '第二次保存');
      await desk.save(first.session.id, { to: 'project' });
      assert.equal((await readDocx(await readFile(file))).blocks[0].text, '第二次保存');
      // Reopening the still-open session finds no external change.
      assert.equal((await desk.openSession({ groupId: group.id })).session.id, first.session.id);
      const closed = await desk.closeSession(first.session.id);
      const reopened = await desk.openSession({ groupId: group.id });
      assert.equal(reopened.session.baseVersionId, closed.version.id);
      assert.equal(reopened.blocks[0].text, '第二次保存');
      assert.deepEqual(
        versions.list(project.id)[0].versions.map((version) => version.origin),
        ['desk', 'import'],
      );
      await desk.closeSession(reopened.session.id);

      const old = await desk.openSession({
        groupId: group.id,
        versionId: first.session.baseVersionId,
      });
      await edit(old, 0, '旧版改写');
      await assert.rejects(desk.save(old.session.id, { to: 'project' }), {
        code: 'DESK_SAVE_CONFIRM',
      });
      await desk.save(old.session.id, { to: 'project', confirm: true });
      await edit(old, 1, '旧版再改');
      await desk.save(old.session.id, { to: 'project' });
      // An edit made outside after these saves is still caught.
      await writeFile(
        file,
        (await writeDocx(await readFile(file), { 'p:00000002': text('Word 外部修改') })).bytes,
      );
      await assert.rejects(desk.save(old.session.id, { to: 'project' }), {
        code: 'DESK_EXTERNAL_CHANGE',
      });
    } finally {
      await desk.shutdown();
    }
  }));

test('createApp shutdown flushes an open session and restart recovers block identities and sequence', async () => {
  const temporary = await tempDir('desk-restart');
  let app;
  try {
    const make = () =>
      createApp({
        dataRoot: temporary.dir,
        token: 'desk',
        runtime: createScriptedRuntime({
          script: async function* () {
            yield 'unused';
          },
        }),
      });
    app = await make();
    const { project } = await setup(app.core, temporary.dir);
    const group = await app.desk.registerDocument({ projectId: project.id, path: '论文.docx' });
    const { session } = await app.desk.openSession({ groupId: group.id });
    const added = await app.desk.updateBlocks(session.id, {
      baseSeq: 0,
      inserted: [{ id: 'new', after: '^', inlines: text('开头') }],
    });
    await app.desk.updateBlocks(session.id, {
      baseSeq: 1,
      blocks: { 'b:5': text('重启后仍然稳定') },
    });
    await app.close();
    app = null;
    app = await make();
    const reopened = await app.desk.openSession({ groupId: group.id });
    assert.equal(reopened.session.id, session.id);
    assert.equal(reopened.session.seq, 2);
    assert.equal(reopened.blocks[0].id, added.inserted.new);
    assert.equal(reopened.blocks.find((block) => block.id === 'b:5').text, '重启后仍然稳定');
    await app.desk.updateBlocks(session.id, {
      baseSeq: 2,
      blocks: { [added.inserted.new]: text('重启后改新段') },
    });
    const closed = await app.desk.closeSession(session.id);
    assert.equal(closed.version.sessionId, session.id);
    assert.equal(closed.session.resultVersionId, closed.version.id);
  } finally {
    await app?.close();
    await temporary.cleanup();
  }
});

test('an interrupted idle write replays acknowledged changes from the journal on restart', async () => {
  const temporary = await tempDir('desk-interrupted');
  let core = await createCore({ dataRoot: temporary.dir });
  let desk;
  try {
    const { project } = await setup(core, temporary.dir);
    const make = () =>
      createDesk(core, {
        versions: createVersions(core),
        projectFiles: createProjectFiles(core),
        schedule: () => 1,
        cancel: () => {},
      });
    desk = make();
    const group = await desk.registerDocument({ projectId: project.id, path: '论文.docx' });
    const opened = await desk.openSession({ groupId: group.id });
    await desk.updateBlocks(opened.session.id, {
      baseSeq: 0,
      blocks: { 'p:00000001': text('尚未写入 ZIP') },
    });
    const working = path.join(
      core.workspace.locate.projectDir(project.id),
      'desk',
      opened.session.id,
      '论文.docx',
    );
    assert.equal((await readDocx(await readFile(working))).blocks[0].text, '第一段');
    // Simulate process loss: close SQLite without the service shutdown hook.
    core.close();
    core = await createCore({ dataRoot: temporary.dir });
    desk = make();
    const restored = await desk.openSession({ groupId: group.id });
    assert.equal(restored.session.id, opened.session.id);
    assert.equal(restored.session.seq, 1);
    assert.equal(restored.blocks[0].text, '尚未写入 ZIP');
    await desk.shutdown();
    assert.equal((await readDocx(await readFile(working))).blocks[0].text, '尚未写入 ZIP');
  } finally {
    core.close();
    await temporary.cleanup();
  }
});
