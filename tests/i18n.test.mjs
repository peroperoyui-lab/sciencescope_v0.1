import test from 'node:test';
import assert from 'node:assert/strict';
import { translate } from '../desktop/i18n.mjs';
import { EN, EN_PATTERNS } from '../desktop/i18n-en.mjs';

test('i18n: interface text translates, user data never half-translates', () => {
  assert.equal(translate('设置'), 'Settings');
  assert.equal(translate('暂无置顶'), 'No pinned items');
  assert.equal(translate('  新对话 '), '  New chat ', 'surrounding whitespace is kept');
  assert.equal(translate('工具记录 · 3'), 'Tool activity · 3', 'known fragments around numbers');
  assert.equal(translate('4 个对话'), '4 chats');
  assert.equal(translate('要在 城市就业韧性 里研究什么？'), 'What shall we research in 城市就业韧性?', 'a captured name stays as is');
  assert.equal(translate('界面字体说明'), 'About the interface font');
  assert.equal(translate('新对话测试'), null, 'unknown Chinese leaves the whole text alone');
  assert.equal(translate('间歇性禁食与代谢健康'), null);
  assert.equal(translate('ScienceScope 0123'), 'ScienceScope 0123', 'non-Chinese text is untouched');
});

test('i18n: dictionary is well formed', () => {
  for (const [zh, en] of Object.entries(EN)) {
    assert.ok(typeof en === 'string' && en.trim(), `empty translation for ${zh}`);
    assert.doesNotMatch(en, /[㐀-鿿]/u, `Chinese left in the translation of ${zh}`);
  }
  for (const [source] of EN_PATTERNS) assert.doesNotThrow(() => new RegExp(`^${source}$`, 'u'));
});
