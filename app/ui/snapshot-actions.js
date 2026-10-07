// History versions are separate from the fine-grained internal revisions.
/**
 * @param {import('./api.js').Api} api
 * @param {import('./state.js').Store} store
 * @param {()=>Promise<void>} waitForEdits
 */
export function createSnapshotActions(api, store, waitForEdits) {
  const refresh = () =>
    store.update((state) => ({ ...state, snapshotsVersion: state.snapshotsVersion + 1 }));
  return {
    /** @param {{projectId?:string,resource?:string,key?:string,meetingId?:string,limit?:number}} query */
    snapshots(query) {
      const params = new URLSearchParams(
        Object.entries(query)
          .filter(([, value]) => value != null)
          .map(([key, value]) => [key, String(value)]),
      );
      const list = api.get(`/api/snapshots?${params}`);
      if (!query.projectId || (query.resource && query.resource !== 'plans')) return list;
      const globalParams = new URLSearchParams({ resource: 'plans', key: 'global' });
      if (query.limit) globalParams.set('limit', String(query.limit));
      return Promise.all([list, api.get(`/api/snapshots?${globalParams}`)]).then((lists) =>
        lists
          .flat()
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, query.limit ?? Infinity),
      );
    },
    /** @param {string} id */
    readSnapshot: (id) => api.get(`/api/snapshots/${id}`),
    /** @param {string} resource @param {string} key */
    async captureSnapshot(resource, key) {
      await waitForEdits();
      const result = await api.post('/api/snapshots', { resource, key, source: 'leave-page' });
      if (result) refresh();
      return result;
    },
    /** @param {string} id */
    async restoreSnapshot(id) {
      const result = await api.post(`/api/snapshots/${id}/restore`);
      refresh();
      store.update((state) => ({
        ...state,
        workspaceVersion: state.workspaceVersion + 1,
        minutesVersion: state.minutesVersion + 1,
      }));
      return result;
    },
    /** @param {string} id */
    async deleteSnapshot(id) {
      const result = await api.request('DELETE', `/api/snapshots/${id}`);
      refresh();
      return result;
    },
  };
}
