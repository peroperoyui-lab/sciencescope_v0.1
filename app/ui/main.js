// Entry point: connect to the host, load the current state, then render.
import { render } from 'preact';
import { installWindowResize } from './native-window.js';
import { createActions } from './actions.js';
import { createApi } from './api.js';
import { App } from './components/app.js';
import { AppContext } from './context.js';
import { html } from './html.js';
import { t } from './i18n/index.js';
import { createStore } from './state.js';
import { applyAssistantStartup, installAssistantNavigation } from './assistant-window.js';
import { AssistantWindow } from './components/assistant-panel.js';
import { AssistantOrb } from './components/assistant-orb.js';
import { DeskWindow } from './components/desk.js';
import { Overlays } from './components/overlays.js';
import { MarkSelection } from './components/mark-selection.js';
import { installTooltips } from './floating.js';

const surface = new URLSearchParams(location.search).get('surface');
if (surface === 'assistant-orb') document.documentElement.classList.add('native-orb');
else {
  if (surface === 'assistant') document.documentElement.classList.add('assistant-panel');
  if (surface === 'desk') document.documentElement.classList.add('desk-window');
  installWindowResize();
  installTooltips();
}
const stopNavigation = installAssistantNavigation(surface);
addEventListener('pagehide', stopNavigation, { once: true });

const root = document.getElementById('app');
const store = createStore();
const actions = createActions(createApi(), store);

try {
  if (surface === 'assistant-orb') {
    render(html`<${AssistantOrb} />`, root);
  } else {
    await actions.start();
    const page =
      surface === 'assistant'
        ? html`<${AssistantWindow} /><${Overlays} />`
        : surface === 'desk'
          ? html`<${DeskWindow} /><${Overlays} />`
          : html`<${App} />`;
    render(
      html`<${AppContext.Provider} value=${{ store, actions }}>${page}<${MarkSelection} /><//>`,
      root,
    );
    void actions.attempt(() => applyAssistantStartup(store.get().settings, surface));
  }
} catch (error) {
  root.innerHTML = '';
  const message = document.createElement('div');
  message.className = 'startup-error';
  message.textContent = `${t('无法连接本机服务：')}${error.message}`;
  root.append(message);
}
