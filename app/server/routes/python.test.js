import test from 'node:test';
import assert from 'node:assert/strict';
import { probeSource } from './python.js';

test('a download source probe reports the answer, refusals and bad addresses', async () => {
  const answer = (status) => /** @type {any} */ (async () => ({ status, body: null }));
  assert.deepEqual(await probeSource('https://mirror.example/simple', answer(200)), {
    ok: true,
    status: 200,
  });
  assert.deepEqual(await probeSource('https://mirror.example/simple', answer(404)), {
    ok: false,
    status: 404,
    reason: 'HTTP 404',
  });
  const refused = /** @type {any} */ (
    async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }
  );
  assert.deepEqual(await probeSource('https://mirror.example', refused), {
    ok: false,
    reason: 'ECONNREFUSED',
  });
  await assert.rejects(probeSource('ftp://mirror.example', answer(200)), { code: 'INVALID_URL' });
  await assert.rejects(probeSource('not an address', answer(200)), { code: 'INVALID_URL' });
});
