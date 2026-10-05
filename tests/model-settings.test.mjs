import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, Script } from 'node:vm';
import { PROTOCOLS, validateProviderDraft } from '../desktop/provider-draft.mjs';
import { infoTip } from '../desktop/info-tip.mjs';

async function mount() {
  const handlers = {};
  const context = createContext({
    PROTOCOLS, validateProviderDraft, infoTip, structuredClone,
    hostRequest: async () => { throw new Error('No host in offline UI test'); },
    modelsPage() {}, providerPage() {}, pageintro: (title, note, button = '') => title + note + button,
    ic: () => '', S: {settings:{}}, render() {}, closeMenu() {},
    go(page) { context.destination = page; },
    menu(items) { context.menuItems = items; },
    navItem: (text, route) => ({text, route}),
    window: {addEventListener(name, listener) { (handlers[name] ??= []).push(listener); }},
    document: {querySelector() { return {focus() { context.focused = true; }}; }},
  });
  const source = await readFile(new URL('../desktop/model-settings.mjs', import.meta.url), 'utf8');
  new Script(source.replace(/^import .*;\r?\n/gm, '')).runInContext(context);
  return {
    context,
    async click(apiAction, index) { for (const handler of handlers.click) await handler({target:{closest:selector => selector === 'button' ? {dataset:{apiAction,index}} : null}, preventDefault(){}, stopImmediatePropagation(){}}); },
    input(field, value) { handlers.input.forEach(handler => handler({target:{dataset:{apiField:field}, value}})); },
    async submit() { for (const handler of handlers.submit) await handler({target:{id:'api-provider-form'}, preventDefault(){}, stopImmediatePropagation(){}}); },
  };
}

test('empty model screen has no fake configured providers and credential field is disabled', async () => {
  const {context} = await mount();
  assert.match(context.modelsPage(), /添加第一个服务/);
  assert.doesNotMatch(context.modelsPage(), /自定义模型 A|DSH 默认服务/);
  assert.match(context.providerPage(), /type="password" disabled/);
  assert.equal(context.S.settings.model, '未连接模型');
});

test('manual configuration can be saved, edited and removed without claiming connection', async () => {
  const ui = await mount();
  await ui.click('new');
  assert.equal(ui.context.destination, 'provider');
  for (const [field, value] of Object.entries({name:'Research <service>',baseUrl:'https://example.com/v1',protocol:'openai-responses',models:'first\nsecond'})) ui.input(field, value);
  await ui.submit();
  assert.equal(ui.context.destination, 'models');
  assert.match(ui.context.modelsPage(), /Research &lt;service&gt;/);
  assert.match(ui.context.modelsPage(), /草稿 · 未连接/);
  await ui.click('edit', '0');
  assert.match(ui.context.providerPage(), /first\nsecond/);
  ui.input('models', 'third'); await ui.submit();
  assert.match(ui.context.modelsPage(), /third/);
  assert.doesNotMatch(ui.context.modelsPage(), />first</);
  await ui.click('remove', '0');
  assert.match(ui.context.modelsPage(), /添加第一个服务/);
});

test('invalid submit stays on form and preserves non-secret draft', async () => {
  const ui = await mount(); await ui.click('new'); ui.input('name', 'Keep this'); await ui.submit();
  assert.equal(ui.context.destination, 'provider');
  assert.equal(ui.context.focused, true);
  assert.match(ui.context.providerPage(), /Keep this/);
  assert.match(ui.context.providerPage(), /aria-invalid="true"/);
});
