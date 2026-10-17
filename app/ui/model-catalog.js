// The model catalog from the host (`GET /api/models`): every provider with its
// models' context window, maximum output and supported thinking levels. Model
// menus read it instead of capacities typed into settings. Until it loads, the
// providers in settings stand in so menus are never empty.
import { useEffect } from 'preact/hooks';
import { useActions, useAppState } from './context.js';

/**
 * Thinking levels a person can choose; a model with only "off" offers none.
 * @param {any} model
 * @returns {string[]}
 */
export const thinkingChoices = (model) =>
  (model?.thinkingLevels?.length ?? 0) > 1 ? model.thinkingLevels : [];

/** @returns {any[]} */
export function useModelCatalog() {
  const actions = useActions();
  const providers = useAppState((state) => state.settings?.providers);
  const catalog = useAppState((state) => state.modelCatalog);
  useEffect(() => {
    if (providers) void actions.loadModels().catch(() => {});
  }, [providers]);
  if (catalog) return catalog.providers;
  return (providers ?? []).map((provider) => ({
    id: provider.id,
    name: provider.name ?? provider.id,
    preset: provider.preset ?? null,
    hasKey: false,
    models: provider.models.map((model) => ({ id: model.id, name: model.name ?? model.id })),
  }));
}
