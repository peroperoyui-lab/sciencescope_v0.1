import { html } from './html.js';
import { t } from './i18n/index.js';
import { navigate } from './route.js';
import { ChatDetails } from './components/python-choice.js';

/**
 * @param {import('./api.js').Api} api
 * @param {import('./state.js').Store} store
 */
export function createPythonActions(api, store) {
  return {
    pythonList: () => api.get('/api/python'),
    pythonSystem: () => api.get('/api/python/system'),
    pythonOperate: (input) => api.post('/api/python', input),
    pythonPackages: (id, action, packages) =>
      api.post(`/api/python/${id}/packages`, { action, packages }),
    pythonBind: (scope, id, environment) =>
      api.post(`/api/python/binding/${scope}/${id}`, { environment }),
    pythonExport: (id) => api.get(`/api/python/${id}/manifest`),
    pythonImport: (id, text) => api.post(`/api/python/${id}/manifest`, { text }),
    pythonPrune: () => api.post('/api/python/cache/prune', {}),
    /** Whether a download source answers. @param {string} url */
    pythonProbe: (url) => api.post('/api/python/probe', { url }),
    async pythonMenu(meetingId, anchor) {
      const [snapshot, binding] = await Promise.all([
        api.get('/api/python'),
        api.get(`/api/python/binding/meeting/${meetingId}`),
      ]);
      const choices = [
        { id: null, name: t('跟随项目与默认设置') },
        { id: 'builtin-science', name: t('内置 · 科学分析') },
        { id: 'system', name: t('系统 Python') },
        ...snapshot.environments.filter((entry) => entry.id !== 'builtin-science'),
      ];
      const items = choices.map((entry) => ({
        text: entry.name,
        check: entry.id === binding.explicit,
        async run() {
          let feedback;
          try {
            await api.post(`/api/python/binding/meeting/${meetingId}`, { environment: entry.id });
            feedback = t('Python 环境将在下一轮生效。');
          } catch (error) {
            feedback = error.message;
          }
          store.update((state) => ({ ...state, overlay: { ...state.overlay, toast: feedback } }));
        },
      }));
      store.update((state) => ({
        ...state,
        overlay: {
          ...state.overlay,
          menu: { label: t('Python 环境'), x: anchor.left, y: anchor.bottom + 5, items },
        },
      }));
    },
    newIndependent() {
      store.update((state) => ({
        ...state,
        overlay: {
          ...state.overlay,
          modal: { title: t('新建独立对话'), body: html`<${ChatDetails} />` },
        },
      }));
    },
    confirmIndependent(details) {
      store.update((state) => ({
        ...state,
        creationDetails: details,
        overlay: { ...state.overlay, modal: null },
      }));
      navigate({ view: 'home' });
    },
  };
}
