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
  await saveKeys(paths, { [keyRef]: key });
}

const credentialWrites = new Map();

/**
 * Serialize read/merge/write across provider and MCP configuration changes.
 * @param {ReturnType<typeof import('../core/paths.js').dataPaths>} paths
 * @param {Record<string, string>} refs
 */
export async function saveKeys(paths, refs) {
  if (!Object.keys(refs).length) return;
  const file = credentialsFile(paths);
  const operation = (credentialWrites.get(file) ?? Promise.resolve()).then(async () => {
    const document = await readCredentials(paths);
    document.refs = { ...document.refs, ...refs };
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, YAML.stringify(document), { encoding: 'utf8', mode: 0o600 });
  });
  const settled = operation.catch(() => {});
  credentialWrites.set(file, settled);
  try {
    await operation;
  } finally {
    if (credentialWrites.get(file) === settled) credentialWrites.delete(file);
  }
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
    /**
     * Replace a hand-configured provider with the built-in preset for the same
     * service (an OpenCode Go entry from before P1a): its key moves to the
     * preset, and every model choice that named it follows when the preset has
     * that model, otherwise falls back to the inherited default.
     * @param {string} id @param {string} presetId
     */
    async adoptPreset(id, presetId) {
      const entry = catalog.preset(presetId);
      const settings = (await core.workspace.read({ resource: 'settings', key: 'app' })).value;
      const old = settings.providers.find((provider) => provider.id === id);
      if (!old) throw new AppError('PROVIDER_NOT_FOUND', '找不到这个服务商。', 404);
      const key = (await readCredentials(core.paths)).refs?.[old.keyRef];
      if (key) await saveKey(core.paths, entry.keyRef, key);
      const follow = (choice) =>
        choice?.provider !== id
          ? choice
          : entry.models.some((model) => model.id === choice.model)
            ? { ...choice, provider: presetId }
            : null;
      const actor = { actorId: 'person_user' };
      await core.workspace.edit(
        {
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: {
            changes: {
              providers: [
                ...settings.providers.filter(
                  (provider) => provider.id !== id && provider.id !== presetId,
                ),
                entry,
              ],
              models: { default: follow(settings.models.default) },
              memory: { model: follow(settings.memory?.model) },
            },
          },
        },
        actor,
      );
      for (const participant of core.participants.list()) {
        if (participant.kind !== 'ai') continue;
        const { definition } = await core.participants.get(participant.id);
        if (definition.model?.provider === id)
          await core.participants.updateDefinition(
            participant.id,
            { model: follow(definition.model) },
            actor,
          );
      }
      for (const meeting of core.meetings.list({ includeArchived: true }))
        if (meeting.policy.model?.provider === id)
          core.meetings.update(
            meeting.id,
            { policy: { model: follow(meeting.policy.model) } },
            actor,
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
