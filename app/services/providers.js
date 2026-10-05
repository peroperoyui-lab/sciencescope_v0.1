// Model providers. Their settings (name, address, protocol, models and their
// capacity) live in settings.json; API keys live only in
// secret/credentials.yaml and are referenced by name. The runtime receives the
// provider list and the credentials file path; keys never enter environment
// variables or the database.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { AppError } from '../core/errors.js';

/**
 * @typedef {{ id: string, name?: string, baseUrl: string,
 *   api: 'openai-completions' | 'openai-responses' | 'anthropic-messages',
 *   keyRef: string, headers?: Record<string, string>,
 *   models: Array<{ id: string, name?: string, contextWindow?: number, maxTokens?: number }> }} Provider
 */

/** @param {ReturnType<typeof import('../core/paths.js').dataPaths>} paths */
export function credentialsFile(paths) {
  return path.join(paths.secret, 'credentials.yaml');
}

async function readCredentials(paths) {
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
 * The runtime's provider configuration (DSH `llm-pi-ai` shape).
 * @param {Provider[]} providers
 */
export function runtimeProviderConfig(providers) {
  const config = {};
  for (const provider of providers ?? []) {
    config[provider.id] = {
      displayName: provider.name ?? provider.id,
      api: provider.api,
      baseURL: provider.baseUrl,
      apiKeyEnv: provider.keyRef,
      ...(provider.headers ? { headers: { ...provider.headers } } : {}),
      models: provider.models.map((model) => ({
        id: model.id,
        ...(model.name ? { name: model.name } : {}),
        ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
        ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
      })),
    };
  }
  return { providers: config };
}
