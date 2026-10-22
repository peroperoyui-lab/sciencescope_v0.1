import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { withCore } from '../../testing.js';
import { setupAnnotations as setup } from './annotation-testing.js';
import { readDocx } from './docx/read.js';

test('undoing external annotation loss restores durable records only, then PATCH or returning text locates them', () =>
  withCore('annotation-lost-records', async (core, dir) => {
    const f = await setup(core, dir, 'md');
    try {
      const blockId = f.opened.blocks[0].id;
      const comment = await f.desk.createAnnotation(f.id, {
        type: 'comment',
        blockId,
        from: 2,
        to: 6,
        text: '保留说明',
      });
      const index = await f.desk.createAnnotation(f.id, {
        type: 'index',
        blockId,
        from: 2,
        to: 6,
        sources: f.sources,
      });
      await f.desk.closeSession(f.id);
      const external = '完全不同的正文。\n\n第二段保留原样。\n';
      await writeFile(f.file, external);
      let opened = await f.desk.openSession({ groupId: f.group.id });
      const losses = opened.changes.filter((change) => change.op === 'annotation-lost');
      assert.equal(losses.length, 2);
      for (const change of losses) await f.desk.undoChange(change.id);
      let items = (await f.desk.listAnnotations(opened.session.id)).items;
      assert.equal(items.length, 2);
      assert.ok(items.every((item) => item.status === 'lost' && item.quote.exact === '甲乙丙丁'));
      assert.equal((await f.desk.getSession(opened.session.id)).text, external);
      assert.equal(await readFile(f.file, 'utf8'), external);
      for (const table of ['manuscript_bindings', 'manuscript_comments'])
        assert.equal(core.db.prepare(`SELECT status FROM ${table}`).get().status, 'lost');
      // Editing unrelated text at an obsolete offset must not move or delete the record.
      await f.desk.updateText(opened.session.id, {
        baseSeq: (await f.desk.getSession(opened.session.id)).session.seq,
        text: '另一段正文。\n',
      });
      assert.ok(
        (await f.desk.listAnnotations(opened.session.id)).items.every(
          (item) => item.status === 'lost' && item.quote.exact === '甲乙丙丁',
        ),
      );
      await f.desk.save(opened.session.id, { to: 'project' });
      await f.desk.closeSession(opened.session.id);
      opened = await f.desk.openSession({ groupId: f.group.id });
      assert.ok(
        (await f.desk.listAnnotations(opened.session.id)).items.every(
          (item) => item.status === 'lost',
        ),
      );
      const located = await f.desk.updateAnnotation(comment.item.id, {
        blockId: opened.blocks[0].id,
        from: 0,
        to: 3,
      });
      assert.equal(located.item.status, 'anchored');
      assert.equal(located.item.quote.exact, '另一段');
      await f.desk.closeSession(opened.session.id);
      await writeFile(f.file, '另一段正文。\n\n前文甲乙丙丁后文。\n');
      opened = await f.desk.openSession({ groupId: f.group.id });
      items = (await f.desk.listAnnotations(opened.session.id)).items;
      assert.ok(items.every((item) => item.status === 'anchored'));
      const restored = items.find((item) => item.id === index.item.id);
      assert.equal(restored.blockId, opened.blocks[1].id);
      assert.equal(restored.quote.exact, '甲乙丙丁');
    } finally {
      await f.close();
    }
  }));

test('lost Word comments survive sessions outside comments.xml and return only after manual or automatic relocation', () =>
  withCore('annotation-lost-word', async (core, dir) => {
    const f = await setup(core, dir, 'docx');
    try {
      const blockId = f.opened.blocks[0].id;
      const comment = await f.desk.createAnnotation(f.id, {
        type: 'comment',
        blockId,
        from: 2,
        to: 6,
        text: '外部删除后保留的批注',
      });
      await f.desk.save(f.id, { to: 'project' });
      await f.desk.closeSession(f.id);
      const zip = await JSZip.loadAsync(await readFile(f.file));
      const xml = (await zip.file('word/document.xml').async('string'))
        .replace(/<w:commentRange(?:Start|End)\b[^>]*\/>/gu, '')
        .replace(/<w:commentReference\b[^>]*\/>/gu, '')
        .replace('甲乙丙丁', '外部新正文');
      zip.file('word/document.xml', xml);
      zip.file(
        'word/comments.xml',
        (await zip.file('word/comments.xml').async('string')).replace(
          /<w:comment\b[\s\S]*?<\/w:comment>/gu,
          '',
        ),
      );
      await writeFile(f.file, await zip.generateAsync({ type: 'nodebuffer' }));
      const bytes = await readFile(f.file);
      let opened = await f.desk.openSession({ groupId: f.group.id });
      const loss = opened.changes.find((change) => change.op === 'annotation-lost');
      assert.equal(loss.annotations[0].before.id, comment.item.id);
      const originalText = opened.blocks.map((block) => block.text);
      await f.desk.undoChange(loss.id);
      assert.equal((await f.desk.listAnnotations(opened.session.id)).items[0].status, 'lost');
      assert.deepEqual(
        (await f.desk.getSession(opened.session.id)).blocks.map((block) => block.text),
        originalText,
      );
      assert.deepEqual(await readFile(f.file), bytes);
      await f.desk.save(opened.session.id, { to: 'project' });
      assert.equal((await readDocx(await readFile(f.file))).comments.length, 0);
      await f.desk.closeSession(opened.session.id);
      opened = await f.desk.openSession({ groupId: f.group.id });
      assert.equal((await f.desk.listAnnotations(opened.session.id)).items[0].status, 'lost');
      const target = opened.blocks[1];
      await f.desk.updateAnnotation(comment.item.id, { blockId: target.id, from: 0, to: 3 });
      assert.equal((await f.desk.listAnnotations(opened.session.id)).items[0].status, 'anchored');
      assert.equal(
        (await f.desk.listAnnotations(opened.session.id)).items[0].endBlockId,
        target.id,
      );
      await f.desk.save(opened.session.id, { to: 'project' });
      assert.equal((await readDocx(await readFile(f.file))).comments.length, 1);
      const change = (await f.desk.getSession(opened.session.id)).changes.at(-1);
      await f.desk.undoChange(change.id);
      assert.equal((await f.desk.listAnnotations(opened.session.id)).items[0].status, 'lost');
      await f.desk.save(opened.session.id, { to: 'project' });
      assert.equal((await readDocx(await readFile(f.file))).comments.length, 0);
      await f.desk.closeSession(opened.session.id);
      const returning = await JSZip.loadAsync(await readFile(f.file));
      returning.file(
        'word/document.xml',
        (await returning.file('word/document.xml').async('string')).replace(
          '外部新正文',
          '甲乙丙丁',
        ),
      );
      await writeFile(f.file, await returning.generateAsync({ type: 'nodebuffer' }));
      opened = await f.desk.openSession({ groupId: f.group.id });
      const item = (await f.desk.listAnnotations(opened.session.id)).items[0];
      assert.equal(item.status, 'anchored');
      assert.equal(item.quote.exact, '甲乙丙丁');
      await f.desk.save(opened.session.id, { to: 'project' });
      assert.equal((await readDocx(await readFile(f.file))).comments.length, 1);
      await f.desk.closeSession(opened.session.id);
      // Deleting just the native comment in Word must not silently recreate it.
      const deleted = await JSZip.loadAsync(await readFile(f.file));
      deleted.file(
        'word/document.xml',
        (await deleted.file('word/document.xml').async('string'))
          .replace(/<w:commentRange(?:Start|End)\b[^>]*\/>/gu, '')
          .replace(/<w:commentReference\b[^>]*\/>/gu, ''),
      );
      deleted.file(
        'word/comments.xml',
        (await deleted.file('word/comments.xml').async('string')).replace(
          /<w:comment\b[\s\S]*?<\/w:comment>/gu,
          '',
        ),
      );
      await writeFile(f.file, await deleted.generateAsync({ type: 'nodebuffer' }));
      opened = await f.desk.openSession({ groupId: f.group.id });
      assert.equal((await f.desk.listAnnotations(opened.session.id)).items.length, 0);
      assert.ok(opened.changes.some((entry) => entry.op === 'annotation-lost'));
    } finally {
      await f.close();
    }
  }));
