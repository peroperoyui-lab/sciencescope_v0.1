import path from 'node:path';

const SESSION_ENV_KEYS = new Map([
  ['virtual_env', 'VIRTUAL_ENV'],
  ['pythonhome', 'PYTHONHOME'],
  ['pythonpath', 'PYTHONPATH'],
  ['uv_cache_dir', 'UV_CACHE_DIR'],
  ['uv_python_install_dir', 'UV_PYTHON_INSTALL_DIR'],
  ['uv_no_config', 'UV_NO_CONFIG'],
  ['uv_link_mode', 'UV_LINK_MODE'],
  ['uv_index_url', 'UV_INDEX_URL'],
]);

const SECRET_ENV_NAME = /(?:api[_-]?key|(?:^|_)(?:token|secret|password|passwd|credential|credentials|authorization|private_key|access_key|session_key)(?:_|$)|^AWS_(?:SECRET_ACCESS_KEY|SESSION_TOKEN)$)/iu;

/** Credential references are structural: even an arbitrary provider ref such as K is removed. */
export function filterProviderSecretEnv(baseEnv, { providerKeyEnv = [], allowedProviderKeyEnv = [] } = {}) {
  const references = new Set(providerKeyEnv.map(name => name.toLowerCase()));
  const allowed = new Set(allowedProviderKeyEnv.map(name => name.toLowerCase()));
  return Object.fromEntries(Object.entries(baseEnv).filter(([key]) => allowed.has(key.toLowerCase()) || !(references.has(key.toLowerCase()) || SECRET_ENV_NAME.test(key))));
}

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** Validate and canonicalize host-generated session environment overrides. */
export function normalizeSessionEnv(sessionEnv = {}) {
  if (!isPlainRecord(sessionEnv)) throw new TypeError('sessionEnv must be an object');
  const pathPrepend = sessionEnv.pathPrepend ?? [];
  if (!Array.isArray(pathPrepend) || pathPrepend.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new TypeError('sessionEnv.pathPrepend must be an array of non-empty paths');
  }
  const rawEnv = sessionEnv.env ?? {};
  if (!isPlainRecord(rawEnv)) throw new TypeError('sessionEnv.env must be an object');

  const env = {};
  const seen = new Set();
  for (const [name, value] of Object.entries(rawEnv)) {
    const folded = name.toLowerCase();
    if (folded.startsWith('sciencescope_')) throw new TypeError('sessionEnv cannot override SCIENCESCOPE_* host controls');
    if (folded === 'path') throw new TypeError('sessionEnv PATH overrides are not allowed; use pathPrepend');
    const canonical = SESSION_ENV_KEYS.get(folded);
    if (!canonical) throw new TypeError(`sessionEnv variable is not allowed: ${name}`);
    if (seen.has(folded)) throw new TypeError(`sessionEnv variable is duplicated case-insensitively: ${name}`);
    if (typeof value !== 'string') throw new TypeError(`sessionEnv.${canonical} must be a string`);
    seen.add(folded);
    env[canonical] = value;
  }
  return { pathPrepend: [...pathPrepend], env };
}

/** Build a fresh child environment without changing the host's environment. */
export function createSessionProcessEnv(baseEnv, sessionEnv = {}, { platform = process.platform, providerKeyEnv = [], allowedProviderKeyEnv = ['SCIENCESCOPE_STREAM_TOKEN'] } = {}) {
  if (!isPlainRecord(baseEnv)) throw new TypeError('base environment must be an object');
  const normalized = normalizeSessionEnv(sessionEnv);
  const result = filterProviderSecretEnv(baseEnv, { providerKeyEnv, allowedProviderKeyEnv });

  const pathKey = Object.keys(result).find((key) => key === 'PATH')
    ?? Object.keys(result).find((key) => key.toLowerCase() === 'path');
  const basePath = pathKey === undefined ? undefined : result[pathKey];
  for (const key of Object.keys(result)) {
    if (key.toLowerCase() !== 'path') continue;
    delete result[key];
  }

  for (const name of Object.keys(normalized.env)) {
    for (const key of Object.keys(result)) {
      if (key.toLowerCase() === name.toLowerCase()) delete result[key];
    }
  }

  const delimiter = platform === 'win32' ? ';' : ':';
  const isAbsolutePath = platform === 'win32' ? path.win32.isAbsolute : path.isAbsolute;
  const prepended = normalized.pathPrepend.map((entry) => {
    if (entry.includes(delimiter)) throw new TypeError('sessionEnv.pathPrepend entries cannot contain the PATH delimiter');
    if (!isAbsolutePath(entry)) throw new TypeError('sessionEnv.pathPrepend entries must be absolute paths');
    return entry;
  });
  const pathEntries = [...prepended, ...(typeof basePath === 'string' && basePath ? [basePath] : [])];
  if (pathEntries.length) result.PATH = pathEntries.join(delimiter);
  return Object.assign(result, normalized.env);
}

export function sessionEnvSignature(sessionEnv = {}) {
  const normalized = normalizeSessionEnv(sessionEnv);
  const orderedEnv = Object.fromEntries(Object.entries(normalized.env).sort(([left], [right]) => left.localeCompare(right)));
  return JSON.stringify({ pathPrepend: normalized.pathPrepend, env: orderedEnv });
}
