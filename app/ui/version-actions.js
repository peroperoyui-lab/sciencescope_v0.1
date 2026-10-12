/**
 * @param {import('./api.js').Api} api
 */
export function createVersionActions(api) {
  return {
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
    deleteVersion: (id) => api.request('DELETE', `/api/versions/${id}`),
    openVersion: (id, reveal = false) => api.post(`/api/versions/${id}/open`, { reveal }),
  };
}
