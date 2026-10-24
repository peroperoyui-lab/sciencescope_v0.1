import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { generateRelease, releaseNotes } from './release.js';
import { versionFixture } from './testing.js';

test('release material contains the signed Windows artifact and implementation entries since the previous release', () =>
  versionFixture(async (root) => {
    const previous = '# 实施记录\n\n## 2026-10-23 Earlier release\n\n- Earlier changes.\n';
    const entry = '## 2026-10-24 Update support\n\n- Signed updater and installer checks.\n';
    const current = '# 实施记录\n\n' + entry + '\n' + previous.split('\n\n').slice(1).join('\n\n');
    assert.equal(releaseNotes(current, previous), entry.trim());
    await mkdir(path.join(root, 'docs/log'), { recursive: true });
    await writeFile(path.join(root, 'docs/log/IMPLEMENTATION_LOG.md'), current);
    const artifact = path.join(root, 'ScienceScope Install Test.exe');
    const signature = artifact + '.sig';
    await writeFile(artifact, 'synthetic installer bytes');
    await writeFile(signature, 'public-updater-signature\n');
    const output = path.join(root, 'dist');
    await generateRelease({ root, artifact, output, date: '2026-10-24T08:00:00Z' });
    const latest = JSON.parse(await readFile(path.join(output, 'latest.json'), 'utf8'));
    assert.equal(latest.version, '1.0.0-alpha.0');
    assert.equal(latest.pub_date, '2026-10-24T08:00:00.000Z');
    assert.equal(latest.platforms['windows-x86_64'].signature, 'public-updater-signature');
    assert.equal(
      latest.platforms['windows-x86_64'].url,
      'https://github.com/peroperoyui-lab/sciencescope_v0.1/releases/download/v1.0.0-alpha.0/ScienceScope%20Install%20Test.exe',
    );
    assert.match(latest.notes, /Signed updater/u);
    assert.match(
      await readFile(path.join(output, '发布说明.md'), 'utf8'),
      /尚未上传或创建 Release/u,
    );
  }));
