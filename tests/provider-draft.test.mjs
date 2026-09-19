import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOLS, validateProviderDraft } from '../desktop/provider-draft.mjs';
const draft = {name:' Research ',baseUrl:'https://example.com/v1',protocol:'openai-chat-completions',models:' manual-id \nother\nmanual-id'};

for (const {id} of PROTOCOLS) test(`accepts explicit ${id} with manual model IDs`, () => {
  const result = validateProviderDraft({...draft,protocol:id});
  assert.equal(result.ok,true);
  assert.deepEqual(result.value,{name:'Research',baseUrl:draft.baseUrl,protocol:id,models:['manual-id','other']});
});
test('does not infer protocol from model name', () => {
  assert.equal(validateProviderDraft({...draft,protocol:'',models:'gpt-example'}).ok,false);
});
test('returns only non-credential draft fields', () => {
  const result = validateProviderDraft({...draft,apiKey:'TEST_ONLY_NOT_A_KEY',credential:{value:'TEST_ONLY_NOT_A_KEY'},extra:'ignored'});
  assert.deepEqual(Object.keys(result.value).sort(),['baseUrl','models','name','protocol']);
  assert.ok(!JSON.stringify(result).includes('TEST_ONLY_NOT_A_KEY'));
});
test('invalid address, absent model, malformed input yield field errors', () => {
  for (const baseUrl of ['','ftp://example.com','https://u:p@example.com','https://example.com?key=example','https://example.com#fragment']) {
    assert.ok(validateProviderDraft({...draft,baseUrl}).errors.baseUrl);
  }
  assert.ok(validateProviderDraft({...draft,models:'\n '}).errors.models);
  for (const value of [null,undefined,42,[], 'draft']) assert.equal(validateProviderDraft(value).ok,false);
});
