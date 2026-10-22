import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { withCore } from '../../testing.js';
import { createDesk } from './index.js';
import { createProjectFiles } from '../project-files.js';
import { readDocx } from './docx/read.js';
import { setupAnnotations as setup } from './annotation-testing.js';

test('DOCX annotations follow text, survive undo and restart, and save as real Word comments', () =>
  withCore('desk-annotations-docx', async (core, dir) => {
    const f = await setup(core, dir, 'docx');
    try {
      const blockId = f.opened.blocks[0].id;
      await assert.rejects(
        f.desk.createAnnotation(f.id, { type: 'comment', blockId, from: 2, to: 2, text: '空' }),
        { code: 'DESK_EMPTY_RANGE' },
      );
      const comment = await f.desk.createAnnotation(f.id, {
        type: 'comment',
        blockId,
        from: 2,
        to: 6,
        text: '核对证据',
      });
      assert.match(comment.item.id, new RegExp('^docx:' + f.group.id + ':\\d+$'));
      const binding = await f.desk.createAnnotation(f.id, {
        type: 'index',
        blockId,
        from: 2,
        to: 6,
        kind: 'claim',
        sources: f.sources,
        note: '原文依据',
      });
      assert.equal(core.db.prepare('SELECT count(*) n FROM manuscript_comments').get().n, 0);
      await f.desk.updateAnnotation(comment.item.id, { text: '请核对原始证据' });
      await f.desk.save(f.id, { to: 'project' });
      let document = await readDocx(await readFile(f.file));
      assert.equal(document.comments.length, 1);
      assert.equal(document.comments[0].text, '请核对原始证据');
      assert.equal(document.blocks[0].text, '前文甲乙丙丁后文。');
      assert.ok(document.comments[0].range.from && document.comments[0].range.to);
      assert.ok(
        !(await document.zip.file('word/document.xml').async('string')).includes(binding.item.id),
      );
      await f.replace('甲乙', '');
      let items = (await f.desk.listAnnotations(f.id)).items;
      assert.ok(
        items.every((item) => item.from === 2 && item.to === 4 && item.quote.exact === '丙丁'),
      );
      await f.replace('丙丁', '丙新增丁');
      items = (await f.desk.listAnnotations(f.id)).items;
      assert.ok(items.every((item) => item.from === 2 && item.to === 6));
      await f.replace('丙新增丁', '丙丁');
      await f.replace('前文', '新前文');
      items = (await f.desk.listAnnotations(f.id)).items;
      assert.ok(items.every((item) => item.from === 3 && item.to === 5));
      const removed = await f.replace('丙丁', '');
      assert.equal(removed.removedAnnotations, 2);
      assert.deepEqual((await f.desk.listAnnotations(f.id)).items, []);
      const last = (await f.desk.getSession(f.id)).changes.at(-1);
      assert.equal(last.annotations.filter((delta) => !delta.after).length, 2);
      await f.desk.undoChange(last.id);
      items = (await f.desk.listAnnotations(f.id)).items;
      assert.equal(items.length, 2);
      assert.ok(items.every((item) => item.quote.exact === '丙丁'));
      const replaced = await f.replace('丙丁', '全新');
      assert.equal(replaced.removedAnnotations, 2);
      await f.desk.undoChange((await f.desk.getSession(f.id)).changes.at(-1).id);
      assert.equal((await f.desk.listAnnotations(f.id)).items.length, 2);
      await f.desk.save(f.id, { to: 'project' });
      document = await readDocx(await readFile(f.file));
      assert.equal(document.comments.length, 1);
      assert.equal(document.blocks[0].text, '新前文丙丁后文。');
      await f.desk.shutdown();
      const reopened = createDesk(core, {
        versions: f.versions,
        projectFiles: createProjectFiles(core),
      });
      assert.equal((await reopened.listAnnotations(f.id)).items.length, 2);
      assert.equal((await reopened.getSession(f.id)).blocks[0].text, '新前文丙丁后文。');
      await reopened.shutdown();
      const events = core.events.since(0);
      assert.ok(
        events.some(
          (event) => event.type === 'desk.changed' && event.payload.removedAnnotations === 2,
        ),
      );
      assert.ok(
        events.some(
          (event) =>
            event.type === 'desk.annotations.changed' &&
            event.payload.ids.includes(comment.item.id),
        ),
      );
    } finally {
      await f.close();
    }
  }));

test('TeX indexes and comment replies shrink, shift, disappear and restore with the text change', () =>
  withCore('desk-annotations-tex', async (core, dir) => {
    const f = await setup(core, dir, 'tex');
    try {
      const blockId = f.opened.blocks[0].id;
      const comment = await f.desk.createAnnotation(f.id, {
        type: 'comment',
        blockId,
        from: 2,
        to: 6,
        text: '检查',
      });
      const binding = await f.desk.createAnnotation(f.id, {
        type: 'index',
        blockId,
        from: 2,
        to: 6,
        kind: 'number',
        value: '1284',
        sources: f.sources,
        note: '企业数',
      });
      const reply = await f.desk.createAnnotation(f.id, {
        type: 'comment',
        blockId,
        from: 2,
        to: 6,
        text: '已检查',
        parentId: comment.item.id,
      });
      await f.desk.updateAnnotation(comment.item.id, { resolved: true });
      await f.replace('甲乙', '');
      await f.replace('前文', '新前文');
      let items = (await f.desk.listAnnotations(f.id)).items;
      assert.ok(items.every((item) => item.from === 3 && item.to === 5));
      const result = await f.replace('丙丁', '');
      assert.equal(result.removedAnnotations, 3);
      const last = (await f.desk.getSession(f.id)).changes.at(-1);
      await f.desk.undoChange(last.id);
      items = (await f.desk.listAnnotations(f.id)).items;
      assert.equal(items.length, 3);
      assert.equal(items.find((item) => item.id === reply.item.id).parentId, comment.item.id);
      assert.equal(items.find((item) => item.id === comment.item.id).resolved, true);
      await f.desk.updateAnnotation(binding.item.id, { note: '已核实企业数', sources: f.sources });
      assert.equal(
        (await f.desk.listAnnotations(f.id)).items.find((item) => item.id === binding.item.id).note,
        '已核实企业数',
      );
      await f.desk.updateAnnotation(comment.item.id, {}, {}, { remove: true });
      assert.equal((await f.desk.listAnnotations(f.id)).items.length, 1);
    } finally {
      await f.close();
    }
  }));
