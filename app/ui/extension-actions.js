// Tools, skills and MCP servers for the settings pages (X1, X2 routes).

/** @param {import('./api.js').Api} api */
export function createExtensionActions(api) {
  const skill = (name) => `/api/skills/${encodeURIComponent(name)}`;
  return {
    listTools: () => api.get('/api/tools'),
    listSkills: () => api.get('/api/skills'),
    readSkill: (name) => api.get(skill(name)),
    /** @param {{ path?: string, dataBase64?: string }} input A folder or ZIP path, or ZIP bytes. */
    importSkill: (input) => api.post('/api/skills/import', input),
    copySkill: (name) => api.post(`${skill(name)}/copy`),
    deleteSkill: (name) => api.request('DELETE', skill(name)),
    openSkillFolder: (name) => api.post(`${skill(name)}/open`),
    listMcpServers: () => api.get('/api/mcp/servers'),
    /** A new server without `id`; a change to an existing one with it. */
    saveMcpServer: (server, id) =>
      id ? api.patch(`/api/mcp/servers/${id}`, server) : api.post('/api/mcp/servers', server),
    importMcpConfig: (config) => api.post('/api/mcp/import', { config }),
    deleteMcpServer: (id) => api.request('DELETE', `/api/mcp/servers/${id}`),
    reconnectMcpServer: (id) => api.post(`/api/mcp/servers/${id}/reconnect`),
  };
}
