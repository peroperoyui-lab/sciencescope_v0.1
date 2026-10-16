// Provider choices live in settings.json; capacities come from the runtime's
// shared model catalog. API keys live only in secret/credentials.yaml and are
// referenced by name, never put in environment variables or the database.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { AppError } from '../core/errors.js';

/**
 * @typedef {{ id: string, name?: string, baseUrl: string,
 *   preset?: 'opencode-go' | 'deepseek',
 *   api: 'openai-completions' | 'openai-responses' | 'anthropic-messages',
 *   keyRef: string, headers?: Record<string, string>,
 *   models: Array<{ id: string, name?: string, contextWindow?: number, maxTokens?: number }> }} Provider
 */

/** @param {ReturnType<typeof import('../core/paths.js').dataPaths>} paths */
export function credentialsFile(paths) {
  return path.join(paths.secret, 'credentials.yaml');
}

/**
 * Credentials are internal to host services and the runtime, never a response.
 * @param {ReturnType<typeof import('../core/paths.js').dataPaths>} paths
 */
export async function readCredentials(paths) {
  try {
    return YAML.parse(await readFile(credentialsFile(paths), 'utf8')) ?? { version: 1, refs: {} };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { version: 1, refs: {} };
  }
}

/**
 * Names of the stored keys (never the keys themselves).
 * @param {ReturnType<typeof import('../core/paths.js').dataPaths>} paths
 */
export async function keyRefs(paths) {
  return Object.keys((await readCredentials(paths)).refs ?? {});
}

/**
 * Ask a provider which models it offers (`GET <baseUrl>/models`). Uses the
 * given key, or the stored key under `keyRef`.
 * @param {ReturnType<typeof import('../core/paths.js').dataPaths>} paths
 * @param {{ baseUrl: string, api: string, keyRef?: string, key?: string,
 *   headers?: Record<string, string> }} provider
 * @returns {Promise<string[]>}
 */
export async function discoverModels(paths, { baseUrl, api, keyRef, key, headers = {} }) {
  const secret = key || (keyRef ? (await readCredentials(paths)).refs?.[keyRef] : '') || '';
  const auth =
    api === 'anthropic-messages'
      ? { 'x-api-key': secret, 'anthropic-version': '2023-06-01' }
      : secret
        ? { authorization: `Bearer ${secret}` }
        : {};
  const response = await fetch(`${String(baseUrl).replace(/\/+$/, '')}/models`, {
    headers: { ...headers, ...auth },
  });
  if (!response.ok) {
    throw new AppError(
      'DISCOVERY_FAILED',
      `服务没有返回模型列表（HTTP ${response.status}）。可以手动填写模型 ID。`,
      502,
    );
  }
  const body = await response.json();
  return (body.data ?? body.models ?? []).map((model) => String(model.id ?? model.name)).sort();
}

/**
 * Store an API key under a reference name.
 * @param {ReturnType<typeof import('../core/paths.js').dataPaths>} paths
 * @param {string} keyRef
 * @param {string} key
 */
export async function saveKey(paths, keyRef, key) {
  const file = credentialsFile(paths);
  const document = await readCredentials(paths);
  document.refs = { ...document.refs, [keyRef]: key };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, YAML.stringify(document), { encoding: 'utf8', mode: 0o600 });
}

/**
 * Public provider operations use plain catalog descriptors, not provider SDKs.
 * @param {{core:import('../core/index.js').Core,catalog:any,runtime:import('../runtime/port.js').Runtime}} dependencies
 */
export function createProviderService({ core, catalog, runtime }) {
  return {
    presets: catalog.presets,
    models: catalog.list,
    async savePreset(id, key) {
      const entry = catalog.preset(id);
      await saveKey(core.paths, entry.keyRef, key);
      const settings = (await core.workspace.read({ resource: 'settings', key: 'app' })).value;
      const providers = settings.providers.filter((provider) => provider.id !== id);
      providers.push(entry);
      await core.workspace.edit(
        { resource: 'settings', key: 'app', op: 'patch', args: { changes: { providers } } },
        { actorId: 'person_user' },
      );
      return entry;
    },
    async test(id, modelId) {
      const settings = (await core.workspace.read({ resource: 'settings', key: 'app' })).value;
      const provider = settings.providers.find((entry) => entry.id === id);
      if (!provider) throw new AppError('PROVIDER_NOT_FOUND', '请先添加这个服务商。', 404);
      const model = modelId ?? provider.models?.[0]?.id;
      const started = performance.now();
      let session;
      try {
        session = await runtime.startSession({
          model: { provider: id, model },
          workFolder: core.paths.root,
          instructions: 'Reply with OK only.',
          tools: [],
          noTools: true,
          onToolCall: async () => null,
        });
        const result = await runtime.send(session, 'OK?', () => {});
        if (result.stopReason === 'completed')
          return { ok: true, model, latencyMs: performance.now() - started };
        return {
          ok: false,
          error: {
            status: Number(result.error?.match(/HTTP (\d+)/)?.[1]) || null,
            message: result.error ?? '模型没有返回回答，请重试。',
          },
        };
      } catch (error) {
        return { ok: false, error: { status: error.status ?? null, message: error.message } };
      } finally {
        if (session) await runtime.release(session);
      }
    },
  };
}
