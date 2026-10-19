import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument, rgb } from 'pdf-lib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createApp } from '../../app.js';
import { tempDir } from '../../testing.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';

test('view_image sends PDF pages, magnified regions and raster images to the runtime, keeping only previews in records', async () => {
  const { dir, cleanup } = await tempDir('view-image');
  const received = [];
  let sourceId;
  const app = await createApp({
    dataRoot: dir,
    token: 'test',
    runtime: createScriptedRuntime({
      script: async function* ({ call }) {
        for (const args of [
          { sourceId, page: 1 },
          { path: '公式.pdf', page: 1, region: { x: 0.1, y: 0.1, w: 0.4, h: 0.2 } },
          { path: '图像.png', region: { x: 0.5, y: 0, w: 0.5, h: 1 } },
        ]) {
          const result = await call('view_image', args);
          assert.equal(result.images[0].mimeType, 'image/png');
          const bytes = Buffer.from(result.images[0].data, 'base64');
          assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
          const image = await loadImage(bytes);
          assert.ok(Math.max(image.width, image.height) <= 1600);
          assert.equal(image.width, result.preview.width);
          received.push(result);
        }
        yield 'I inspected the formula and its detail.';
      },
    }),
  });
  try {
    await app.core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: {
        changes: {
          models: { default: { provider: 'test', model: 'test' } },
          python: { defaultEnvironment: 'system' },
        },
      },
    });
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([600, 800]);
    page.drawText('y = a + b*x', { x: 70, y: 650, size: 24 });
    page.drawRectangle({ x: 400, y: 80, width: 100, height: 100, color: rgb(1, 0, 0) });
    const bytes = await pdf.save();
    await writeFile(path.join(dir, '公式.pdf'), bytes);
    const raster = createCanvas(2000, 1000);
    raster.getContext('2d').fillRect(1000, 0, 1000, 1000);
    await writeFile(path.join(dir, '图像.png'), await raster.encode('png'));
    const source = await app.research.importSource({ name: '公式.pdf', bytes });
    sourceId = source.id;
    const meeting = app.core.meetings.create({
      workFolder: dir,
      members: [{ participantId: 'agent_main' }],
    });
    const base = await app.listen();
    app.conductor.submit({
      meetingId: meeting.id,
      authorId: 'person_user',
      text: 'Explain the formula.',
    });
    await app.conductor.idle();
    assert.equal(received.length, 3);
    assert.notEqual(received[0].images[0].data, received[1].images[0].data);
    assert.equal(received[1].preview.width, 1600);
    assert.equal(received[2].preview.width, 1000);
    const answer = app.core.messages.since(meeting.id, 0).at(-1);
    assert.equal(answer.status, 'done');
    const records = app.core.turns.toolCalls(answer.turnId);
    assert.equal(records.length, 3);
    for (const [index, record] of records.entries()) {
      assert.equal(record.result.images, undefined);
      const response = await fetch(base + record.result.preview.url, {
        headers: { authorization: 'Bearer test' },
      });
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.deepEqual(
        Buffer.from(await response.arrayBuffer()),
        await readFile(received[index].preview.path),
      );
    }
    const events = app.core.db.prepare('SELECT payload_json FROM events').all();
    assert.ok(!JSON.stringify(events).includes(received[0].images[0].data));
  } finally {
    await app.close();
    await cleanup();
  }
});
