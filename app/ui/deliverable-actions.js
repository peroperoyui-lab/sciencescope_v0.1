/** Presented files share the host token and open with the default application. */
export function createDeliverableActions(api) {
  return {
    deliverableContent: (id) =>
      `/api/deliverables/${encodeURIComponent(id)}/content?token=${encodeURIComponent(api.token)}`,
    openDeliverable: (id) => api.post(`/api/deliverables/${encodeURIComponent(id)}/open`),
  };
}
