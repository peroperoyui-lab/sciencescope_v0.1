/**
 * Research requests share the host API and remain independent of page rendering.
 * @param {import('./api.js').Api} api
 * @param {ReturnType<typeof import('./message-extras.js').createMessageExtras>} [extras]
 */
export function createResearchActions(api, extras) {
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
    knowledgeEntities: (options) => api.get(`/api/knowledge/entities?${query(options)}`),
    knowledgeEntity: (id) => api.get(`/api/knowledge/entities/${id}?edgesLimit=200`),
    knowledgeEdges: (ref) => api.get(`/api/knowledge/edges?${query({ ref, limit: 200 })}`),
    knowledgeEdge: (id) => api.get(`/api/knowledge/edges/${encodeURIComponent(id)}`),
    knowledgeEdgesOf: (ref, options) =>
      api.get(`/api/knowledge/edges?${query({ ref, ...options })}`),
    knowledgeHistory: (ref, offset = 0) =>
      api.get(`/api/knowledge/history?${query({ ref, limit: 20, offset })}`),
    restoreKnowledgeRevision: (id) => api.post(`/api/knowledge/revisions/${id}/restore`),
    restoreKnowledgeVersion: (id) => api.post(`/api/knowledge/versions/${id}/restore`),
    knowledgeVersions: (options) => api.get(`/api/knowledge/versions?${query(options)}`),
    knowledgeVersion: (id) => api.get(`/api/knowledge/versions/${id}`),
    /**
     * The knowledge change an answer made, from its page's batch the first time:
     * `{ value }` with the closed version's detail plus `lastId` and `withdrawn`
     * (value null: none), or null when the caller reads it itself.
     * @param {string} messageId
     */
    batchedKnowledge: async (messageId) => (await extras?.take(messageId, 'knowledge')) ?? null,
    knowledgeLabels: (ref, change, sessionId) =>
      api.post('/api/knowledge/labels', { ref, ...change, sessionId }),
    /**
     * Several edits as one history version, so one 撤销 withdraws them together.
     * @param {string | null} projectId @param {(sessionId: string) => Promise<any>} work
     */
    async knowledgeSession(projectId, work) {
      const { id } = await api.post('/api/knowledge/session', { projectId });
      try {
        const result = await work(id);
        return { result, version: await api.post(`/api/knowledge/session/${id}/close`) };
      } catch (error) {
        await api.post(`/api/knowledge/session/${id}/close`);
        throw error;
      }
    },
    createKnowledgeEntity: (body) => api.post('/api/knowledge/entities', body),
    updateKnowledgeEntity: (id, body) => api.patch(`/api/knowledge/entities/${id}`, body),
    removeKnowledgeEntity: (id, sessionId) =>
      api.request('DELETE', `/api/knowledge/entities/${id}`, { sessionId }),
    removeKnowledgeEdge: (id, sessionId) =>
      api.request('DELETE', `/api/knowledge/edges/${id}`, { sessionId }),
    knowledgeMembership: (body) => api.post('/api/knowledge/memberships', body),
    createKnowledgeEdge: (body) => api.post('/api/knowledge/edges', body),
    knowledgeMergePreview: (into, from) =>
      api.get(`/api/knowledge/entities/merge-preview?${query({ into, from: from.join(',') })}`),
    mergeKnowledgeEntities: (body) => api.post('/api/knowledge/entities/merge', body),
    knowledgeGraph: (options) => api.get(`/api/knowledge/graph?${query(options)}`),
    knowledgeLayout: (projectId) =>
      api.get(`/api/knowledge/layout?${query({ projectId: projectId ?? undefined })}`),
    knowledgeViewport: (refs, projectId) =>
      api.post('/api/knowledge/viewport', { refs, ...(projectId ? { projectId } : {}) }),
    saveKnowledgePositions: (positions) => api.patch('/api/knowledge/positions', { positions }),
    rerunKnowledgeLayout: (projectId) => api.post('/api/knowledge/layout/rerun', { projectId }),
    openKnowledgeSession: (projectId) => api.post('/api/knowledge/session', { projectId }),
    knowledgeSessionStep: (id, step) => api.post(`/api/knowledge/session/${id}/${step}`),
    semanticStatus: () => api.get('/api/research/semantic/status'),
    semanticDownload: () => api.post('/api/research/semantic/download'),
    semanticRebuild: () => api.post('/api/research/semantic/rebuild'),
  };
}
