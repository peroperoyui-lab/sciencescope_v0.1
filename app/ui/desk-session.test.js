import test from 'node:test';
import assert from 'node:assert/strict';
import { fromDocJSON, mergeBlocks, mergeText, toDocJSON, confirmedOf } from './desk-blocks.js';
import { createDeskSession } from './desk-session.js';

const text = (value, run = 0) => [{ text: value, marks: [], run }];
const block = (id, value, run = 0) => ({ id, kind: 'paragraph', inlines: text(value, run) });

/** An editor stand-in holding paragraphs the way the page does. */
function fakeEditor(blocks) {
  let current = fromDocJSON(toDocJSON(blocks));
  return {
    snapshot: () => structuredClone(current),
    adopt: (next) => {
      current = fromDocJSON(toDocJSON(next));
    },
    rename: (ids) => {
      current = current.map((entry) => ({ ...entry, id: ids[entry.id] ?? entry.id }));
    },
    edit: (id, value) => {
      const entry = current.find((item) => item.id === id);
      entry.inlines = [{ ...entry.inlines[0], text: value }];
    },
    split: (after, id, value) => {
      const index = current.findIndex((item) => item.id === after);
      current.splice(index + 1, 0, {
        id,
        kind: 'paragraph',
        like: after,
        container: 'body',
        inlines: [{ text: value, marks: [] }],
      });
    },
    text: (id) => current.find((item) => item.id === id)?.inlines[0]?.text,
  };
}

/** Timers run when the test says so. */
function clock() {
  const pending = new Set();
  return {
    schedule: (run) => {
      const timer = { run };
      pending.add(timer);
      return timer;
    },
    cancel: (timer) => pending.delete(timer),
    async tick() {
      for (const timer of [...pending]) {
        pending.delete(timer);
        timer.run();
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

test('typing is sent once after a pause, new paragraphs take the server ids', async () => {
  const requests = [];
  const statuses = [];
  const actions = {
    patchDeskBlocks: async (id, body) => {
      requests.push(body);
      return { seq: body.baseSeq + 1, inserted: { 'n:1': 'p:NEW' } };
    },
  };
  const editor = fakeEditor([block('p:1', '甲'), block('p:2', '乙')]);
  const timers = clock();
  const session = createDeskSession({
    actions,
    opened: {
      session: { id: 'desk_1', seq: 0, savedSeq: 0 },
      blocks: [block('p:1', '甲'), block('p:2', '乙')],
    },
    editor,
    onStatus: (status) => statuses.push(status.state),
    ...timers,
  });
  editor.edit('p:1', '甲一');
  session.changed();
  editor.split('p:1', 'n:1', '新段');
  session.changed();
  assert.equal(requests.length, 0);
  await timers.tick();
  await session.flush();
  assert.deepEqual(requests, [
    {
      baseSeq: 0,
      blocks: { 'p:1': text('甲一') },
      inserted: [{ id: 'n:1', after: 'p:1', like: 'p:1', inlines: [{ text: '新段', marks: [] }] }],
      removed: [],
    },
  ]);
  assert.equal(editor.snapshot()[1].id, 'p:NEW');
  // Nothing new to send; the file is not written yet.
  await session.flush();
  assert.equal(requests.length, 1);
  assert.equal(session.seq, 1);
  assert.equal(statuses.at(-1), 'unsaved');
  assert.ok(statuses.includes('syncing'));
});

test('a conflict takes the server text for that paragraph and resends the rest', async () => {
  const requests = [];
  const server = [block('p:1', '专家改过'), block('p:2', '乙')];
  const actions = {
    patchDeskBlocks: async (id, body) => {
      requests.push(body);
      if (body.baseSeq === 0)
        throw Object.assign(new Error('conflict'), {
          code: 'DESK_CONFLICT',
          status: 409,
          details: { seq: 1, blockIds: ['p:1'] },
        });
      return { seq: 2, inserted: {} };
    },
    deskSession: async () => ({ session: { id: 'desk_1', seq: 1, savedSeq: 0 }, blocks: server }),
  };
  const opened = [block('p:1', '甲'), block('p:2', '乙')];
  const editor = fakeEditor(opened);
  const session = createDeskSession({
    actions,
    opened: { session: { id: 'desk_1', seq: 0, savedSeq: 0 }, blocks: opened },
    editor,
    ...clock(),
  });
  editor.edit('p:1', '我改甲');
  editor.edit('p:2', '我改乙');
  session.changed();
  await session.flush();
  assert.equal(editor.text('p:1'), '专家改过');
  assert.equal(editor.text('p:2'), '我改乙');
  assert.deepEqual(requests[1], {
    baseSeq: 1,
    blocks: { 'p:2': text('我改乙') },
    inserted: [],
    removed: [],
  });
  assert.equal(session.seq, 2);
});

test('another writer between our requests is picked up without losing typing', async () => {
  const opened = [block('p:1', '甲'), block('p:2', '乙')];
  const editor = fakeEditor(opened);
  const actions = {
    patchDeskBlocks: async () => ({ seq: 3, inserted: {} }),
    deskSession: async () => ({
      session: { id: 'desk_1', seq: 3, savedSeq: 0 },
      blocks: [block('p:1', '甲'), block('p:2', '专家补的'), block('p:3', '专家加的段')],
    }),
  };
  const session = createDeskSession({
    actions,
    opened: { session: { id: 'desk_1', seq: 0, savedSeq: 0 }, blocks: opened },
    editor,
    ...clock(),
  });
  editor.edit('p:1', '甲改');
  session.changed();
  await session.flush();
  // The fake server does not apply our edit, so the merge keeps ours only while unsent.
  assert.deepEqual(
    editor.snapshot().map((entry) => entry.id),
    ['p:1', 'p:2', 'p:3'],
  );
  assert.equal(editor.text('p:2'), '专家补的');
});

test('save asks first when the file is at another version or changed outside', async () => {
  const replies = [
    Object.assign(new Error('confirm'), {
      code: 'DESK_SAVE_CONFIRM',
      details: { versionId: 'version_2', versionNumber: 2 },
    }),
    { session: { id: 'desk_1', seq: 0, savedSeq: 0 } },
  ];
  const calls = [];
  const actions = {
    saveDesk: async (id, body) => {
      calls.push(body);
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  const opened = [block('p:1', '甲')];
  const session = createDeskSession({
    actions,
    opened: { session: { id: 'desk_1', seq: 0, savedSeq: 0 }, blocks: opened },
    editor: fakeEditor(opened),
    ...clock(),
  });
  assert.deepEqual(await session.save(), { confirm: { versionId: 'version_2', versionNumber: 2 } });
  assert.equal((await session.save(true)).saved, true);
  assert.deepEqual(calls, [{ to: 'project' }, { to: 'project', confirm: true }]);
});

test('text sessions merge an outside edit that does not overlap', async () => {
  let current = '﻿# 题\r\n\r\n甲\r\n';
  const editor = {
    snapshot: () => current,
    adopt: (next) => {
      current = next;
    },
  };
  const requests = [];
  const actions = {
    putDeskText: async (id, body) => {
      requests.push(body);
      if (body.baseSeq === 0)
        throw Object.assign(new Error('conflict'), {
          code: 'DESK_CONFLICT',
          status: 409,
          details: { seq: 1 },
        });
      return { seq: 2, inserted: {} };
    },
    deskSession: async () => ({
      session: { id: 'desk_1', seq: 1, savedSeq: 0 },
      text: '﻿# 新题\r\n\r\n甲\r\n',
    }),
  };
  const session = createDeskSession({
    actions,
    opened: { session: { id: 'desk_1', seq: 0, savedSeq: 0 }, text: current },
    editor,
    ...clock(),
  });
  current = '﻿# 题\r\n\r\n甲乙\r\n';
  session.changed();
  await session.flush();
  assert.equal(current, '﻿# 新题\r\n\r\n甲乙\r\n');
  assert.deepEqual(requests.at(-1), { baseSeq: 1, text: current });
});

test('merges keep unsent paragraphs and let the server win where asked', () => {
  const confirmed = confirmedOf([block('p:1', '甲'), block('p:2', '乙'), block('p:3', '丙')]);
  const local = fromDocJSON(
    toDocJSON([block('p:1', '甲改'), block('n:1', '新'), block('p:3', '丙')]),
  );
  const server = [
    block('p:1', '甲'),
    block('p:2', '乙'),
    block('p:3', '丙专家'),
    block('p:4', '丁'),
  ];
  assert.deepEqual(
    mergeBlocks(server, confirmed, local).map((entry) => [entry.id, entry.inlines[0].text]),
    [
      ['p:1', '甲改'],
      ['n:1', '新'],
      ['p:3', '丙专家'],
      ['p:4', '丁'],
    ],
  );
  assert.deepEqual(
    mergeBlocks(server, confirmed, local, new Set(['p:1'])).map((entry) => entry.id),
    ['p:1', 'n:1', 'p:3', 'p:4'],
  );
  assert.equal(mergeBlocks(server, confirmed, local, 'all').length, 4);
  assert.equal(mergeText('ab', 'aXb', 'ab'), 'aXb');
  assert.equal(mergeText('abc', 'Xabc', 'abcY'), 'XabcY');
  assert.equal(mergeText('abc', 'aXc', 'aYc'), 'aXc');
});
