import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, initialState } from './state.js';

test('an expert adding comments and indexes on the desk is not shown as a rewrite', () => {
  const changed = (seq, ops, blockIds) => ({
    type: 'desk.changed',
    actorId: 'person_main',
    payload: {
      sessionId: 's1',
      seq,
      blockIds,
      changeIds: ops.map((_, index) => `chg_${seq}_${index}`),
      ops,
    },
  });
  let state = applyEvent(initialState, changed(1, ['comment', 'annotation'], ['b:1', 'b:2']));
  assert.equal(state.deskSeqs.s1, 1);
  assert.equal(state.deskEdits.s1, undefined);
  state = applyEvent(state, changed(2, ['edit', 'annotation', 'edit'], ['b:1', 'b:1', 'b:3']));
  assert.deepEqual(state.deskEdits.s1, [
    {
      seq: 2,
      actorId: 'person_main',
      meetingId: null,
      changeIds: ['chg_2_0', 'chg_2_2'],
      blockIds: ['b:1', 'b:3'],
    },
  ]);
});
