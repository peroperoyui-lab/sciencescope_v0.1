import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';

/** @param {(root:string)=>Promise<void>} work */
export async function versionFixture(work) {
  const parent = path.resolve('.sciencescope-local/temp/r6b/version');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'case-'));
  try {
    await mkdir(path.join(root, 'src-tauri'));
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '1.0.0-alpha.0' }),
    );
    await writeFile(
      path.join(root, 'package-lock.json'),
      JSON.stringify({
        version: '1.0.0-alpha.0',
        packages: { '': { version: '1.0.0-alpha.0' }, 'node_modules/keep': { version: '2.0.0' } },
      }),
    );
    await writeFile(
      path.join(root, 'src-tauri/Cargo.toml'),
      '[package]\nname = "fixture"\nversion = "1.0.0-alpha.0"\n\n[dependencies]\nfixture = { version = "2" }\n',
    );
    await writeFile(
      path.join(root, 'src-tauri/tauri.conf.json'),
      JSON.stringify({
        version: '1.0.0-alpha.0',
        plugins: { updater: { pubkey: 'public-fixture' } },
        bundle: { createUpdaterArtifacts: true },
      }),
    );
    await work(root);
  } finally {
    assert.equal(path.dirname(root), parent);
    await rm(root, { recursive: true, force: true });
  }
}
