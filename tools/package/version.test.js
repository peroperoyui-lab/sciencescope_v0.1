import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import {
  packageVersionArgument,
  preparePackageVersion,
  productionDependencyFingerprint,
} from './version.js';
import { versionFixture } from './testing.js';

test('package version mismatch stops staging; an explicit version synchronizes npm and native manifests', () =>
  versionFixture(async (root) => {
    const manifestPaths = [
      'package.json',
      'package-lock.json',
      'src-tauri/Cargo.toml',
      'src-tauri/tauri.conf.json',
    ];
    const manifests = () =>
      Promise.all(manifestPaths.map((file) => readFile(path.join(root, file), 'utf8')));
    const unchanged = await manifests();
    await assert.rejects(preparePackageVersion(root, '1.0.0-01'), /Expected a semantic version/u);
    assert.deepEqual(
      await manifests(),
      unchanged,
      'invalid prerelease leaves every manifest unchanged',
    );
    const fingerprint = async () =>
      productionDependencyFingerprint(
        await readFile(path.join(root, 'package.json'), 'utf8'),
        await readFile(path.join(root, 'package-lock.json'), 'utf8'),
        'registry=https://registry.npmmirror.com\n',
      );
    const before = await fingerprint();
    const nativePath = path.join(root, 'src-tauri/tauri.conf.json');
    const configuration = JSON.parse(await readFile(nativePath, 'utf8'));
    configuration.version = '1.0.0-alpha.9';
    await writeFile(nativePath, JSON.stringify(configuration));
    await assert.rejects(preparePackageVersion(root), /Version mismatch/u);
    const next = packageVersionArgument(['--version', '1.0.0-alpha.2']);
    const result = await preparePackageVersion(root, next);
    assert.equal(result.version, '1.0.0-alpha.2');
    assert.equal((await preparePackageVersion(root)).version, result.version);
    assert.equal(result.configuration.plugins.updater.pubkey, 'public-fixture');
    assert.equal(result.configuration.bundle.createUpdaterArtifacts, true);
    const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
    assert.equal(lock.version, result.version);
    assert.equal(lock.packages[''].version, result.version);
    assert.equal(lock.packages['node_modules/keep'].version, '2.0.0');
    assert.equal(await fingerprint(), before, 'version-only builds reuse production dependencies');
    lock.packages['node_modules/keep'].version = '3.0.0';
    await writeFile(path.join(root, 'package-lock.json'), JSON.stringify(lock));
    assert.notEqual(
      await fingerprint(),
      before,
      'dependency changes invalidate the production cache',
    );
    assert.match(
      await readFile(path.join(root, 'src-tauri/Cargo.toml'), 'utf8'),
      /fixture = \{ version = "2" \}/u,
    );
  }));
