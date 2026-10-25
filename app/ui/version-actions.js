/**
 * @param {import('./api.js').Api} api
 */
export function createVersionActions(api) {
  return {
    openLogFile: (projectId, reference) =>
      api.post(`/api/projects/${projectId}/log-file/open`, { reference }),
    versionGroups: (projectId) =>
      api.get(`/api/versions?projectId=${encodeURIComponent(projectId)}`),
    async importVersions(projectId, files, groupId, groupName) {
      const encoded = await Promise.all(
        files.map(async (file) => {
          const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });
          return { name: file.name, base64 };
        }),
      );
      return api.post('/api/versions/import', { projectId, files: encoded, groupId, groupName });
    },
    renameVersionGroup: (id, name) => api.patch(`/api/version-groups/${id}`, { name }),
    /** Renames a manuscript tier everywhere it is used. @param {string} from @param {string} to */
    renameTier: (from, to) => api.post('/api/version-tiers/rename', { from, to }),
    /** The TeX engines found on this computer; `refresh` looks again. @param {boolean} [refresh] */
    texEngines: (refresh = false) => api.get(`/api/desk/tex/engines${refresh ? '?refresh=1' : ''}`),
    /** @param {{ target: string, includeProjectCopies?: boolean }} input */
    startExport: (input) => api.post('/api/export/all', input),
    /** @param {string} jobId */
    exportStatus: (jobId) => api.get(`/api/export/all/${jobId}`),
    /** @param {string} jobId */
    cancelExport: (jobId) => api.request('DELETE', `/api/export/all/${jobId}`),
    /** @param {string} jobId */
    openExport: (jobId) => api.post(`/api/export/all/${jobId}/open`),
    deleteVersion: (id) => api.request('DELETE', `/api/versions/${id}`),
    openVersion: (id, reveal = false) => api.post(`/api/versions/${id}/open`, { reveal }),
    readVersion: (id) => api.get(`/api/versions/${id}`),
    compareVersions: (id, baselineId) =>
      api.get(`/api/versions/${id}/compare?baseline=${encodeURIComponent(baselineId ?? '')}`),
    /** Block diff of two versions of one group; `baselineId` is the left page. */
    diffVersions: (id, baselineId) =>
      api.get(`/api/versions/${id}/diff?baseline=${encodeURIComponent(baselineId)}`),
    saveVersionAsNew: (id) => api.post(`/api/versions/${id}/save-as-new`),
    editVersionNotes: (id, text, revisionId) =>
      api.patch(`/api/versions/${id}/notes`, { text, revisionId }),
    organizeVersion: (id) => api.post(`/api/versions/${id}/organize`),
    versionBaseline: (id, baselineId) => api.patch(`/api/versions/${id}/baseline`, { baselineId }),
    openVersionNotes: (id) => api.post(`/api/versions/${id}/open-notes`),
    versionPreferences: (projectId) => api.get(`/api/version-preferences/${projectId}`),
    setVersionPreferences: (projectId, autoOrganize) =>
      api.patch(`/api/version-preferences/${projectId}`, { autoOrganize }),
  };
}
