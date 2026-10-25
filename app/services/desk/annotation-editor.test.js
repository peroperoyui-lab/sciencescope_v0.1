import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { withCore } from '../../testing.js';
import { readDocx } from './docx/read.js';
import { setupAnnotations as setup } from './annotation-testing.js';

/** Remove characters `from`–`to` of the block text, keeping every atom. */
function cut(inlines, from, to) {
  let offset = 0;
  return inlines.flatMap((inline) => {
    if (inline.atom) {
      offset += (inline.display ?? '').length;
      return [inline];
    }
    const start = offset;
    offset += inline.text.length;
    const clamp = (at) => Math.max(0, Math.min(inline.text.length, at - start));
    const text = inline.text.slice(0, clamp(from)) + inline.text.slice(clamp(to));
    return text ? [{ ...inline, text }] : [];
  });
}

test('the editor undoes a deletion and the Word comment and index it took come back', () =>
  withCore('desk-annotations-editor-docx', async (core, dir) => {
    const f = await setup(core, dir, 'docx');
    try {
      const blockId = f.opened.blocks[0].id;
      const comment = await f.desk.createAnnotation(f.id, {
        type: 'comment',
        blockId,
        from: 2,
        to: 6,
        text: '核对证据',
      });
      const index = await f.desk.createAnnotation(f.id, {
        type: 'index',
        blockId,
        from: 2,
        to: 6,
        sources: f.sources,
      });
      let session = await f.desk.getSession(f.id);
      const original = session.blocks[0].inlines;
      assert.ok(
        original
          .filter((inline) => inline.atom?.startsWith('comment-'))
          .every((inline) => inline.comment === comment.item.id),
      );
      const held = [{ id: index.item.id, blockId, from: 2, to: 6 }];
      // The editor keeps Word comment delimiters when their text is deleted.
      const removed = await f.desk.updateBlocks(f.id, {
        baseSeq: session.session.seq,
        blocks: { [blockId]: cut(original, 2, 6) },
        annotations: [],
      });
      assert.equal(removed.removedAnnotations, 2);
      assert.deepEqual(removed.removed.map((item) => item.type).sort(), ['comment', 'index']);
      session = await f.desk.getSession(f.id);
      assert.ok(!session.blocks[0].inlines.some((inline) => inline.atom?.startsWith('comment-')));
      await f.desk.updateBlocks(f.id, {
        baseSeq: session.session.seq,
        blocks: { [blockId]: original },
        annotations: held,
      });
      let items = (await f.desk.listAnnotations(f.id)).items;
      assert.deepEqual(
        items.map((item) => item.id).sort(),
        [comment.item.id, index.item.id].sort(),
      );
      assert.ok(
        items.every((item) => item.quote.exact === '甲乙丙丁' && item.status === 'anchored'),
      );
      assert.equal(items.find((item) => item.type === 'comment').text, '核对证据');

      // An explicitly deleted index stays deleted, whatever the editor still holds.
      await f.desk.updateAnnotation(index.item.id, {}, {}, { remove: true });
      session = await f.desk.getSession(f.id);
      await f.desk.updateBlocks(f.id, {
        baseSeq: session.session.seq,
        blocks: { [blockId]: cut(session.blocks[0].inlines, 0, 1) },
        annotations: [{ id: index.item.id, blockId, from: 1, to: 5 }],
      });
      items = (await f.desk.listAnnotations(f.id)).items;
      assert.deepEqual(
        items.map((item) => item.id),
        [comment.item.id],
      );

      // Delimiters left behind by a removed comment are not saved into Word.
      session = await f.desk.getSession(f.id);
      const kept = cut(session.blocks[0].inlines, 1, 5);
      await f.desk.updateBlocks(f.id, {
        baseSeq: session.session.seq,
        blocks: { [blockId]: kept },
      });
      session = await f.desk.getSession(f.id);
      await f.desk.updateBlocks(f.id, {
        baseSeq: session.session.seq,
        blocks: { [blockId]: cut(kept, 1, 2) },
      });
      await f.desk.save(f.id, { to: 'project' });
      const document = await readDocx(await readFile(f.file));
      assert.equal(document.comments.length, 0);
      const xml = await document.zip.file('word/document.xml').async('string');
      assert.doesNotMatch(xml, /commentRange|commentReference/u);
      assert.equal(document.blocks[0].text, '文文。');
    } finally {
      await f.close();
    }
  }));

test('Markdown marks follow the editor into a split paragraph and return on undo', () =>
  withCore('desk-annotations-editor-md', async (core, dir) => {
    const f = await setup(core, dir, 'md');
    try {
      const index = await f.desk.createAnnotation(f.id, {
        type: 'index',
        blockId: f.opened.blocks[0].id,
        from: 2,
        to: 6,
        sources: f.sources,
      });
      let session = await f.desk.getSession(f.id);
      const split = session.text.replace('前文', '前文\n\n');
      await f.desk.updateText(f.id, {
        baseSeq: session.session.seq,
        text: split,
        annotations: [{ id: index.item.id, block: 1, from: 0, to: 4 }],
      });
      session = await f.desk.getSession(f.id);
      let [item] = (await f.desk.listAnnotations(f.id)).items;
      assert.equal(item.blockId, session.blocks[1].id);
      assert.deepEqual([item.from, item.to, item.quote.exact], [0, 4, '甲乙丙丁']);

      const result = await f.desk.updateText(f.id, {
        baseSeq: session.session.seq,
        text: split.replace('甲乙丙丁', ''),
        annotations: [],
      });
      assert.equal(result.removedAnnotations, 1);
      session = await f.desk.getSession(f.id);
      await f.desk.updateText(f.id, {
        baseSeq: session.session.seq,
        text: split,
        annotations: [{ id: index.item.id, block: 1, from: 0, to: 4 }],
      });
      [item] = (await f.desk.listAnnotations(f.id)).items;
      assert.equal(item.id, index.item.id);
      assert.equal(item.quote.exact, '甲乙丙丁');

      // Different words in the same place do not bring a removed item back.
      session = await f.desk.getSession(f.id);
      await f.desk.updateText(f.id, {
        baseSeq: session.session.seq,
        text: split.replace('甲乙丙丁', ''),
      });
      session = await f.desk.getSession(f.id);
      await f.desk.updateText(f.id, {
        baseSeq: session.session.seq,
        text: split.replace('甲乙丙丁', '戊己庚辛'),
        annotations: [{ id: index.item.id, block: 1, from: 0, to: 4 }],
      });
      assert.deepEqual((await f.desk.listAnnotations(f.id)).items, []);
    } finally {
      await f.close();
    }
  }));
