import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { observePage, summarizeHttp, stopProfile } from './native-profile.mjs';

test('native CDP measurement correlates request completion and sampled function time', async () => {
  const root = path.resolve('.sciencescope-local/temp');
  await mkdir(root, { recursive: true });
  const output = await mkdtemp(path.join(root, 'native-profile-'));
  const session = new EventEmitter();
  session.send = async (name) =>
    name === 'Profiler.stop'
      ? {
          profile: {
            nodes: [
              {
                id: 1,
                callFrame: {
                  functionName: 'renderParagraph',
                  url: 'http://local/editor.js?v=1',
                  lineNumber: 19,
                },
              },
            ],
            samples: [1, 1],
            timeDeltas: [1000, 2000],
          },
        }
      : {};
  const page = new EventEmitter();
  page.context = () => ({ newCDPSession: async () => session });
  const rows = [];
  try {
    await observePage(page, rows, [], () => 'docx-open');
    session.emit('Network.requestWillBeSent', {
      requestId: 'r1',
      timestamp: 4,
      request: { method: 'GET', url: 'http://local/api/versions/version_abc/diff?baseline=old' },
    });
    session.emit('Network.responseReceived', {
      requestId: 'r1',
      timestamp: 4.05,
      response: { status: 200 },
    });
    session.emit('Network.loadingFinished', {
      requestId: 'r1',
      timestamp: 4.1,
      encodedDataLength: 100,
    });
    assert.equal(rows[0].route, '/api/versions/:id/diff');
    assert.equal(rows[0].operation, 'docx-open');
    assert.ok(Math.abs(rows[0].durationMs - 100) < 0.001);
    assert.ok(Math.abs(summarizeHttp(rows)[0].p95 - 100) < 0.001);
    const result = await stopProfile(session, output, 'sample');
    assert.equal(result.topFunctions[0].selfMs, 3);
    assert.equal(result.topFunctions[0].line, 20);
    const saved = JSON.parse(await readFile(path.join(output, 'sample.cpuprofile'), 'utf8'));
    assert.equal(saved.nodes[0].callFrame.url, '/editor.js');
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
