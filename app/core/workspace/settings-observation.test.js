import test from 'node:test';
import assert from 'node:assert/strict';
import { channel } from 'node:diagnostics_channel';
import { tempDir } from '../../testing.js';
import { createCore } from '../index.js';
import { providerSettings } from '../../services/provider-settings.js';

test('opt-in settings observations expose stage timings and counts while queued edits retain values and revisions', async () => {
  const { dir, cleanup } = await tempDir('settings-observation');
  const core = await createCore({ dataRoot: dir, settingsResource: providerSettings(dir) });
  const observations = channel('sciencescope.settings.performance');
  const seen = [];
  const record = (message) => seen.push(message);
  observations.subscribe(record);
  try {
    const edit = (bio) =>
      core.workspace.edit({
        resource: 'settings',
        key: 'app',
        op: 'patch',
        args: { changes: { profile: { bio } } },
      });
    const [first, second] = await Promise.all([
      edit('private-first-value'),
      edit('private-final-value'),
    ]);
    assert.ok(first.revisionId);
    assert.ok(second.revisionId);
    assert.notEqual(first.revisionId, second.revisionId);
    assert.equal(
      (await core.workspace.read({ resource: 'settings', key: 'app' })).value.profile.bio,
      'private-final-value',
    );
    const stages = new Set(seen.map((observation) => observation.stage));
    for (const stage of [
      'workspace.queue',
      'workspace.read',
      'workspace.prepare',
      'workspace.apply',
      'workspace.write',
      'workspace.revision',
      'workspace.afterEdit',
      'provider.prepare',
      'provider.afterEdit',
    ])
      assert.ok(stages.has(stage), stage);
    assert.equal(seen.filter((observation) => observation.stage === 'workspace.write').length, 2);
    for (const observation of seen) {
      assert.deepEqual(Object.keys(observation).sort(), ['count', 'durationMs', 'stage']);
      assert.ok(observation.durationMs >= 0);
      assert.equal(observation.count, 1);
    }
    assert.ok(!JSON.stringify(seen).includes('private-'));
    assert.ok(!JSON.stringify(seen).includes(dir));
  } finally {
    observations.unsubscribe(record);
    core.close();
    await cleanup();
  }
});
