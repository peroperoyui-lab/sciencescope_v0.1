// Small window features that went missing across redesigns and came back:
// the unsent draft follows its chat, 全部对话 rows have the chat menu and a
// pinned mark, F2 renames, Alt+S and the header button open the project
// summary (a click outside closes it), find is only offered on a chat page,
// and inside the native window 窗口置顶 and the browser-key guards work.
import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

test(
  'window features: drafts per chat, 全部对话 menu, F2, Alt+S, find, 窗口置顶 and guards',
  { skip: browserSkip },
  () =>
    withBrowserApp(
      'window-features',
      async function* () {},
      async ({ page, app, shot }) => {
        const { core } = app;
        const project = await core.projects.create({ name: '城市韧性研究' });
        const members = [{ participantId: 'person_user' }, { participantId: 'agent_main' }];
        const policy = { mode: 'direct', respondent: 'agent_main', approval: 'auto' };
        const first = core.meetings.create({
          projectId: project.id,
          title: '访谈提纲',
          members,
          policy,
        });
        const second = core.meetings.create({
          projectId: project.id,
          title: '问卷题项对照',
          members,
          policy,
        });
        // A stand-in for the Tauri window API, present before the page loads.
        await page.addInitScript(() => {
          const calls = [];
          /** @type {any} */ (window).windowCalls = calls;
          /** @type {any} */ (window).__TAURI__ = {
            window: {
              getCurrentWindow: () => ({
                minimize: async () => {},
                toggleMaximize: async () => {},
                close: async () => {},
                setAlwaysOnTop: async (value) => calls.push(['setAlwaysOnTop', value]),
                startResizeDragging: async () => {},
                isMaximized: async () => false,
                isFullscreen: async () => false,
                setFullscreen: async () => {},
                onResized: async () => () => {},
              }),
            },
          };
        });
        // No fade-in, so screenshots show finished menus.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.reload();
        await page.locator('.ss-titlebar').waitFor();

        // The unsent draft stays with its chat.
        await page.goto(page.url().replace(/#.*$/, '') + `#/meeting/${first.id}`);
        const input = page.locator('[data-composer="main"] textarea');
        await input.fill('还没发出去的问题');
        await page.locator('.ss-tree-row', { hasText: '问卷题项对照' }).click();
        await page.locator('.ss-header__title', { hasText: '问卷题项对照' }).waitFor();
        assert.equal(await input.inputValue(), '');
        await page.locator('.ss-tree-row', { hasText: '访谈提纲' }).click();
        await page.locator('.ss-header__title', { hasText: '访谈提纲' }).waitFor();
        assert.equal(await input.inputValue(), '还没发出去的问题');

        // Alt+S and the header button toggle the summary; a click outside closes it.
        await page.locator('.ss-header__title').click();
        await page.keyboard.press('Alt+S');
        await page.locator('.project-flyout').waitFor();
        await page.locator('.ss-header__title').click();
        await page.locator('.project-flyout').waitFor({ state: 'detached' });
        const summaryButton = page.locator('.ss-header button[aria-label="项目置顶摘要"]');
        await summaryButton.click();
        await page.locator('.project-flyout').waitFor();
        await shot('summary-button');
        await summaryButton.click();
        await page.locator('.project-flyout').waitFor({ state: 'detached' });

        // F2 renames the open chat.
        await page.locator('.ss-header__title').click();
        await page.keyboard.press('F2');
        const name = page.locator('.ss-dialog input').first();
        await name.fill('访谈提纲（第二版）');
        await name.press('Enter');
        await page.locator('.ss-header__title', { hasText: '访谈提纲（第二版）' }).waitFor();

        // Find is only offered where there is a find bar.
        await page.locator('.ss-titlebar__menu', { hasText: '编辑' }).click();
        assert.equal(
          await page.locator('[role="menuitem"]', { hasText: '查找当前对话' }).isDisabled(),
          false,
        );
        await page.keyboard.press('Escape');

        // 全部对话: the row menu pins a chat, and the row shows it.
        await page.goto(page.url().replace(/#.*$/, '') + '#/all');
        const row = page.locator('.ss-all-chats .ss-list-row', { hasText: '问卷题项对照' });
        await row.click({ button: 'right' });
        await page.locator('[role="menuitem"]', { hasText: '置顶' }).click();
        await row.locator('.ss-chat-row__pin').waitFor();
        assert.equal(core.meetings.get(second.id).pinned, true);
        await row.hover();
        await row.locator('button[aria-label="对话菜单"]').click();
        await page.locator('[role="menuitem"]', { hasText: '取消置顶' }).waitFor();
        await shot('all-chats-menu');
        await page.keyboard.press('Escape');
        await page.locator('.ss-titlebar__menu', { hasText: '编辑' }).click();
        assert.equal(
          await page.locator('[role="menuitem"]', { hasText: '查找当前对话' }).isDisabled(),
          true,
        );
        await page.keyboard.press('Escape');

        // 窗口置顶 is a setting applied to the native window.
        const pin = page.locator('.ss-winctl--pin');
        assert.equal(await pin.getAttribute('aria-pressed'), 'false');
        await pin.click();
        await page.locator('.ss-winctl--pin[aria-pressed="true"]').waitFor();
        await page.waitForFunction(() =>
          /** @type {any} */ (window).windowCalls.some(
            ([call, value]) => call === 'setAlwaysOnTop' && value === true,
          ),
        );
        const stored = await core.workspace.read({ resource: 'settings', key: 'app' });
        assert.equal(stored.value.appearance.alwaysOnTop, true);
        await shot('window-pin');

        // Browser keys and the browser's own context menu are held back.
        const prevented = await page.evaluate(() => {
          const press = (init) => {
            const event = new KeyboardEvent('keydown', {
              ...init,
              bubbles: true,
              cancelable: true,
            });
            document.body.dispatchEvent(event);
            return event.defaultPrevented;
          };
          const menu = (target) => {
            const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
            target.dispatchEvent(event);
            return event.defaultPrevented;
          };
          const field = document.createElement('textarea');
          document.body.append(field);
          const result = {
            f5: press({ key: 'F5' }),
            reload: press({ key: 'r', ctrlKey: true }),
            back: press({ key: 'ArrowLeft', altKey: true }),
            typing: press({ key: 'r' }),
            copy: press({ key: 'c', ctrlKey: true }),
            pageMenu: menu(document.body),
            fieldMenu: menu(field),
          };
          field.remove();
          return result;
        });
        assert.deepEqual(prevented, {
          f5: true,
          reload: true,
          back: true,
          typing: false,
          copy: false,
          pageMenu: true,
          fieldMenu: false,
        });
      },
    ),
);
