// The whole window in the old interface's layout: top bar, sidebar, the
// current page, the status bar and the popups.
import { useEffect, useLayoutEffect } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { comboOf } from '../appearance.js';
import { html } from '../html.js';
import { navigate, useRoute } from '../route.js';
import { AllChats } from './all-chats.js';
import { AssistantPanel } from './assistant-panel.js';
import { ResearchBase } from './research-base.js';
import { Welcome } from './home.js';
import { MapEditor } from './map-editor.js';
import { MeetingView } from './meeting.js';
import { MaterialsPanel } from './materials-panel.js';
import { FilePreview } from './file-preview.js';
import { Overlays } from './overlays.js';
import { ProjectNew } from './project-new.js';
import { SettingsView } from './settings.js';
import { Footbar, Topbar } from './shell.js';
import { Sidebar } from './sidebar.js';
import { Workbench } from './workbench.js';
import { WorkbenchPage } from './workbench-pages.js';

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
      newChat: () =>
        projectId ? navigate({ view: 'new', id: projectId }) : actions.newIndependent(),
      independentChat: actions.newIndependent,
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
  const assistantOpen = useAppState((state) => state.assistantOpen);
  const materialsTarget = useAppState((state) => state.materialsTarget);
  // Re-render everything when the language changes.
  useAppState((state) => state.settings?.appearance?.language);
  const projectId = useAppState((state) => {
    if (['workbench', 'new', 'plans', 'journal', 'files', 'map', 'database'].includes(route.view)) {
      return route.id;
    }
    if (route.view === 'meeting') {
      const meetingId = route.id.split('/')[0];
      return state.meetings.find((meeting) => meeting.id === meetingId)?.projectId ?? null;
    }
    return null;
  });
  const actions = useActions();
  // Set before the new view is painted: a goal that completes in the meantime
  // must not be marked as seen in the meeting the person just left.
  useLayoutEffect(() => {
    actions.viewMeeting(route.view === 'meeting' ? route.id.split('/')[0] : null);
  }, [route.view, route.id]);
  useEffect(() => {
    void actions.attempt(() => actions.focusProject(projectId));
  }, [projectId]);
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
  } else if (route.view === 'map')
    page = html`<${MapEditor} key=${route.id} projectId=${route.id} />`;
  else if (route.view === 'workbench') page = html`<${Workbench} projectId=${route.id} />`;
  else if (['database', 'library', 'sources'].includes(route.view))
    page = html`<${ResearchBase}
      key=${route.view + (route.id ?? '')}
      view=${route.view}
      projectId=${route.view === 'database' ? route.id : null}
    />`;
  else if (route.view === 'all') page = html`<${AllChats} />`;
  else if (route.view === 'project-new') page = html`<${ProjectNew} />`;
  else if (route.view === 'plans' || route.view === 'journal' || route.view === 'files') {
    page = html`<${WorkbenchPage} view=${route.view} projectId=${route.id} />`;
  } else if (route.view === 'settings') {
    page = html`<${SettingsView} page=${route.id} projectName=${projectName} />`;
  } else page = html`<${Welcome} projectId=${route.view === 'new' ? route.id : null} />`;

  // The map editor takes the whole window, as in the prototype, while the
  // explicitly opened assistant can remain beside it without remounting it.

  return html`<${Topbar} projectName=${projectName} projectId=${projectId} />
    <div class="app">
      ${route.view !== 'map' && html`<${Sidebar} route=${route} currentProjectId=${projectId} />`}
      ${page} ${materialsTarget && html`<${MaterialsPanel} target=${materialsTarget} />`}
      <${FilePreview} />
      ${assistantOpen && html`<${AssistantPanel} onClose=${() => actions.showAssistant(false)} />`}
    </div>
    <${Footbar}
      meetingId=${route.view === 'meeting' ? route.id.split('/')[0] : null}
      projectId=${projectId}
    />
    <${Overlays} />`;
}
