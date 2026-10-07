// Memory decisions and reversible edits use the public memory service.
/**
 * @param {import('./api.js').Api} api
 * @returns {{memoryInbox:(projectId:string|null)=>Promise<any>,memoryBrief:(projectId:string|null)=>Promise<any>,
 * updateMemory:(id:string,patch:any)=>Promise<any>,decideMemories:(ids:string[],status:string)=>Promise<any>,
 * memoryHistory:(id:string)=>Promise<any[]>,projectMemoryHistory:(projectId:string)=>Promise<any[]>,
 * memoryStatus:(meetingId:string)=>Promise<any>,runMemory:(meetingId:string)=>Promise<any>}}
 */
export function createMemoryActions(api) {
  const query = (projectId) => new URLSearchParams({ projectId: projectId ?? '' });
  return {
    memoryInbox: (projectId) => api.get(`/api/memory/inbox?${query(projectId)}`),
    memoryBrief: (projectId) => api.get(`/api/memory/brief?${query(projectId)}`),
    updateMemory: (id, patch) => api.patch(`/api/memory/items/${id}`, patch),
    decideMemories: (ids, status) => api.post('/api/memory/decisions', { ids, status }),
    memoryHistory: (id) => api.get(`/api/memory/items/${id}/history`),
    projectMemoryHistory: (projectId) => api.get(`/api/memory/history?${query(projectId)}`),
    memoryStatus: (meetingId) => api.get(`/api/meetings/${meetingId}/memory/status`),
    runMemory: (meetingId) => api.post(`/api/meetings/${meetingId}/memory`),
  };
}
