import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../app.js';
import { createScriptedRuntime } from '../scripted.js';
import { tempDir } from '../../testing.js';

test('a blank application adds two key-only presets, exposes model metadata and tests a connection', async () => {
  const { dir, cleanup } = await tempDir('pi-provider-api');
  const app = await createApp({
    dataRoot: dir,
    token: 'test',
    runtime: createScriptedRuntime({
      script: async function* () {
        yield 'OK';
      },
    }),
  });
  try {
    const url = await app.listen();
    const call = async (method, route, body) => {
      const response = await fetch(url + route, {
        method,
        headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(response.ok, true);
      return response.json();
    };
    assert.deepEqual(
      (await call('GET', '/api/providers/presets')).map((entry) => entry.id),
      ['opencode-go', 'deepseek'],
    );
    for (const id of ['opencode-go', 'deepseek']) {
      const saved = await call('POST', '/api/providers/presets/' + id, { key: 'fixture-key' });
      assert.equal(saved.id, id);
      assert.ok(saved.models.length);
      assert.equal(JSON.stringify(saved).includes('fixture-key'), false);
    }
    const catalog = await call('GET', '/api/models');
    assert.ok(catalog.providers.every((provider) => provider.hasKey));
    assert.ok(
      catalog.providers.every((provider) =>
        provider.models.every(
          (model) =>
            model.limitsSource === 'catalog' &&
            model.contextWindow > 0 &&
            Array.isArray(model.thinkingLevels),
        ),
      ),
    );
    const result = await call('POST', '/api/providers/opencode-go/test', {
      model: 'deepseek-v4.1-flash',
    });
    assert.equal(result.ok, true);
    assert.equal(result.model, 'deepseek-v4.1-flash');
    assert.ok(result.latencyMs >= 0);
  } finally {
    await app.close();
    await cleanup();
  }
});
