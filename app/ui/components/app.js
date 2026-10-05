// The whole window in the old interface's layout: top bar, sidebar, the
// current page, the status bar and the popups.
import { useEffect } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { navigate, useRoute } from '../route.js';
import { AllChats } from './all-chats.js';
import { Welcome } from './home.js';
import { MeetingView } from './meeting.js';
import { Overlays } from './overlays.js';
import { Footbar, Topbar } from './shell.js';
import { Sidebar } from './sidebar.js';
import { Workbench } from './workbench.js';

/** Window-wide shortcuts (see 帮助 → 键盘快捷键). */
function useShortcuts() {
  const actions = useActions();
  useEffect(() => {
    const onKey = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'k' && event.shiftKey) navigate({ view: 'all' });
      else if (key === 'k') actions.openPalette();
      else if (key === 'n' && !event.shiftKey) navigate({ view: 'home' });
      else return;
      event.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  const route = useRoute();
  useShortcuts();
  // Re-render everything when the language changes.
  useAppState((state) => state.settings?.appearance?.language);
  const projectId = useAppState((state) => {
    if (route.view === 'workbench' || route.view === 'new') return route.id;
    if (route.view === 'meeting') {
      return state.meetings.find((meeting) => meeting.id === route.id)?.projectId ?? null;
    }
    return null;
  });
  const projectName = useAppState(
    (state) => state.projects.find((project) => project.id === projectId)?.name,
  );

  let page;
  if (route.view === 'meeting') page = html`<${MeetingView} meetingId=${route.id} />`;
  else if (route.view === 'workbench') page = html`<${Workbench} projectId=${route.id} />`;
  else if (route.view === 'all') page = html`<${AllChats} />`;
  else page = html`<${Welcome} projectId=${route.view === 'new' ? route.id : null} />`;

  return html`<${Topbar} projectName=${projectName} projectId=${projectId} />
    <div class="app">
      <${Sidebar} route=${route} currentProjectId=${projectId} />
      ${page}
    </div>
    <${Footbar} />
    <${Overlays} />`;
}
