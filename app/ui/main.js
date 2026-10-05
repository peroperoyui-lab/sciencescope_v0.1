// Entry point: connect to the host, load the current state, then render.
import { render } from 'preact';
import { createActions } from './actions.js';
import { createApi } from './api.js';
import { App } from './components/app.js';
import { AppContext } from './context.js';
import { html } from './html.js';
import { t } from './i18n/index.js';
import { createStore } from './state.js';

const root = document.getElementById('app');
const store = createStore();
const actions = createActions(createApi(), store);

try {
  await actions.start();
  render(html`<${AppContext.Provider} value=${{ store, actions }}><${App} /><//>`, root);
} catch (error) {
  root.innerHTML = '';
  const message = document.createElement('div');
  message.className = 'startup-error';
  message.textContent = `${t('无法连接本机服务：')}${error.message}`;
  root.append(message);
}
