// Editing desk sessions (EDITING_DESK.md §3, §8): a project file is registered
// as a version group once, then edited through one session per group.
/**
 * @param {import('./api.js').Api} api
 */
export function createDeskActions(api) {
  const session = (id) => `/api/desk/sessions/${encodeURIComponent(id)}`;
  return {
    /** @param {{projectId:string,path:string}} input */
    registerDeskDocument: (input) => api.post('/api/desk/documents', input),
    /** @param {{groupId:string,versionId?:string,meetingId?:string}} input */
    openDeskSession: (input) => api.post('/api/desk/sessions', input),
    /** @param {string} id */
    deskSession: (id) => api.get(session(id)),
    /** @param {string} id @param {any} body */
    patchDeskBlocks: (id, body) => api.patch(`${session(id)}/blocks`, body),
    /** @param {string} id @param {{baseSeq:number,text:string}} body */
    putDeskText: (id, body) => api.put(`${session(id)}/text`, body),
    /** @param {string} id @param {{to:'project'|'version',confirm?:boolean,label?:string}} body */
    saveDesk: (id, body) => api.post(`${session(id)}/save`, body),
    /** @param {string} id */
    closeDesk: (id) => api.post(`${session(id)}/close`),
    /** Ask the bound chat's expert to rewrite a selection. @param {string} id @param {{blockId:string,quote:any,instruction:string}} body */
    rewriteDesk: (id, body) => api.post(`${session(id)}/rewrite`, body),
    /** Bind open sessions to the project's latest chat (or a new one). @param {{projectId:string,mode:'continue'|'branch',meetingId?:string}} body */
    enterDesk: (body) => api.post('/api/desk/enter', body),
    /** Withdraw one recorded change. @param {string} changeId */
    undoDeskChange: (changeId) =>
      api.post(`/api/desk/changes/${encodeURIComponent(changeId)}/undo`),
    /** Comments and indexes of a session, in text order. @param {string} id */
    deskAnnotations: (id) => api.get(`${session(id)}/annotations`),
    /** @param {string} id @param {any} body {type, blockId, from, to, ...} */
    addDeskAnnotation: (id, body) => api.post(`${session(id)}/annotations`, body),
    /** @param {string} id @param {any} body */
    updateDeskAnnotation: (id, body) =>
      api.patch(`/api/desk/annotations/${encodeURIComponent(id)}`, body),
    /** @param {string} id */
    removeDeskAnnotation: (id) =>
      api.request('DELETE', `/api/desk/annotations/${encodeURIComponent(id)}`),
    /** Where a cited sentence is now in the open working text. @param {any} reference */
    deskFocus: (reference) => api.post('/api/desk/focus', { reference }),
    /**
     * Compile the session's saved TeX project. The main file is found from the
     * open file unless `root` names it. @param {string} id @param {{root?:string}} [body]
     */
    compileDesk: (id, body = {}) => api.post(`${session(id)}/compile`, body),
    /** The last PDF compiled for a session. @param {string} id */
    deskPdf: (id) => api.bytes(`${session(id)}/pdf`),
    /** A picture inside a docx, as a local object URL. @param {string} id @param {string|number} ref */
    async deskMedia(id, ref) {
      const bytes = await api.bytes(`${session(id)}/media/${encodeURIComponent(String(ref))}`);
      return URL.createObjectURL(new Blob([bytes]));
    },
  };
}
