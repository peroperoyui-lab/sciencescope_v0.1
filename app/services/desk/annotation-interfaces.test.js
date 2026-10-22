import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';
import { withCore } from '../../testing.js';
import { createAppServer } from '../../server/server.js';
import { createTools } from '../tools.js';
import { setupAnnotations as setup } from './annotation-testing.js';

test('Word renumbering and minute timestamps retain comment authorship and the current native range', () =>
  withCore('annotation-word-identity', async (core, dir) => {
    const f = await setup(core, dir, 'docx');
    try {
      const result = await f.desk.createAnnotation(
        f.id,
        { type: 'comment', blockId: f.opened.blocks[0].id, from: 2, to: 6, text: '专家批注' },
        { actorId: 'agent_main' },
      );
      await f.desk.save(f.id, { to: 'project' });
      await f.desk.closeSession(f.id);
      const zip = await JSZip.loadAsync(await readFile(f.file));
      const number = result.item.id.split(':').at(-1);
      const nativeId = new RegExp(`w:id="${number}"`, 'gu');
      zip.file(
        'word/document.xml',
        (await zip.file('word/document.xml').async('string'))
          .replace(nativeId, 'w:id="52"')
          .replace('前文', '新增前文'),
      );
      zip.file(
        'word/comments.xml',
        (await zip.file('word/comments.xml').async('string'))
          .replace(nativeId, 'w:id="52"')
          .replace(
            /w:date="([^"]+)"/gu,
            (_whole, value) =>
              'w:date="' +
              new Date(Math.floor(Date.parse(value) / 60000) * 60000).toISOString() +
              '"',
          ),
      );
      await writeFile(f.file, await zip.generateAsync({ type: 'nodebuffer' }));
      const reopened = await f.desk.openSession({ groupId: f.group.id });
      const item = (await f.desk.listAnnotations(reopened.session.id)).items[0];
      assert.equal(item.id, `docx:${f.group.id}:52`);
      assert.equal(item.author.id, 'agent_main');
      assert.equal(item.from, 4);
      assert.equal(item.quote.exact, '甲乙丙丁');
      await f.desk.updateAnnotation(
        item.id,
        {},
        { actorId: 'agent_main' },
        { ownOnly: true, remove: true },
      );
      assert.deepEqual((await f.desk.listAnnotations(reopened.session.id)).items, []);
    } finally {
      await f.close();
    }
  }));

test('annotation HTTP CRUD shares global IDs across DOCX groups and supports read-only PDF comments', () =>
  withCore('annotation-http', async (core, dir) => {
    const f = await setup(core, dir, 'docx');
    const server = createAppServer({
      core,
      desk: f.desk,
      versions: f.versions,
      token: 'annotations-test',
    });
    const url = await server.listen();
    async function api(method, route, body, status = 200) {
      const response = await fetch(url + '/api/desk/' + route, {
        method,
        headers: { authorization: 'Bearer annotations-test', 'content-type': 'application/json' },
        body: body == null ? undefined : JSON.stringify(body),
      });
      const result = await response.json();
      assert.equal(response.status, status, JSON.stringify(result));
      return result;
    }
    try {
      const first = await api('POST', `sessions/${f.id}/annotations`, {
        type: 'comment',
        blockId: f.opened.blocks[0].id,
        from: 0,
        to: 2,
        text: '第一份',
      });
      await writeFile(path.join(f.folder, '另一份.docx'), await readFile(f.file));
      const other = await api('POST', 'documents', {
        projectId: f.project.id,
        path: '另一份.docx',
      });
      const session = await api('POST', 'sessions', { groupId: other.id });
      const second = await api('POST', `sessions/${session.session.id}/annotations`, {
        type: 'comment',
        blockId: session.blocks[0].id,
        from: 0,
        to: 2,
        text: '第二份',
      });
      assert.notEqual(first.item.id, second.item.id);
      assert.equal(first.item.id.split(':').at(-1), second.item.id.split(':').at(-1));
      await api('PATCH', `annotations/${encodeURIComponent(second.item.id)}`, {
        text: '只改第二份',
      });
      assert.equal((await api('GET', `sessions/${f.id}/annotations`)).items[0].text, '第一份');
      await api('DELETE', `annotations/${encodeURIComponent(second.item.id)}`);
      assert.equal(
        (await api('GET', `sessions/${session.session.id}/annotations`)).items.length,
        0,
      );
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      pdf.addPage().drawText('Evidence from a PDF.', { font });
      const bytes = await pdf.save();
      await writeFile(path.join(f.folder, '只读.pdf'), bytes);
      const pdfGroup = await api('POST', 'documents', {
        projectId: f.project.id,
        path: '只读.pdf',
      });
      const opened = await api('POST', 'sessions', { groupId: pdfGroup.id });
      assert.equal(opened.readOnly, true);
      const item = await api('POST', `sessions/${opened.session.id}/annotations`, {
        type: 'comment',
        blockId: opened.blocks[0].id,
        from: 0,
        to: 8,
        text: '只保存在应用中',
      });
      await api('PATCH', `annotations/${item.item.id}`, { resolved: true });
      assert.equal(
        (await api('GET', `sessions/${opened.session.id}/annotations`)).items[0].resolved,
        true,
      );
      await api('PUT', `sessions/${opened.session.id}/text`, { baseSeq: 0, text: 'change' }, 400);
      await api('POST', `sessions/${opened.session.id}/save`, { to: 'project' });
      assert.deepEqual(await readFile(path.join(f.folder, '只读.pdf')), Buffer.from(bytes));
      await api('POST', `sessions/${opened.session.id}/close`, {});
      const meeting = core.meetings.create({ projectId: f.project.id });
      const tools = createTools(core, undefined, { desk: f.desk, versions: f.versions });
      try {
        const read = await tools.run(
          'workspace_read',
          { target: 'manuscript', key: `${f.project.id}/${pdfGroup.id}` },
          { participantId: 'agent_main', meetingId: meeting.id, turnId: '' },
        );
        assert.equal(read.sessionId, null);
        assert.equal(read.blocks[0].annotations[0].id, item.item.id);
      } finally {
        tools.approvals.close();
      }
    } finally {
      await server.close();
      await f.close();
    }
  }));

test('external Markdown edits reanchor by quote and context; missing or ambiguous annotations leave reversible loss records', () =>
  withCore('annotation-relocate', async (core, dir) => {
    const f = await setup(core, dir, 'md');
    try {
      const original = '甲背景共享数字甲结尾。\n\n乙背景共享数字乙结尾。\n\n将删除这个依据。\n';
      await f.desk.updateText(f.id, { baseSeq: 0, text: original });
      const current = await f.desk.getSession(f.id);
      const kept = await f.desk.createAnnotation(f.id, {
        type: 'index',
        blockId: current.blocks[0].id,
        from: 3,
        to: 7,
        kind: 'number',
        sources: f.sources,
      });
      const lost = await f.desk.createAnnotation(f.id, {
        type: 'comment',
        blockId: current.blocks[2].id,
        from: 0,
        to: 8,
        text: '删除的原文',
      });
      await f.desk.save(f.id, { to: 'project' });
      await f.desk.closeSession(f.id);
      await writeFile(
        f.file,
        '新增的开头段。\n\n乙背景共享数字乙结尾。\n\n甲背景共享数字甲结尾。\n',
      );
      const reopened = await f.desk.openSession({ groupId: f.group.id });
      const listed = (await f.desk.listAnnotations(reopened.session.id)).items;
      assert.equal(listed.length, 1);
      assert.equal(listed[0].id, kept.item.id);
      assert.equal(listed[0].blockId, reopened.blocks[2].id);
      assert.equal(listed[0].quote.exact, '共享数字');
      const deletion = reopened.changes.find((change) => change.op === 'annotation-lost');
      assert.equal(deletion.annotations[0].before.id, lost.item.id);
      await f.desk.undoChange(deletion.id);
      assert.equal((await f.desk.listAnnotations(reopened.session.id)).items.length, 2);
      await f.desk.updateAnnotation(lost.item.id, {}, {}, { remove: true });
      await f.desk.closeSession(reopened.session.id);
      await writeFile(f.file, '甲背景共享数字甲结尾。\n\n甲背景共享数字甲结尾。\n');
      const ambiguous = await f.desk.openSession({ groupId: f.group.id });
      assert.equal((await f.desk.listAnnotations(ambiguous.session.id)).items.length, 0);
      assert.ok(ambiguous.changes.some((change) => change.op === 'annotation-lost'));
    } finally {
      await f.close();
    }
  }));

test("shared manuscript tools add attributed comments/indexes and summaries, reject bad quotes, and remove only the author's entries", () =>
  withCore('annotation-tools', async (core, dir) => {
    const f = await setup(core, dir, 'docx');
    const tools = createTools(core, undefined, { desk: f.desk, versions: f.versions });
    try {
      const meeting = core.meetings.create({
        projectId: f.project.id,
        members: [{ participantId: 'agent_main' }],
      });
      const message = core.messages.post({
        meetingId: meeting.id,
        authorId: 'person_user',
        text: '核对甲乙丙丁的出处并添加批注。',
      });
      const turn = core.turns.start({
        meetingId: meeting.id,
        participantId: 'agent_main',
        triggerMessageId: message.id,
      });
      const context = { participantId: 'agent_main', meetingId: meeting.id, turnId: turn.id };
      const key = f.project.id + '/' + f.group.id;
      const edit = (op, args) =>
        tools.run('workspace_edit', { resource: 'manuscript', key, op, args }, context);
      const block = f.opened.blocks[0].id;
      const comment = await edit('comment', {
        block,
        quote: '甲乙丙丁',
        text: '请核对。'.repeat(20),
      });
      assert.equal(comment.annotation.author.id, 'agent_main');
      assert.equal(comment.revisionIds.length, 1);
      const binding = await edit('bind', {
        block,
        quote: '甲乙丙丁',
        kind: 'claim',
        value: '依据',
        sources: f.sources,
        note: '原始数据',
      });
      assert.equal(binding.annotation.author.id, 'agent_main');
      const read = await tools.run('workspace_read', { target: 'manuscript', key }, context);
      assert.equal(read.blocks[0].annotations.length, 2);
      assert.equal(
        read.blocks[0].annotations.find((item) => item.type === 'comment').summary.length,
        60,
      );
      assert.equal(
        (await edit('comment', { block, quote: '不存在', text: '错误' })).code,
        'TEXT_NOT_FOUND',
      );
      const own = await f.desk.createAnnotation(f.id, {
        type: 'comment',
        blockId: block,
        from: 0,
        to: 2,
        text: '用户的批注',
      });
      assert.equal((await edit('uncomment', { id: own.item.id })).code, 'DESK_NOT_AUTHOR');
      assert.equal(
        (await edit('comment', { block, quote: 'comment-start:', text: '切开原子' })).code,
        'TEXT_AMBIGUOUS',
      );
      await edit('unbind', { id: binding.annotation.id });
      await edit('uncomment', { id: comment.annotation.id });
      assert.equal((await f.desk.listAnnotations(f.id)).items.length, 1);
      const journal = (await f.desk.getSession(f.id)).changes.find(
        (change) => change.id === comment.revisionIds[0],
      );
      assert.equal(journal.op, 'comment');
      assert.equal(journal.actorId, 'agent_main');
      assert.equal(journal.instruction, message.text);
    } finally {
      tools.approvals.close();
      await f.close();
    }
  }));
