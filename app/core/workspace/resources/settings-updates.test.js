import test from 'node:test';
import assert from 'node:assert/strict';
import { settings } from './settings.js';

test('existing settings gain automatic update checks and retain the stored preference and attempt time', () => {
  const before = JSON.stringify({ version: 1, profile: { name: 'Synthetic user' } });
  assert.deepEqual(settings.parse(before).updates, { autoCheck: true, lastCheckedAt: null });
  const saved = settings.apply(before, 'patch', {
    changes: { updates: { autoCheck: false, lastCheckedAt: 1792800000000 } },
  });
  assert.deepEqual(settings.parse(saved).updates, {
    autoCheck: false,
    lastCheckedAt: 1792800000000,
  });
  const enabled = settings.apply(saved, 'patch', { changes: { updates: { autoCheck: true } } });
  assert.equal(settings.parse(enabled).updates.lastCheckedAt, 1792800000000);
  assert.equal(settings.parse(enabled).profile.name, 'Synthetic user');
});
