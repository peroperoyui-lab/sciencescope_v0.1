// The whole window in the old interface's layout: top bar, sidebar, the
// current page, the status bar and the popups.
import { useEffect } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { comboOf } from '../appearance.js';
import { html } from '../html.js';
import { navigate, useRoute } from '../route.js';
import { AllChats } from './all-chats.js';
import { Welcome } from './home.js';
import { MeetingView } from './meeting.js';
import { Overlays } from './overlays.js';
import { SettingsView } from './settings.js';
import { Footbar, Topbar } from './shell.js';
import { Sidebar } from './sidebar.js';
import { Workbench } from './workbench.js';

/**
 * Window shortcuts from Settings → 快捷键. Fields that are recording a
 * shortcut (`data-shortcut-input`) receive the keys themselves.
 * @param {string | null} projectId
 */
function useShortcuts(projectId) {
  const actions = useActions();
  const shortcuts = useAppState((state) => state.settings?.shortcuts);
  useEffect(() => {
    const commands = {
      search: () => actions.openPalette(),
      browse: () => navigate({ view: 'all' }),
      newChat: () => navigate(projectId ? { view: 'new', id: projectId } : { view: 'home' }),
      independentChat: () => navigate({ view: 'home' }),
    };
    const onKey = (event) => {
      if (event.target?.closest?.('[data-shortcut-input]')) return;
      const combo = comboOf(event);
      const name = Object.keys(commands).find((key) => shortcuts?.[key] === combo);
      if (!name) return;
      event.preventDefault();
      commands[name]();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [shortcuts, projectId]);
}

export function App() {
  const route = useRoute();
  // Re-render everything when the language changes.
  useAppState((state) => state.settings?.appearance?.language);
  const projectId = useAppState((state) => {
    if (route.view === 'workbench' || route.view === 'new') return route.id;
    if (route.view === 'meeting') {
      const meetingId = route.id.split('/')[0];
      return state.meetings.find((meeting) => meeting.id === meetingId)?.projectId ?? null;
    }
    return null;
  });
  useShortcuts(projectId);
  const projectName = useAppState(
    (state) => state.projects.find((project) => project.id === projectId)?.name,
  );

  let page;
  if (route.view === 'meeting') {
    // `#/meeting/<id>/<messageId>` links to one message.
    const [meetingId, messageId] = route.id.split('/');
    page = html`<${MeetingView}
      key=${meetingId}
      meetingId=${meetingId}
      focusMessageId=${messageId}
    />`;
  } else if (route.view === 'workbench') page = html`<${Workbench} projectId=${route.id} />`;
  else if (route.view === 'all') page = html`<${AllChats} />`;
  else if (route.view === 'settings') {
    page = html`<${SettingsView} page=${route.id} projectName=${projectName} />`;
  } else page = html`<${Welcome} projectId=${route.view === 'new' ? route.id : null} />`;

  return html`<${Topbar} projectName=${projectName} projectId=${projectId} />
    <div class="app">
      <${Sidebar} route=${route} currentProjectId=${projectId} />
      ${page}
    </div>
    <${Footbar} />
    <${Overlays} />`;
}
