/**
 * @param {import('./api.js').Api} api
 * @param {import('./state.js').Store} store
 */
export function createPreviewActions(api, store) {
  const query = (target) =>
    new URLSearchParams(
      Object.entries(target)
        .filter(
          ([key, value]) => ['kind', 'id', 'projectId', 'path'].includes(key) && value != null,
        )
        .map(([key, value]) => [key, String(value)]),
    );
  return {
    openPreview(target) {
      store.update((state) => ({ ...state, previewTarget: target, materialsTarget: null }));
    },
    previewDocument: (target) => api.get(`/api/preview/document?${query(target)}`),
    previewContent: (target) =>
      `/api/preview/content?${query(target)}&token=${encodeURIComponent(api.token)}`,
    previewBytes: (target) => api.bytes(`/api/preview/content?${query(target)}`),
    messageCitations: (id) => api.get(`/api/messages/${id}/citations`),
    openPreviewOriginal: (target) =>
      target.kind === 'project'
        ? api.post(`/api/projects/${target.projectId}/files`, { op: 'open', path: target.path })
        : target.kind === 'deliverable'
          ? api.post(`/api/deliverables/${target.id}/open`)
          : api.post(`/api/research/sources/${target.id}/open`),
    highlightPreview(root, text) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let all = '',
        node;
      while ((node = walker.nextNode())) {
        nodes.push({ node, start: all.length });
        all += node.textContent;
      }
      const start = all.indexOf(text);
      if (start < 0) return;
      const first = nodes.find((entry) => entry.start + entry.node.textContent.length > start);
      const last = nodes.find(
        (entry) => entry.start + entry.node.textContent.length >= start + text.length,
      );
      if (!first || !last) return;
      const range = document.createRange();
      range.setStart(first.node, start - first.start);
      range.setEnd(last.node, start + text.length - last.start);
      const browser = /** @type {any} */ (globalThis);
      browser.CSS?.highlights?.set('research-focus', new browser.Highlight(range));
      first.node.parentElement.scrollIntoView({ block: 'center' });
    },
  };
}
