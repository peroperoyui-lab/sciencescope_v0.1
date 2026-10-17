import test from 'node:test';
import assert from 'node:assert/strict';
import { tempDir } from '../../testing.js';
import { dataPaths } from '../../core/paths.js';
import { saveKey } from '../../services/providers.js';
import { createModelCatalog } from './catalog.js';

test('presets use their own APIs and capacities; custom models match or receive explicit defaults', async () => {
  const { dir, cleanup } = await tempDir('pi-catalog');
  try {
    const paths = dataPaths(dir);
    const providers = [];
    const catalog = createModelCatalog({ paths, providers: async () => providers });
    assert.deepEqual(
      catalog.presets().map((entry) => entry.id),
      ['opencode-go', 'deepseek'],
    );
    providers.push(catalog.preset('opencode-go'), catalog.preset('deepseek'));
    await saveKey(paths, 'opencode-go', 'test-key');
    const preset = await catalog.resolve({ provider: 'opencode-go', model: 'deepseek-v4.1-flash' });
    assert.equal(preset.descriptor.limitsSource, 'catalog');
    assert.equal(preset.model.api, 'openai-completions');
    assert.ok(preset.model.compat);
    providers.push({
      id: 'custom',
      api: 'openai-completions',
      baseUrl: 'http://localhost/v1',
      models: [
        { id: 'deepseek-v4.1-flash', contextWindow: 1, maxTokens: 1 },
        { id: 'my-model', contextWindow: 2, maxTokens: 2 },
      ],
    });
    const matched = await catalog.descriptor({ provider: 'custom', model: 'deepseek-v4.1-flash' });
    assert.equal(matched.limitsSource, 'matched');
    assert.equal(matched.contextWindow, preset.descriptor.contextWindow);
    const unknown = await catalog.descriptor({ provider: 'custom', model: 'my-model' });
    assert.equal(unknown.limitsSource, 'default');
    assert.equal(unknown.contextWindow, 131072);
    assert.equal(unknown.maxTokens, 32768);
    const entries = (await catalog.list()).providers;
    assert.equal(entries[0].hasKey, true);
    assert.equal(entries[1].hasKey, false);
    assert.equal(JSON.stringify(entries).includes('test-key'), false);
  } finally {
    await cleanup();
  }
});
