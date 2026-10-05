// The whole window: top bar, sidebar, the current view and the status bar.
import { useAppState } from '../context.js';
import { html } from '../html.js';
import { useRoute } from '../route.js';
import { Home } from './home.js';
import { MeetingView } from './meeting.js';
import { Footbar, Topbar } from './shell.js';
import { Sidebar } from './sidebar.js';
import { Workbench } from './workbench.js';

export function App() {
  const route = useRoute();
  // Re-render everything when the language changes.
  useAppState((state) => state.settings?.appearance?.language);
  const projectName = useAppState((state) => {
    const projectId =
      route.view === 'workbench'
        ? route.id
        : route.view === 'meeting'
          ? state.meetings.find((meeting) => meeting.id === route.id)?.projectId
          : null;
    return state.projects.find((project) => project.id === projectId)?.name;
  });

  let view;
  if (route.view === 'meeting') view = html`<${MeetingView} meetingId=${route.id} />`;
  else if (route.view === 'workbench') view = html`<${Workbench} projectId=${route.id} />`;
  else view = html`<${Home} />`;

  return html`<${Topbar} projectName=${projectName} />
    <div class="app">
      <${Sidebar} route=${route} />
      ${view}
    </div>
    <${Footbar} />`;
}
