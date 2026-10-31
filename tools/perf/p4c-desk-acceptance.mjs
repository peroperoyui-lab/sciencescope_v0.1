import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, open, readFile } from 'node:fs/promises';
import { launchNative, until } from './native-host.mjs';
import { observePage } from './native-profile.mjs';
import { collectUsage } from './usage.mjs';

// UI acceptance helpers only. Call from an ignored scenario driver after the
// final installation/credential GO. No product state is seeded through APIs.
export async function withDeskAcceptance(options, run) {
  const install = path.resolve(options.install);
  const data = path.resolve(options.data);
  const out = path.resolve(options.out);
  const allowed = path.resolve('.sciencescope-local/temp/p4c/part7');
  assert.equal(data, path.join(install, 'data'));
  assert.ok(out.startsWith(allowed + path.sep));
  assert.notEqual(install, path.resolve('.sciencescope-local/install/ScienceScope Install Test'));
  assert.equal(process.version, 'v22.22.2');
  await mkdir(out, { recursive: true });
  const receipt = await open(path.join(out, 'acceptance.json'), 'wx');
  const report = {
    schema: 1,
    node: process.version,
    startedAt: new Date().toISOString(),
    method:
      'Installed native product, actual UI actions; API/database checks are supporting evidence only.',
    scenarios: [],
    screenshots: [],
    network: [],
    pageErrors: [],
  };
  let native,
    phase = 'setup';
  const sessions = new Map();
  const secrets = [];
  const redact = (value) => {
    let text = String(value).replace(/https?:\/\/[^\s"'<>]+/gu, '(URL omitted)');
    for (const secret of secrets) if (secret) text = text.replaceAll(secret, '(secret omitted)');
    return text;
  };
  const save = () => receipt.writeFile(JSON.stringify(report, null, 2));
  const metrics = (page) =>
    page.evaluate(async () => ({
      devicePixelRatio,
      innerWidth,
      innerHeight,
      outerWidth,
      outerHeight,
      visualScale: visualViewport?.scale,
      visualWidth: visualViewport?.width,
      visualHeight: visualViewport?.height,
      nativeScaleFactor: await window.__TAURI__?.window?.getCurrentWindow().scaleFactor(),
    }));
  async function screenshotNative(page, name) {
    assert.match(name, /^[a-z0-9-]+$/u);
    const actual = await metrics(page);
    assert.equal(
      actual.nativeScaleFactor,
      1.25,
      'Formal screenshot requires actual native scale 1.25',
    );
    assert.equal(actual.visualScale, 1, 'Formal screenshot requires unmodified visual viewport');
    const file = name + '-native-125.png';
    await page.screenshot({ path: path.join(out, file) });
    report.screenshots.push({
      file,
      method: 'Actual Windows native scale 125%; no zoom emulation',
      metrics: actual,
    });
    report.scale100 = { status: 'pending-user-decision', captured: false };
  }

  try {
    native = await launchNative({
      install,
      data,
      port: options.port ?? 9399,
      onPage: async (page) => {
        page.setDefaultTimeout(30000);
        page.on('pageerror', (error) =>
          report.pageErrors.push({ scenario: phase, message: redact(error.message) }),
        );
        sessions.set(page, await observePage(page, report.network, [], () => phase));
      },
    });
    await native.main.getByRole('textbox', { name: '主输入框', exact: true }).waitFor();
    const context = {
      native,
      main: native.main,
      data,
      out,
      report,
      screenshotNative,
      // Compatibility alias for existing local scenario drivers.
      screenshotPair: screenshotNative,
      async readApi(page, route) {
        assert.ok(route.startsWith('/api/'));
        return page.evaluate(async (route) => {
          const token =
            window.__SCIENCESCOPE_API_TOKEN__ || sessionStorage.getItem('sciencescope.token');
          const response = await fetch(route, { headers: { authorization: 'Bearer ' + token } });
          if (!response.ok) throw new Error(`Supporting GET failed (${response.status}).`);
          return response.json();
        }, route);
      },
      async readAuthorizedKey(file) {
        assert.ok(
          options.credentialsAuthorized,
          'Credential setup requires explicit root authorization.',
        );
        const value = (await readFile(file, 'utf8')).trim();
        assert.ok(value.length > 10);
        secrets.push(value);
        return value;
      },
      async step(number, name, action) {
        phase = String(number);
        const row = { number, name, startMs: Date.now(), status: 'running' };
        report.scenarios.push(row);
        try {
          row.detail = await action();
          row.status = 'passed';
        } catch (error) {
          row.status = 'blocked';
          row.error = redact(error.message);
          for (const [index, page] of [...sessions.keys()]
            .filter((page) => !page.isClosed())
            .entries())
            await page
              .screenshot({ path: path.join(out, `scenario-${number}-failure-${index}.png`) })
              .catch(() => {});
        } finally {
          row.endMs = Date.now();
        }
        return row;
      },
      async deskPage() {
        return until(() =>
          native.browser
            .contexts()
            .flatMap((context) => context.pages())
            .find((page) => {
              try {
                return new URL(page.url()).searchParams.get('surface') === 'desk';
              } catch {
                return false;
              }
            }),
        );
      },
    };
    await run(context);
  } catch (error) {
    report.error = redact(error.message);
  } finally {
    report.actionsFinishedAt = new Date().toISOString();
    // Closing is part of acceptance and flushes model logs, including background requests.
    if (native)
      report.shutdown = await native.close().catch((error) => ({ error: redact(error.message) }));
    const endMs = Date.now();
    report.usage = await collectUsage(data, { startMs: Date.parse(report.startedAt), endMs }).catch(
      (error) => ({ error: redact(error.message) }),
    );
    report.finishedAt = new Date().toISOString();
    await save();
    await receipt.close();
  }
  return report;
}
