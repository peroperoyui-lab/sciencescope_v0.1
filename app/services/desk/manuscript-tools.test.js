import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import JSZip from 'jszip';
import { withCore } from '../../testing.js';
import { createTools } from '../tools.js';
import { createVersions } from '../versions/index.js';
import { createProjectFiles } from '../project-files.js';
import { createDesk } from './index.js';
import { readDocx } from './docx/read.js';
import { WORD } from './docx/xml.js';
import { WORD14 } from './docx/ids.js';

const run = (text, properties = '') => `<w:r>${properties}<w:t>${text}</w:t></w:r>`;
const paragraph = (id, body) => `<w:p w14:paraId="${id}">${body}</w:p>`;
async function setup(core, dir) {
  const folder = path.join(dir, '项目稿件');
  await mkdir(folder);
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="${WORD}" xmlns:w14="${WORD14}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>` +
      paragraph('00000001', run('研究结论', '<w:rPr><w:b/></w:rPr>') + run(' and baseline.')) +
      paragraph('00000002', run('重复 重复')) +
      paragraph(
        '00000003',
        run('保留') +
          '<w:fldSimple w:instr="CITATION Zhang">' +
          run('(Zhang, 2024)') +
          '</w:fldSimple><m:oMath><m:r><m:t>x2</m:t></m:r></m:oMath><w:r><w:drawing/></w:r>' +
          run('原样'),
      ) +
      Array.from({ length: 205 }, (_, index) =>
        paragraph(
          (index + 4).toString(16).padStart(8, '0').toUpperCase(),
          run(`其余段落 ${index}`),
        ),
      ).join('') +
      '<w:sectPr/></w:body></w:document>',
  );
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const file = path.join(folder, '稿件.docx');
  await writeFile(file, bytes);
  const project = await core.projects.create({ name: '文稿', folder });
  const meeting = core.meetings.create({
    projectId: project.id,
    members: [{ participantId: 'agent_main' }],
  });
  const message = core.messages.post({
    meetingId: meeting.id,
    authorId: 'person_user',
    text: '按指定范围修改，不动其他内容。'.repeat(20),
  });
  const turn = core.turns.start({
    meetingId: meeting.id,
    participantId: 'agent_main',
    triggerMessageId: message.id,
  });
  const versions = createVersions(core);
  const desk = createDesk(core, { versions, projectFiles: createProjectFiles(core) });
  const tools = createTools(core, undefined, { versions, desk });
  const context = { participantId: 'agent_main', meetingId: meeting.id, turnId: turn.id };
  const call = (name, args) => tools.run(name, args, context);
  return {
    folder,
    file,
    project,
    meeting,
    turn,
    message,
    versions,
    desk,
    tools,
    call,
    bytes,
    context,
    close: async () => {
      tools.approvals.close();
      await desk.shutdown();
      await versions.close();
    },
  };
}

test('manuscript tools page current/history blocks, preserve atom markers and record reversible DOCX edits', () =>
  withCore('manuscript-tools', async (core, dir) => {
    const fixture = await setup(core, dir);
    const { call, project, desk, versions } = fixture;
    try {
      const listed = await call('workspace_read', { target: 'manuscript', scope: project.id });
      const key = listed.documents[0].key;
      assert.equal(key, `${project.id}/path:稿件.docx`);
      const first = await call('workspace_read', { target: 'manuscript', key });
      assert.equal(first.blocks.length, 40);
      assert.equal(first.remaining, 168);
      assert.equal(first.sessionId, null);
      assert.match(first.blocks[2].text, /⟦field:\d+ \(Zhang, 2024\)⟧⟦math:\d+ x2⟧⟦image:\d+⟧/u);
      const registeredKey = `${project.id}/${first.groupId}`;
      const page = await call('workspace_read', {
        target: 'manuscript',
        key: registeredKey,
        offset: 5,
        limit: 999,
      });
      assert.equal(page.blocks.length, 200);
      assert.equal(page.remaining, 3);
      const edit = (op, args) =>
        call('workspace_edit', { resource: 'manuscript', key: registeredKey, op, args });
      const chinese = await edit('replace', {
        block: first.blocks[0].id,
        find: '研究',
        with: '分析',
      });
      assert.equal(chinese.revisionIds.length, 1);
      assert.match(chinese.revisionIds[0], /^chg_/u);
      const current = await call('workspace_read', {
        target: 'manuscript',
        key: registeredKey,
        limit: 1,
      });
      assert.equal(current.blocks[0].text, '分析结论 and baseline.');
      const opened = await desk.openSession({
        groupId: first.groupId,
        meetingId: fixture.meeting.id,
      });
      assert.equal(opened.session.id, current.sessionId);
      assert.equal(opened.session.meetingId, fixture.meeting.id);
      assert.deepEqual(opened.blocks[0].inlines[0].marks, ['b']);
      const record = opened.changes.find((entry) => entry.id === chinese.revisionIds[0]);
      assert.equal(record.actorId, 'agent_main');
      assert.equal(record.meetingId, fixture.meeting.id);
      assert.equal(record.turnId, fixture.turn.id);
      assert.equal(record.instruction, fixture.message.text.slice(0, 200));
      const english = await edit('replace', {
        block: first.blocks[0].id,
        find: 'baseline',
        with: 'comparison',
      });
      assert.equal(
        (await call('workspace_undo', { revisionId: chinese.revisionIds[0] })).code,
        'DESK_UNDO_BLOCKED',
      );
      await call('workspace_undo', { revisionId: english.revisionIds[0] });
      await call('workspace_undo', { revisionId: chinese.revisionIds[0] });
      assert.equal(
        (await call('workspace_read', { target: 'manuscript', key: registeredKey, limit: 1 }))
          .blocks[0].text,
        first.blocks[0].text,
      );
      const missing = await edit('replace', {
        block: first.blocks[0].id,
        find: '不存在',
        with: '新字',
      });
      assert.equal(missing.code, 'TEXT_NOT_FOUND');
      assert.equal(missing.block.text, first.blocks[0].text);
      assert.equal(
        (await edit('replace', { block: first.blocks[1].id, find: '重复', with: '新词' })).code,
        'TEXT_AMBIGUOUS',
      );
      const atomBlock = first.blocks[2];
      assert.equal(
        (await edit('replace', { block: atomBlock.id, find: atomBlock.text, with: '删掉原子' }))
          .code,
        'DESK_ATOM_CHANGED',
      );
      assert.equal(
        (await edit('replace', { block: atomBlock.id, find: 'math:', with: 'field:' })).code,
        'DESK_ATOM_CHANGED',
      );
      assert.equal(
        (await edit('insertBlock', { after: '^', text: '⟦image:9⟧' })).code,
        'DESK_ATOM_CHANGED',
      );
      await edit('replace', {
        block: atomBlock.id,
        find: atomBlock.text,
        with: atomBlock.text.replace('保留', '留下'),
      });
      const inserted = await edit('insertBlock', {
        after: first.blocks[0].id,
        text: '新增中文段落。',
      });
      assert.equal(inserted.block.text, '新增中文段落。');
      const removed = await edit('removeBlock', { block: inserted.block.id });
      assert.equal(removed.block, null);
      await call('workspace_undo', { revisionId: removed.revisionIds[0] });
      await edit('replace', { block: first.blocks[0].id, find: 'baseline', with: 'comparison' });
      const saved = await edit('save', { to: 'version', label: '专家修改' });
      assert.equal(saved.version.parentId, first.versionId);
      assert.deepEqual(await readFile(fixture.file), fixture.bytes);
      const before = await readDocx(fixture.bytes),
        after = await readDocx(await readFile(versions.file(saved.version.id)));
      const untouched = before.blocks[1];
      const same = after.blocks.find((entry) => entry.id === untouched.id);
      assert.equal(
        before.xml.slice(untouched.start, untouched.end),
        after.xml.slice(same.start, same.end),
      );
      assert.deepEqual(
        after.atoms.map((atom) => after.xml.slice(atom.start, atom.end)),
        before.atoms.map((atom) => before.xml.slice(atom.start, atom.end)),
      );
      const history = await call('workspace_read', {
        target: 'manuscript',
        key: registeredKey,
        version: first.versionId,
        limit: 1,
      });
      assert.equal(history.blocks[0].text, first.blocks[0].text);
      assert.equal(history.sessionId, null);
      assert.equal((await edit('comment', {})).code, 'UNKNOWN_OP');
    } finally {
      await fixture.close();
    }
  }));

test('TeX and Markdown use full-text desk updates and preserve untouched text, BOM and line endings', () =>
  withCore('manuscript-text-tools', async (core, dir) => {
    const fixture = await setup(core, dir);
    try {
      for (const extension of ['tex', 'md']) {
        const original = '\uFEFF研究结论。\r\n\r\n其余内容。\r\n';
        await writeFile(path.join(fixture.folder, '正文.' + extension), original);
        const key = `${fixture.project.id}/path:正文.${extension}`;
        const read = await fixture.call('workspace_read', { target: 'manuscript', key });
        const result = await fixture.call('workspace_edit', {
          resource: 'manuscript',
          key,
          op: 'replace',
          args: { block: read.blocks[0].id, find: '研究', with: '分析' },
        });
        assert.equal(result.block.text, '分析结论。');
        const live = await fixture.call('workspace_read', { target: 'manuscript', key });
        assert.equal(
          (await fixture.desk.getSession(live.sessionId)).text,
          original.replace('研究', '分析'),
        );
        await fixture.call('workspace_undo', { revisionId: result.revisionIds[0] });
        assert.equal((await fixture.desk.getSession(live.sessionId)).text, original);
        const insert = await fixture.call('workspace_edit', {
          resource: 'manuscript',
          key,
          op: 'insertBlock',
          args: { after: '^', text: '首段。' },
        });
        assert.equal(insert.block.text, '首段。');
        await fixture.call('workspace_edit', {
          resource: 'manuscript',
          key,
          op: 'removeBlock',
          args: { block: insert.block.id },
        });
        assert.equal((await fixture.desk.getSession(live.sessionId)).text, original);
      }
    } finally {
      await fixture.close();
    }
  }));

function approval(core) {
  return new Promise((resolve) => {
    const unsubscribe = core.events.subscribe((event) => {
      if (event.type !== 'turn.phase' || event.payload.phase !== 'waiting-approval') return;
      unsubscribe();
      resolve(core.turns.toolCalls(event.payload.id).findLast((row) => row.kind === 'approval'));
    });
  });
}

test('manuscript project saves support reject, shared always-allow rules, auto mode and explicit conflict results', () =>
  withCore('manuscript-approval', async (core, dir) => {
    const fixture = await setup(core, dir);
    const { call, project, tools } = fixture;
    try {
      const key = `${project.id}/path:稿件.docx`;
      const first = await call('workspace_read', { target: 'manuscript', key });
      const edit = (op, args) => call('workspace_edit', { resource: 'manuscript', key, op, args });
      await edit('replace', { block: first.blocks[0].id, find: '研究', with: '分析' });
      const pending = approval(core);
      const saving = edit('save', { to: 'project' });
      const row = await pending;
      assert.ok(row.args.summary.includes(fixture.file));
      assert.match(row.args.summary, /v1/u);
      tools.approvals.decide(fixture.turn.id, row.id, 'reject');
      assert.equal((await saving).rejected, true);
      assert.deepEqual(await readFile(fixture.file), fixture.bytes);
      assert.equal(core.turns.get(fixture.turn.id).error, null);
      const next = approval(core);
      const allowed = edit('save', { to: 'project' });
      const card = await next;
      await tools.approvals.decide(fixture.turn.id, card.id, 'always', card.args.scopes[0]);
      await allowed;
      const settings = await core.workspace.read({ resource: 'settings', key: 'app' });
      assert.equal(settings.value.approvals.rules[0].tool, 'write_file');
      assert.equal(settings.value.approvals.rules[0].projectId, project.id);
      assert.equal(
        (await readDocx(await readFile(fixture.file))).blocks[0].text,
        '分析结论 and baseline.',
      );
      await edit('save', { to: 'project' });
      assert.equal(
        core.turns.toolCalls(fixture.turn.id).filter((item) => item.kind === 'approval').length,
        2,
      );
      core.meetings.update(fixture.meeting.id, { policy: { approval: 'auto' } });
      await edit('replace', { block: first.blocks[0].id, find: '分析', with: '讨论' });
      await edit('save', { to: 'project' });
      assert.equal(
        (await readDocx(await readFile(fixture.file))).blocks[0].text,
        '讨论结论 and baseline.',
      );
      await writeFile(fixture.file, fixture.bytes);
      assert.equal(
        (await edit('save', { to: 'project', confirm: true })).code,
        'DESK_EXTERNAL_CHANGE',
      );
      assert.equal(
        (await edit('save', { to: 'project', confirm: true })).code,
        'DESK_SAVE_CONFIRM',
      );
      assert.deepEqual(await readFile(fixture.file), fixture.bytes);
    } finally {
      await fixture.close();
    }
  }));

test('desk suggestions are durable and deduplicated per meeting for ten minutes', () =>
  withCore('manuscript-suggest', async (core, dir) => {
    const fixture = await setup(core, dir);
    try {
      assert.ok(fixture.tools.specs.some((spec) => spec.name === 'desk_suggest'));
      assert.deepEqual(
        await fixture.call('desk_suggest', {
          reason: '初稿已完成',
          document: `${fixture.project.id}/path:稿件.docx`,
        }),
        { suggested: true },
      );
      await fixture.call('desk_suggest', { reason: '再次建议' });
      let events = core.events.since(0).filter((event) => event.type === 'desk.suggested');
      assert.equal(events.length, 1);
      assert.equal(events[0].payload.meetingId, fixture.meeting.id);
      assert.equal(events[0].payload.reason, '初稿已完成');
      core.db
        .prepare("UPDATE events SET created_at=? WHERE type='desk.suggested'")
        .run(new Date(Date.now() - 601000).toISOString());
      await fixture.call('desk_suggest', { reason: '稍后再建议' });
      events = core.events.since(0).filter((event) => event.type === 'desk.suggested');
      assert.equal(events.length, 2);
      assert.equal(events[1].payload.key, null);
    } finally {
      await fixture.close();
    }
  }));
