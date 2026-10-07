/**
 * Secretary conversations use the same meeting actions as Main. This small
 * set only manages the parent attachment, cursor, proposals and local drafts.
 * @param {import('./api.js').Api} api
 * @param {import('./state.js').Store} store
 * @returns {{secretarySnapshot:(id:string,ensure?:boolean)=>Promise<any>,
 * resolveSecretaryProposal:(id:string,changes:any)=>Promise<any>,secretaryProposalHistory:(id:string)=>Promise<any[]>,
 * undoSecretaryProposal:(id:string)=>Promise<any>,secretaryDraft:(id:string,text:string,expected?:string)=>void,
 * fillMainDraft:(id:string,text:string)=>void,consumeMainDraft:(at:number)=>void}}
 */
export function createSecretaryActions(api, store) {
  const record = (mainMeetingId, snapshot) =>
    store.update((state) => ({
      ...state,
      secretary: { ...state.secretary, [mainMeetingId]: snapshot },
    }));
  return {
    /**
     * @param {string} mainMeetingId
     * @param {boolean} [ensure]
     * @returns {Promise<any>}
     */
    async secretarySnapshot(mainMeetingId, ensure = false) {
      const route = `/api/meetings/${mainMeetingId}/secretary`;
      const snapshot = ensure ? await api.post(route) : await api.get(route);
      record(mainMeetingId, snapshot);
      return snapshot;
    },
    /**
     * @param {string} id
     * @returns {Promise<any[]>}
     */
    secretaryProposalHistory: (id) => api.get(`/api/secretary/proposals/${id}/history`),
    /**
     * @param {string} id
     * @returns {Promise<any>}
     */
    undoSecretaryProposal: (id) => api.post(`/api/secretary/proposal-revisions/${id}/undo`),
    /**
     * @param {string} id
     * @param {{ status: 'filled' | 'dismissed', text: string }} changes
     * @returns {Promise<any>}
     */
    resolveSecretaryProposal: (id, changes) => api.patch(`/api/secretary/proposals/${id}`, changes),
    /**
     * @param {string} meetingId
     * @param {string} text
     * @param {string} [expected]
     * @returns {void}
     */
    secretaryDraft(meetingId, text, expected) {
      store.update((state) =>
        expected !== undefined && state.secretaryDrafts[meetingId] !== expected
          ? state
          : { ...state, secretaryDrafts: { ...state.secretaryDrafts, [meetingId]: text } },
      );
    },
    /**
     * A proposal replaces the input only after the user's explicit fill action.
     * @param {string} meetingId
     * @param {string} text
     * @returns {void}
     */
    fillMainDraft(meetingId, text) {
      store.update((state) => ({
        ...state,
        fillDraft: { meetingId, text, at: Date.now() },
      }));
    },
    /**
     * @param {number} at
     * @returns {void}
     */
    consumeMainDraft(at) {
      store.update((state) => (state.fillDraft?.at === at ? { ...state, fillDraft: null } : state));
    },
  };
}
