import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

test('approved HTML inline JavaScript remains syntactically valid', async () => {
  const html = await readFile(new URL('../ScienceScope.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0);
  for (const [index, match] of scripts.entries()) {
    new Script(match[1], { filename: `ScienceScope-inline-${index}.js` });
  }
});

test('desktop shell embeds generated assets with scoped local window controls and secondary-window command', async () => {
  const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  assert.equal(config.build.frontendDist, '../.sciencescope-local/desktop-dist');
  assert.equal(config.build.devUrl, undefined);
  assert.deepEqual(config.app.security.capabilities, ['main-window-controls']);
  const capability = JSON.parse(await readFile(new URL('../src-tauri/capabilities/main.json', import.meta.url), 'utf8'));
  assert.deepEqual(capability.permissions, ['allow-open-secondary-window','allow-set-assistant-mode','allow-get-assistant-mode','allow-show-assistant-menu','allow-hide-assistant','core:event:allow-listen','core:event:allow-unlisten','core:window:allow-minimize','core:window:allow-start-dragging','core:window:allow-toggle-maximize','core:window:allow-close','core:window:allow-is-visible']);
  assert.deepEqual(capability.windows,['main','secondary-*']);
  assert.equal(config.app.windows[0].decorations,false);
  assert.match(config.app.windows[0].title, /开发版/);
  assert.equal(config.bundle.active, false);
});
