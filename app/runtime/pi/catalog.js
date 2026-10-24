// SDK model and authentication details stay behind the runtime boundary.
// Presets retain the SDK's per-model protocols and compatibility flags.
import {
  createModels,
  createProvider,
  getSupportedThinkingLevels,
} from '@earendil-works/pi-ai/models';
import { getBuiltinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all';
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { readCredentials, saveKey, resolveProviderHeaders } from '../../services/providers.js';
import { AppError } from '../../core/errors.js';

const presets = new Map([
  ['opencode-go', opencodeGoProvider()],
  ['deepseek', deepseekProvider()],
]);
const apis = {
  'openai-completions': openAICompletionsApi,
  'openai-responses': openAIResponsesApi,
  'anthropic-messages': anthropicMessagesApi,
};
let matchingModels;

function matchedModel(id) {
  matchingModels ??= getBuiltinProviders().flatMap((provider) => getBuiltinModels(provider));
  return matchingModels.find((model) => model.id === id);
}

/**
 * Ignore historical hand-entered capacities; the catalog owns these values.
 * @param {any} provider
 * @param {string} id
 */
export function describeModel(provider, id) {
  const builtin =
    provider.preset &&
    presets
      .get(provider.preset)
      ?.getModels()
      .find((model) => model.id === id);
  const matched = builtin ?? matchedModel(id);
  const configured = provider.models?.find((model) => model.id === id);
  return {
    id,
    name: builtin?.name ?? configured?.name ?? matched?.name ?? id,
    contextWindow: matched?.contextWindow ?? 131_072,
    maxTokens: matched?.maxTokens ?? 32_768,
    limitsSource: builtin ? 'catalog' : matched ? 'matched' : 'default',
    reasoning: matched?.reasoning ?? false,
    thinkingLevels: matched ? getSupportedThinkingLevels(matched) : ['off'],
    input: matched?.input ?? ['text'],
  };
}

/**
 * Read key references for every request. The Models authContext below disables
 * ambient credentials, including the built-in providers' environment fallback.
 * @param {any} paths
 * @param {() => Promise<any[]>} providers
 * @returns {import('@earendil-works/pi-ai').CredentialStore}
 */
export function createCredentialStore(paths, providers) {
  let writes = Promise.resolve();
  const reference = async (id) =>
    (await providers()).find((provider) => provider.id === id)?.keyRef;
  const store = {
    async read(id) {
      const ref = await reference(id);
      const key = ref && (await readCredentials(paths)).refs?.[ref];
      return key ? { type: /** @type {const} */ ('api_key'), key } : undefined;
    },
    async list() {
      const entries = await Promise.all(
        (await providers()).map(async ({ id }) =>
          (await store.read(id))
            ? { providerId: id, type: /** @type {const} */ ('api_key') }
            : null,
        ),
      );
      return entries.filter(Boolean);
    },
    async modify(id, update) {
      const result = writes.then(async () => {
        const current = await store.read(id);
        const next = await update(current);
        if (next?.type === 'api_key') await saveKey(paths, await reference(id), next.key ?? '');
        return next ?? current;
      });
      writes = result.then(
        () => {},
        () => {},
      );
      return result;
    },
    async delete(id) {
      await store.modify(id, async () => ({ type: 'api_key', key: '' }));
    },
  };
  return store;
}

function configuredProvider(entry) {
  if (entry.preset) {
    const provider = presets.get(entry.preset);
    if (!provider) throw new AppError('PRESET_NOT_FOUND', '没有这个服务商预设。', 404);
    return provider;
  }
  const factory = apis[entry.api];
  if (!factory) throw new AppError('PROVIDER_API', '这个服务商的接口类型不受支持。');
  return createProvider({
    id: entry.id,
    name: entry.name,
    baseUrl: entry.baseUrl,
    headers: entry.headers,
    auth: {
      apiKey: {
        name: 'ScienceScope credentials',
        async resolve({ credential }) {
          return credential?.key ? { auth: { apiKey: credential.key } } : undefined;
        },
      },
    },
    api: factory(),
    models: (entry.models ?? []).map(({ id }) => {
      const match = matchedModel(id);
      return {
        ...match,
        ...describeModel(entry, id),
        provider: entry.id,
        api: entry.api,
        baseUrl: entry.baseUrl,
        cost: match?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        ...(match?.api !== entry.api ? { compat: undefined } : {}),
      };
    }),
  });
}

/**
 * @param {{paths:any, providers:()=>Promise<any[]>}} dependencies
 */
export function createModelCatalog({ paths, providers }) {
  const credentials = createCredentialStore(paths, providers);
  const models = createModels({
    credentials,
    authContext: { env: async () => undefined, fileExists: async () => false },
  });

  async function resolve(choice) {
    const entry = (await providers()).find((provider) => provider.id === choice.provider);
    if (!entry) throw new AppError('PROVIDER_REQUIRED', '请先在设置中添加这个服务商。');
    const resolved = { ...entry, headers: await resolveProviderHeaders(paths, entry) };
    models.setProvider(configuredProvider(resolved));
    const model = models.getModel(entry.id, choice.model);
    if (!model)
      throw new AppError('MODEL_NOT_FOUND', '找不到这个模型，请在设置中检查模型 ID。', 404);
    return {
      model,
      entry: resolved,
      models,
      descriptor: describeModel(entry, choice.model),
      resolveHeaders: () => resolveProviderHeaders(paths, entry),
    };
  }

  return {
    resolve,
    credentials,
    presets: () =>
      [...presets.values()].map((provider) => ({
        id: provider.id,
        name: provider.name,
        keyHint: provider.id === 'deepseek' ? 'DeepSeek API key' : 'OpenCode Go API key',
        modelCount: provider.getModels().length,
      })),
    preset(id) {
      const provider = presets.get(id);
      if (!provider) throw new AppError('PRESET_NOT_FOUND', '没有这个服务商预设。', 404);
      return {
        id,
        name: provider.name,
        preset: id,
        keyRef: id,
        models: provider.getModels().map(({ id: modelId, name }) => ({ id: modelId, name })),
      };
    },
    async descriptor(choice) {
      const provider = (await providers()).find((entry) => entry.id === choice.provider);
      return describeModel(provider ?? { models: [] }, choice.model);
    },
    async list() {
      return {
        providers: await Promise.all(
          (await providers()).map(async (provider) => ({
            id: provider.id,
            name: provider.name ?? provider.id,
            preset: provider.preset ?? null,
            hasKey: Boolean(await credentials.read(provider.id)),
            models: (provider.preset
              ? (presets.get(provider.preset)?.getModels() ?? [])
              : (provider.models ?? [])
            ).map(({ id }) => describeModel(provider, id)),
          })),
        ),
      };
    },
  };
}
