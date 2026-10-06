import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCitationLabel, citationFor, extractCitationLabels } from './citations.js';
import { indexText, matchExpression } from './text-index.js';

test('citation locators preserve page forms and unknown syntax; Chinese keywords use pairs', () => {
  assert.equal(citationFor({ number: 3 }, { page: 4 }), '[S3 p.4]');
  for (const label of ['[S3 p.4]', '[S3, p.4]', '[S3 p4]', '（Ｓ３ ｐ．４）', '[S3 第4页]']) {
    const parsed = parseCitationLabel(label);
    assert.equal(parsed.parseStatus, 'parsed');
    assert.deepEqual(
      parsed.citations.map((c) => [c.number, c.fromPage, c.toPage]),
      [[3, 4, 4]],
    );
  }
  assert.equal(parseCitationLabel('[S3; S5]').citations.length, 2);
  assert.equal(parseCitationLabel('[S3 p.4–5]').citations[0].toPage, 5);
  const unknown = parseCitationLabel('[S3 appendix X]');
  assert.equal(unknown.raw, '[S3 appendix X]');
  assert.equal(unknown.unrecognized[0].raw, 'S3 appendix X');
  assert.equal(parseCitationLabel('[S3 p.5–4]').parseStatus, 'unrecognized');
  assert.equal(parseCitationLabel('[S3)').parseStatus, 'unrecognized');
  assert.equal(parseCitationLabel('[@abcdef12]').citations[0].kind, 'item');
  assert.equal(extractCitationLabels('引用 [S3 p.4]，保留 [S3 appendix X]，书目 [1]。').length, 2);
  assert.equal(indexText('就业韧性'), '就业 业韧 韧性');
  assert.equal(matchExpression('就业韧性'), '"就业 业韧 韧性"');
});
