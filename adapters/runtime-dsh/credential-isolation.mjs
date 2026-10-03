import { chmod, lstat, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';
import { credentialRef, parseCredentialKey } from '@deepseek-ai/dsh-credentials';
import { filterProviderSecretEnv } from './session-env.mjs';

const require = createRequire(import.meta.url);
const { parseDocument } = createRequire(require.resolve('@deepseek-ai/dsh-credentials-local'))('yaml');
const runFile = promisify(execFile);

function failure(code) {
  const error = new Error(`Credential isolation failed (${code}); original credential files were retained.`);
  error.code = code;
  return error;
}

export function getProtectedCredentialPaths({ home, credentialPath } = {}) {
  if (!home) throw new TypeError('Credential isolation requires home');
  return [path.resolve(credentialPath ?? path.join(home, '.sciencescope-local', 'secret', 'credentials.yaml')), path.resolve(home, '.credentials.yaml')];
}

/** Owner-only inheritable directory ACL protects future upstream atomic replacements. */
export async function protectCredentialPath(filename, { directory = false, platform = process.platform } = {}) {
  if (platform !== 'win32') { await chmod(filename, directory ? 0o700 : 0o600); return; }
  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$target = $env:SCIENCESCOPE_ACL_TARGET
$owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = Get-Acl -LiteralPath $target
if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $owner.Value) { throw 'Credential location is owned by another user' }
$acl.SetAccessRuleProtection($true, $false)
foreach ($existingRule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($existingRule) }
$inherit = if ($env:SCIENCESCOPE_ACL_DIRECTORY -eq '1') { [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [System.Security.AccessControl.InheritanceFlags]::None }
$rule = [System.Security.AccessControl.FileSystemAccessRule]::new($owner, [System.Security.AccessControl.FileSystemRights]::FullControl, $inherit, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
$acl.AddAccessRule($rule)
if ($env:SCIENCESCOPE_ACL_DIRECTORY -eq '1') { [System.IO.Directory]::SetAccessControl($target, $acl) } else { [System.IO.File]::SetAccessControl($target, $acl) }
`;
  const aclEnv = { ...process.env, SCIENCESCOPE_ACL_TARGET: filename, SCIENCESCOPE_ACL_DIRECTORY: directory ? '1' : '0' };
  // A caller running pwsh may export its PSModulePath; Windows PowerShell must
  // discover its own built-in Security module rather than the incompatible copy.
  for (const key of Object.keys(aclEnv)) if (key.toLowerCase() === 'psmodulepath') delete aclEnv[key];
  try {
    await runFile(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true, env: aclEnv,
    });
  } catch { throw failure('CREDENTIAL_PERMISSION_FAILED'); }
}

async function optionalText(filename) {
  try {
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink()) throw failure('CREDENTIAL_UNSAFE_FILE');
    return await readFile(filename, 'utf8');
  } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

function validate(text) {
  const document = parseDocument(text, { uniqueKeys: true, prettyErrors: false });
  if (document.errors.length) throw failure('CREDENTIAL_INVALID_DOCUMENT');
  let value;
  try { value = document.toJS({ maxAliasCount: 100 }); } catch { throw failure('CREDENTIAL_INVALID_DOCUMENT'); }
  if (value == null) value = {};
  if (typeof value !== 'object' || Array.isArray(value)) throw failure('CREDENTIAL_INVALID_DOCUMENT');
  try {
    if (Object.keys(value).length && !Object.hasOwn(value, 'version')) {
      for (const [ref, secret] of Object.entries(value)) { credentialRef(ref); if (typeof secret !== 'string' || !secret) throw failure('CREDENTIAL_INVALID_DOCUMENT'); }
      value = { version: 1, refs: value };
      document.contents = document.createNode(value);
    }
    if (Object.keys(value).length && value.version !== 1) throw failure('CREDENTIAL_INVALID_DOCUMENT');
    if (Object.keys(value).some(key => !['version', 'refs', 'records'].includes(key))) throw failure('CREDENTIAL_INVALID_DOCUMENT');
    for (const section of ['refs', 'records']) if (value[section] != null && (typeof value[section] !== 'object' || Array.isArray(value[section]))) throw failure('CREDENTIAL_INVALID_DOCUMENT');
    for (const [ref, secret] of Object.entries(value.refs ?? {})) { credentialRef(ref); if (typeof secret !== 'string' || !secret) throw failure('CREDENTIAL_INVALID_DOCUMENT'); }
    for (const [ref, record] of Object.entries(value.records ?? {})) {
      parseCredentialKey(ref);
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw failure('CREDENTIAL_INVALID_DOCUMENT');
      const fields = record.kind === 'api-key' ? ['kind', 'key', 'env'] : record.kind === 'grant' ? ['kind', 'payload'] : [];
      if (!fields.length || Object.keys(record).some(key => !fields.includes(key))) throw failure('CREDENTIAL_INVALID_DOCUMENT');
      if (record.kind === 'api-key') {
        if (record.key !== undefined && (typeof record.key !== 'string' || !record.key)) throw failure('CREDENTIAL_INVALID_DOCUMENT');
        if (record.env !== undefined && (!record.env || typeof record.env !== 'object' || Array.isArray(record.env))) throw failure('CREDENTIAL_INVALID_DOCUMENT');
        for (const [name, secret] of Object.entries(record.env ?? {})) { credentialRef(name); if (typeof secret !== 'string' || !secret) throw failure('CREDENTIAL_INVALID_DOCUMENT'); }
      } else if (!Object.hasOwn(record, 'payload') || !isDeepStrictEqual(record.payload, JSON.parse(JSON.stringify(record.payload)))) throw failure('CREDENTIAL_INVALID_DOCUMENT');
    }
  } catch { throw failure('CREDENTIAL_INVALID_DOCUMENT'); }
  return { document, value };
}

/** Idempotent startup migration; conflicting stores remain intact for explicit recovery. */
export async function prepareCredentialIsolation(options = {}) {
  const [filename, legacyPath] = getProtectedCredentialPaths(options);
  if (filename === legacyPath) throw failure('CREDENTIAL_PATH_NOT_ISOLATED');
  const directory = path.dirname(filename);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw failure('CREDENTIAL_UNSAFE_DIRECTORY');
  await protectCredentialPath(directory, { directory: true });
  await withFileLock(filename, async () => {
    const legacyText = await optionalText(legacyPath);
    const currentText = await optionalText(filename);
    if (currentText !== undefined) await protectCredentialPath(filename);
    const current = currentText === undefined ? null : validate(currentText);
    const legacy = legacyText === undefined ? null : validate(legacyText);
    if (!legacy) return;
    const target = current ?? legacy;
    target.document.set('version', 1);
    if (current) {
      for (const section of ['refs', 'records']) for (const [ref, secret] of Object.entries(legacy.value[section] ?? {})) {
        if (Object.hasOwn(current.value[section] ?? {}, ref)) {
          if (!isDeepStrictEqual(current.value[section][ref], secret)) throw failure('CREDENTIAL_MIGRATION_CONFLICT');
        } else target.document.setIn([section, ref], secret);
      }
    }
    const merged = target.document.toString();
    validate(merged);
    await writeFileAtomic(filename, merged, { mode: 0o600, dirMode: 0o700 });
    await protectCredentialPath(filename);
    if (await optionalText(filename) !== merged || await optionalText(legacyPath) !== legacyText) throw failure('CREDENTIAL_MIGRATION_CHANGED');
    await rm(legacyPath);
  }, { waitMs: 30_000 });
  return filename;
}

export async function registeredProviderKeyEnv(home, runtimeConfig = {}) {
  const references = new Set();
  const scan = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'apiKeyEnv' && typeof item === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(item)) references.add(item);
      else if (item && typeof item === 'object') scan(item);
    }
  };
  scan(runtimeConfig);
  const text = await optionalText(path.join(home, 'settings.yaml'));
  if (text !== undefined) {
    const document = parseDocument(text, { prettyErrors: false });
    if (document.errors.length) throw failure('PROVIDER_SETTINGS_INVALID');
    scan(document.toJS());
  }
  return [...references];
}

/** Boot already captured launchEnvironment; remove .env secrets from shell inheritance only. */
export const name = 'sciencescope-credential-env-hygiene';
export function apply(_ctx, config = {}) {
  const providerKeyEnv = new Set(config.providerKeyEnv ?? []);
  const collect = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'apiKeyEnv' && typeof item === 'string') providerKeyEnv.add(item);
      else if (item && typeof item === 'object') collect(item);
    }
  };
  const sanitize = () => {
    const sanitized = filterProviderSecretEnv(process.env, { providerKeyEnv: [...providerKeyEnv], allowedProviderKeyEnv: ['SCIENCESCOPE_STREAM_TOKEN'] });
    for (const key of Object.keys(process.env)) if (!Object.hasOwn(sanitized, key)) delete process.env[key];
  };
  sanitize();
  _ctx.on('settings/updated', (_namespace, settings) => { collect(settings); sanitize(); });
  // Provider additions and model switches may introduce an arbitrary reference
  // after startup; every shell execution observes the latest sanitized environment.
  _ctx.on('tools/execute', (_exec, next) => { sanitize(); return next(); });
}
