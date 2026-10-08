// Real host/Edge UI coverage. The small Tauri fake records only window commands;
// actual DPI, native dragging and process teardown are accepted separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

test(
  'assistant startup settings persist and detached surfaces route to Main',
  { skip: browserSkip, timeout: 120000 },
  () =>
    withBrowserApp(
      'r4-5c-assistant-window',
      async function* () {},
      async ({ page, app, shot }) => {
        page.setDefaultTimeout(10000);
        assert.equal(
          (await app.core.workspace.read({ resource: 'settings', key: 'app' })).value.assistant
            .startup,
          'closed',
        );
        const settingsUrl = new URL('/?token=ui-token#/settings/assistant-settings', page.url())
          .href;
        await page.goto(settingsUrl);
        const settings = page.locator('[data-assistant-window-settings]');
        await settings.getByLabel('启动客户端时').selectOption('orb');
        await settings.getByRole('button', { name: '保存启动设置', exact: true }).click();
        await settings.getByText('已保存，下次启动客户端生效。', { exact: true }).waitFor();
        assert.equal(
          await settings.getByRole('button', { name: '显示浮球', exact: true }).count(),
          0,
        );
        await page.reload();
        await page.waitForFunction(
          () =>
            /** @type {HTMLSelectElement} */ (document.querySelector('#assistant-startup'))
              ?.value === 'orb',
        );
        await settings.getByLabel('启动客户端时').selectOption('closed');
        await settings.getByRole('button', { name: '保存启动设置', exact: true }).click();
        await settings.getByText('已保存，下次启动客户端生效。', { exact: true }).waitFor();
        await page.context().exposeBinding('nativeEmitTo', async (_, target, name, payload) => {
          assert.equal(target, 'main');
          await page.evaluate(
            ([eventName, value]) => {
              /** @type {any} */ (window).nativeAssistantTest.listeners[eventName]?.({
                payload: value,
              });
            },
            [name, payload],
          );
        });
        await page.context().addInitScript(() => {
          const state = { calls: [], mode: 'orb', listeners: {} };
          const win = {
            isMaximized: async () => false,
            isFullscreen: async () => false,
            onResized: async () => () => {},
            startDragging: async () => state.calls.push(['drag']),
            setFocus: async () => state.calls.push(['focus']),
          };
          Object.defineProperty(window, '__SCIENCESCOPE_API_TOKEN__', { value: 'ui-token' });
          Object.assign(window, {
            nativeAssistantTest: state,
            __TAURI__: {
              core: {
                invoke: async (command, args) => {
                  state.calls.push([command, args]);
                  if (command === 'get_assistant_mode') return state.mode;
                  if (command === 'set_assistant_mode') {
                    state.mode = args.mode;
                    state.listeners['assistant-mode']?.({ payload: state.mode });
                    return state.mode;
                  }
                },
              },
              event: {
                emitTo: async (target, name, payload) => {
                  state.calls.push(['emitTo', { target, name, payload }]);
                  await /** @type {any} */ (window).nativeEmitTo(target, name, payload);
                },
                listen: async (name, callback) => {
                  state.listeners[name] = callback;
                  return () => delete state.listeners[name];
                },
              },
              window: { getCurrentWindow: () => win },
            },
          });
        });
        const calls = async (target = page) =>
          target.evaluate(() => /** @type {any} */ (window).nativeAssistantTest.calls);
        await page.goto(
          new URL('/?token=wrong-url-token#/settings/assistant-settings', page.url()).href,
        );
        await settings.getByLabel('启动客户端时').waitFor();
        assert.equal(
          (await calls()).filter(([command]) => command === 'open_secondary_window').length,
          0,
        );
        for (const startup of ['orb', 'expanded']) {
          await settings.getByLabel('启动客户端时').selectOption(startup);
          await settings.getByRole('button', { name: '保存启动设置', exact: true }).click();
          await settings.getByText('已保存，下次启动客户端生效。', { exact: true }).waitFor();
          await page.reload();
          await page.waitForFunction(() =>
            /** @type {any} */ (window).nativeAssistantTest.calls.some(
              ([command]) => command === 'open_secondary_window',
            ),
          );
          const opens = (await calls()).filter(([command]) => command === 'open_secondary_window');
          assert.equal(opens.length, 1);
          assert.equal(opens[0][1].request.collapsed, startup === 'orb');
        }
        await page
          .locator('.userbar')
          .getByRole('button', { name: '全局助手', exact: true })
          .click();
        assert.equal(await page.locator('.global-assistant-panel').count(), 0);
        const project = await app.core.projects.create({ name: 'Detached assistant project' });
        const child = await page.context().newPage();
        const orb = await page.context().newPage();
        try {
          await child.goto(new URL('/?surface=assistant', page.url()).href);
          await child.getByLabel('全局助手输入').waitFor();
          assert.equal(await child.locator('.topbar,.sidebar,.foot').count(), 0);
          assert.equal(await child.locator('.detached-shell').count(), 1);
          assert.equal(
            (await calls(child)).filter(([command]) => command === 'open_secondary_window').length,
            0,
          );
          await child
            .locator('.assistant-home-links')
            .getByRole('link', { name: 'Detached assistant project', exact: true })
            .click();
          await page.waitForFunction((id) => location.hash === '#/workbench/' + id, project.id);
          assert.ok(
            (await calls(child)).some(
              ([command, args]) =>
                command === 'emitTo' &&
                args.target === 'main' &&
                args.name === 'assistant-navigate' &&
                args.payload.hash === '#/workbench/' + project.id,
            ),
          );
          assert.equal(new URL(child.url()).hash, '');
          await child.getByLabel('全局助手输入').fill('Keep independent draft.');
          await child.getByRole('button', { name: '关闭助手', exact: true }).click();
          assert.equal(
            await child.getByLabel('全局助手输入').inputValue(),
            'Keep independent draft.',
          );
          assert.ok((await calls(child)).some(([command]) => command === 'hide_assistant'));
          await child.getByRole('button', { name: '收起为悬浮球', exact: true }).click();
          assert.ok((await calls(child)).some(([command]) => command === 'set_assistant_mode'));
          let requests = 0;
          orb.on('request', (request) => {
            if (new URL(request.url()).pathname.startsWith('/api/')) requests++;
          });
          await orb.goto(new URL('/?surface=assistant-orb', page.url()).href);
          const button = orb.getByRole('button', { name: '展开或收起全局助手', exact: true });
          await button.waitFor();
          assert.equal(
            await orb.locator('.native-resize-frame,.assistant-surface,.topbar').count(),
            0,
          );
          assert.equal(requests, 0);
          await button.click();
          assert.equal(await button.getAttribute('aria-expanded'), 'true');
          await button.dispatchEvent('pointerdown', {
            button: 0,
            pointerId: 1,
            screenX: 0,
            screenY: 0,
          });
          await button.dispatchEvent('pointermove', { pointerId: 1, screenX: 20, screenY: 0 });
          await button.dispatchEvent('click');
          assert.equal(
            (await calls(orb)).filter(([command]) => command === 'set_assistant_mode').length,
            1,
          );
          await button.dispatchEvent('contextmenu');
          assert.ok((await calls(orb)).some(([command]) => command === 'show_assistant_menu'));
          await page.goto(settingsUrl);
          await page.getByRole('button', { name: '视图', exact: true }).click();
          await page.getByRole('menuitemcheckbox', { name: 'English', exact: true }).click();
          await settings
            .getByRole('button', { name: 'Save startup setting', exact: true })
            .waitFor();
          assert.doesNotMatch(await settings.innerText(), /[一-鿿]/u);
          await shot('r4-5c-assistant-settings-browser-en');
        } finally {
          await child.close();
          await orb.close();
        }
      },
    ),
);
