// Model providers. Their settings (name, address, protocol, models and their
// capacity) live in settings.json; API keys live only in
// secret/credentials.yaml and are referenced by name. The runtime receives the
// provider list and the credentials file path; keys never enter environment
// variables or the database.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

/**
 * @typedef {{ id: string, name?: string, baseUrl: string,
 *   api: 'openai-completions' | 'openai-responses' | 'anthropic-messages',
 *   keyRef: string,
 *   models: Array<{ id: string, name?: string, contextWindow?: number, maxTokens?: number }> }} Provider
 */

/** @param {ReturnType<typeof import('../core/paths.js').dataPaths>} paths */
export function credentialsFile(paths) {
  return path.join(paths.secret, 'credentials.yaml');
}

/**
 * Store an API key under a reference name.
 * @param {ReturnType<typeof import('../core/paths.js').dataPaths>} paths
 * @param {string} keyRef
 * @param {string} key
 */
export async function saveKey(paths, keyRef, key) {
  const file = credentialsFile(paths);
  let document = { version: 1, refs: {} };
  try {
    document = YAML.parse(await readFile(file, 'utf8')) ?? document;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
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
