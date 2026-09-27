import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createResearchInputStore } from '../scripts/research-input-store.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  return { db, store: createResearchInputStore({ db }) };
}

function close({ db }) {
  db.close();
}

const empty = { attachmentIds: [], messageQuotes: [], annotations: [], contextRefs: [] };

test('main accepted annotation snapshot removes only the captured revision', () => {
  const f = fixture();
  try {
    const a0 = { id: 'a', revision: 0, resourceId: 'r-a', selectedText: 'A' };
    const b0 = { id: 'b', revision: 0, resourceId: 'r-b', selectedText: 'B' };
    f.store.save('main', 'chat-main', { ...empty, annotations: [a0, b0] });
    const sentSnapshot = { ...empty, annotations: [a0,b0] };

    const a1 = { ...a0, revision: 1 };
    const c0 = { id: 'c', revision: 0, resourceId: 'r-c', selectedText: 'C' };
    f.store.save('main', 'chat-main', { ...empty, annotations: [a1,b0,c0] });
    f.store.accepted('main', 'chat-main', 'main-chat', 'message-1', sentSnapshot);

    assert.deepEqual(f.store.get('main', 'chat-main').annotations, [a1, c0]);
    f.store.save('main', 'chat-main', { ...empty, annotations: [a1,b0,c0] });
    assert.deepEqual(f.store.get('main', 'chat-main').annotations, [a1,c0], 'a delayed draft save must not resurrect the consumed revision');
  } finally {
    close(f);
  }
});

test('secretary acceptance does not clear annotations and remains isolated from main scope', () => {
  const f = fixture();
  try {
    const main = { id: 'main-a', revision: 0, resourceId: 'r-main', selectedText: 'main' };
    const secretary = { id: 'secretary-a', revision: 0, resourceId: 'r-secretary', selectedText: 'secretary' };
    f.store.save('main', 'shared-owner', { ...empty, annotations: [main] });
    f.store.save('secretary', 'shared-owner', { ...empty, annotations: [secretary] });
    f.store.accepted('secretary', 'shared-owner', 'secretary-chat', 'message-1', { ...empty, annotations: [secretary] });

    assert.deepEqual(f.store.get('main', 'shared-owner').annotations, [main]);
    assert.deepEqual(f.store.get('secretary', 'shared-owner').annotations, [secretary]);
    assert.deepEqual(f.store.receipt('secretary-chat', 'message-1').annotations, [secretary]);
  } finally {
    close(f);
  }
});

test('repeating accepted for the same message is idempotent and preserves one receipt', () => {
  const f = fixture();
  try {
    const annotation = { id: 'a', revision: 0, resourceId: 'r-a', selectedText: 'A' };
    const snapshot = { ...empty, annotations: [annotation] };
    f.store.save('main', 'chat-main', { ...empty, annotations: [annotation] });
    f.store.accepted('main', 'chat-main', 'main-chat', 'message-1', snapshot);
    f.store.accepted('main', 'chat-main', 'main-chat', 'message-1', snapshot);

    assert.equal(f.store.receipt('main-chat', 'message-1').annotations[0].id, 'a');
    const count = f.db.prepare('SELECT COUNT(*) AS count FROM research_input_receipts WHERE chat_id=? AND message_id=?').get('main-chat', 'message-1').count;
    assert.equal(count, 1);
  } finally {
    close(f);
  }
});

test('context refs preserve resource and item identity when accepted and restored', () => {
  const f = fixture();
  try {
    const refs = [{ resourceId: 'same-id' }, { itemId: 'same-id' }, { itemId: 'item-2' }];
    f.store.save('main', 'chat-main', { ...empty, contextRefs: refs });
    const snapshot = { ...empty, contextRefs: [refs[1]] };
    f.store.accepted('main', 'chat-main', 'main-chat', 'message-refs', snapshot);
    assert.deepEqual(f.store.get('main', 'chat-main').contextRefs, [refs[0], refs[2]]);
    f.store.restore('main', 'chat-main', snapshot);
    assert.deepEqual(f.store.get('main', 'chat-main').contextRefs, [refs[0], refs[2], refs[1]], 'restored refs are appended after unconsumed refs');
  } finally {
    close(f);
  }
});

test('main accepted quote snapshot matches id and revision, retaining updated and new quotes', () => {
  const f = fixture();
  try {
    const q10 = { id: 'q1', revision: 0, sourceChatId: 'source-chat', sourceMessageId: 'source-1', selectedText: 'old A' };
    const q20 = { id: 'q2', revision: 0, sourceChatId: 'source-chat', sourceMessageId: 'source-2', selectedText: 'B' };
    f.store.save('main', 'chat-main', { ...empty, messageQuotes: [q10, q20] });
    const sentSnapshot = { ...empty, messageQuotes: [q20] };

    const q11 = { ...q10, revision: 1, selectedText: 'new A' };
    const q30 = { id: 'q3', revision: 0, sourceChatId: 'source-chat', sourceMessageId: 'source-3', selectedText: 'C' };
    f.store.save('main', 'chat-main', { ...empty, messageQuotes: [q11, q30] });
    f.store.accepted('main', 'chat-main', 'main-chat', 'message-quote', sentSnapshot);

    assert.deepEqual(f.store.get('main', 'chat-main').messageQuotes, [q11, q30]);
  } finally {
    close(f);
  }
});
