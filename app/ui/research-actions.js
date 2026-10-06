/** Research requests share the host API and remain independent of page rendering. @param {import('./api.js').Api} api */
export function createResearchActions(api) {
  const query = (values) =>
    new URLSearchParams(
      Object.entries(values)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value ?? '')]),
    );
  return {
    researchSources: (options) =>
      api.get(
        `/api/research/sources?${query({ ...options, page: Math.floor((options.offset ?? 0) / 50) + 1 })}`,
      ),
    researchItems: (options) =>
      api.get(
        `/api/research/items?${query({ ...options, ...(options.pinned ? { pinned: options.pinned === 'true' ? '1' : '0' } : {}) })}`,
      ),
    researchSearch: (text, options) =>
      api.get(`/api/research/search?${query({ ...options, q: text })}`),
    researchSource: (id, options = {}) => api.get(`/api/research/sources/${id}?${query(options)}`),
    researchItem: (id) => api.get(`/api/research/items/${id}`),
    importResearchSource: (body) => api.post('/api/research/sources', body),
    updateResearchSource: (id, body) => api.patch(`/api/research/sources/${id}`, body),
    reparseResearchSource: (id) => api.post(`/api/research/sources/${id}/reparse`),
    openResearchSource: (id) => api.post(`/api/research/sources/${id}/open`),
    createResearchItem: (body) => api.post('/api/research/items', body),
    updateResearchItem: (id, body) => api.patch(`/api/research/items/${id}`, body),
    semanticStatus: () => api.get('/api/research/semantic/status'),
    semanticDownload: () => api.post('/api/research/semantic/download'),
    semanticRebuild: () => api.post('/api/research/semantic/rebuild'),
  };
}
