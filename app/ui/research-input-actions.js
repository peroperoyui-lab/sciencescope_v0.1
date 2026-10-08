/**
 * @param {import('./api.js').Api} api
 * @param {import('./state.js').Store} store
 */
export function createResearchInputActions(api, store) {
  const route = (owner) => `/api/research-input/${encodeURIComponent(owner)}`;
  function remember(owner, value) {
    store.update((state) =>
      (state.researchDrafts[owner]?.version ?? -1) > value.version
        ? state
        : {
            ...state,
            researchDrafts: { ...state.researchDrafts, [owner]: value },
          },
    );
    return value;
  }
  async function changeInput(owner, operation) {
    return remember(owner, await api.patch(route(owner), operation));
  }
  return {
    loadInput: async (owner) => remember(owner, await api.get(route(owner))),
    changeInput,
    async attachInput(owner, projectId, files) {
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 16384)
          binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
        const source = await api.post('/api/research/sources', {
          name: file.name,
          base64: btoa(binary),
          projectId,
        });
        await changeInput(owner, { op: 'add', material: { type: 'source', id: source.id } });
      }
    },
    showMaterials: (target) => store.update((state) => ({ ...state, materialsTarget: target })),
  };
}
