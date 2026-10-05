import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from './errors.js';

test('AppError keeps code, message and status', () => {
  const error = new AppError('MEETING_NOT_FOUND', '找不到这个会议。', 404);
  assert.equal(error.code, 'MEETING_NOT_FOUND');
  assert.equal(error.message, '找不到这个会议。');
  assert.equal(error.status, 404);
  assert.ok(error instanceof Error);
});
