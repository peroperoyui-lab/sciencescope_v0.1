// The npm manifest owns the release version; the native manifests must agree
// before any dependency staging or compilation begins.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Version-only rehearsals reuse dependencies; every other manifest value and
 * the complete npm configuration remain part of the production cache key.
 * @param {string} manifestText @param {string} lockText @param {string} npmrc
 */
export function productionDependencyFingerprint(manifestText, lockText, npmrc) {
  const manifest = JSON.parse(manifestText);
  const lock = JSON.parse(lockText);
  delete manifest.version;
  delete lock.version;
  if (lock.packages?.['']) delete lock.packages[''].version;
  return createHash('sha256')
    .update(JSON.stringify(manifest))
    .update('\n')
    .update(JSON.stringify(lock))
    .update('\n')
    .update(npmrc)
    .digest('hex');
}

/** @param {string} value */
export function releaseVersion(value) {
  const parsed =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(
      value,
    );
  if (!parsed || parsed[4]?.split('.').some((identifier) => /^0\d+$/u.test(identifier)))
    throw new Error('Expected a semantic version such as 1.0.0-alpha.1');
  return value;
}

/** @param {string[]} args */
export function packageVersionArgument(args) {
  if (!args.length) return null;
  if (args.length === 2 && args[0] === '--version') return releaseVersion(args[1]);
  if (args.length === 1 && args[0].startsWith('--version='))
    return releaseVersion(args[0].slice('--version='.length));
  throw new Error('Usage: npm run package -- [--version 1.0.0-alpha.1]');
}

/** @param {string} root @param {string|null} [requested] */
export async function preparePackageVersion(root, requested = null) {
  const locations = [
    'package.json',
    'package-lock.json',
    'src-tauri/Cargo.toml',
    'src-tauri/tauri.conf.json',
  ];
  const [manifestText, lockText, cargoText, nativeText] = await Promise.all(
    locations.map((file) => readFile(path.join(root, file), 'utf8')),
  );
  const manifest = JSON.parse(manifestText);
  const lock = JSON.parse(lockText);
  const configuration = JSON.parse(nativeText);
  const cargoPackage = /(^\[package\][\s\S]*?)(?=^\[|$(?![\s\S]))/mu.exec(cargoText);
  const cargoVersion = cargoPackage && /^version\s*=\s*"([^"]+)"/mu.exec(cargoPackage[0]);
  if (!cargoVersion) throw new Error('Cargo.toml [package] version is missing');
  if (requested != null) {
    releaseVersion(requested);
    manifest.version = requested;
    lock.version = requested;
    if (lock.packages?.['']) lock.packages[''].version = requested;
    configuration.version = requested;
    const updatedCargo = cargoText.replace(
      cargoPackage[0],
      cargoPackage[0].replace(/^version\s*=\s*"[^"]+"/mu, `version = "${requested}"`),
    );
    const output = [
      JSON.stringify(manifest, null, 2) + '\n',
      JSON.stringify(lock, null, 2) + '\n',
      updatedCargo,
      JSON.stringify(configuration, null, 2) + '\n',
    ];
    for (let i = 0; i < locations.length; i++)
      await writeFile(path.join(root, locations[i]), output[i]);
    return { version: requested, configuration };
  }
  const versions = [manifest.version, cargoVersion[1], configuration.version];
  if (versions.some((version) => version !== manifest.version))
    throw new Error(
      `Version mismatch: package.json=${versions[0]}, Cargo.toml=${versions[1]}, tauri.conf.json=${versions[2]}`,
    );
  releaseVersion(manifest.version);
  return { version: manifest.version, configuration };
}
