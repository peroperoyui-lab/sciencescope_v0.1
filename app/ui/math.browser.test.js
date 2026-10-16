import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

test(
  'meeting answers render inline and display formulas while code, currency and raw HTML stay literal',
  { skip: browserSkip },
  () =>
    withBrowserApp(
      'r411-math',
      async function* () {
        yield '**公式** $x^2 + y^2$\n\n$$\nE=mc^2\n$$\n\n金额 $5 and $10。 \x60$x$\x60\n\n\x60\x60\x60text\n$$code$$\n\x60\x60\x60\n\n<span style="position:fixed" onclick="alert(1)">原文</span>';
      },
      async ({ page, app, shot }) => {
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { models: { default: { provider: 'scripted', model: 'scripted' } } } },
        });
        const meeting = app.core.meetings.create({
          members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
          policy: { mode: 'direct', respondent: 'agent_main' },
        });
        await page.goto(new URL('/?token=ui-token#/meeting/' + meeting.id, page.url()).href);
        await page.getByRole('textbox', { name: '主输入框' }).fill('展示公式');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        const answer = page.locator('.ss-msg:not([data-user])').last();
        await answer.locator('.katex-display').waitFor();
        assert.equal(await answer.locator('.katex').count(), 2);
        assert.match(await answer.locator('.message-text').innerText(), /金额 \$5 and \$10/);
        assert.equal(await answer.locator('code').first().innerText(), '$x$');
        assert.match(await answer.locator('pre code').innerText(), /\$\$code\$\$/);
        assert.equal(await answer.locator('[onclick]').count(), 0);
        assert.equal(await answer.locator('span[style="position:fixed"]').count(), 0);
        await shot('r4-11b-math');
      },
    ),
);
