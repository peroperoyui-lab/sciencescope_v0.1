// The whole window in the old interface's layout: top bar, sidebar, the
// current page, the status bar and the popups.
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
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
import { SettingsDialog } from './settings.js';
import { UpdatePrompt } from './update-prompt.js';
import { listenForUpdates } from '../update-state.js';
import { Footbar, Topbar } from './shell.js';
import { Sidebar } from './sidebar.js';
import { Workbench } from './workbench.js';
import { Versions } from './versions.js';
import { VersionNotes } from './version-notes.js';
import { JOURNAL_TABS, JournalEntryPage } from './journal-entry.js';
import { VersionDiff } from './version-diff.js';
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
  const address = useRoute();
  // Settings open as a dialog over the page the person came from.
  const behind = useRef(/** @type {import('../route.js').Route} */ ({ view: 'home' }));
  if (address.view !== 'settings') behind.current = address;
  const route = behind.current;
  const settingsPage = address.view === 'settings' ? address.id : null;
  const assistantOpen = useAppState((state) => state.assistantOpen);
  const materialsTarget = useAppState((state) => state.materialsTarget);
  // Re-render everything when the language changes.
  useAppState((state) => state.settings?.appearance?.language);
  const projectId = useAppState((state) => {
    if (['version-notes', 'version-diff', 'journal-entry'].includes(route.view))
      return route.id.split('/')[0];
    if (route.view === 'map') return route.id.split('/')[0];
    if (
      ['workbench', 'new', 'plans', 'journal', 'files', 'map', 'database', 'versions'].includes(
        route.view,
      )
    ) {
      return route.id;
    }
    if (route.view === 'meeting') {
      const meetingId = route.id.split('/')[0];
      return state.meetings.find((meeting) => meeting.id === meetingId)?.projectId ?? null;
    }
    return null;
  });
  const actions = useActions();
  // Set before the new view is painted: an answer that fails in the meantime
  // must not be marked as seen in the meeting the person just left.
  useLayoutEffect(() => {
    actions.viewMeeting(route.view === 'meeting' ? route.id.split('/')[0] : null);
  }, [route.view, route.id]);
  useEffect(() => {
    void actions.attempt(() => actions.focusProject(projectId));
  }, [projectId]);
  useShortcuts(projectId);
  useEffect(listenForUpdates, []);
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
    page = html`<${MapEditor}
      key=${route.id}
      projectId=${projectId}
      focusNodeId=${route.id.split('/')[1]}
    />`;
  else if (route.view === 'workbench') page = html`<${Workbench} projectId=${route.id} />`;
  else if (route.view === 'versions')
    page = html`<${Versions} project=${{ id: projectId, name: projectName }} full />`;
  else if (route.view === 'version-notes')
    page = html`<${VersionNotes}
      key=${route.id}
      projectId=${projectId}
      id=${route.id.split('/')[1]}
    />`;
  else if (route.view === 'journal-entry')
    page = html`<${JournalEntryPage}
      key=${route.id}
      projectId=${projectId}
      line=${Number(route.id.split('/')[1])}
      initial=${JOURNAL_TABS[Number(route.id.split('/')[2])] ?? '日志详情'}
    />`;
  else if (route.view === 'version-diff')
    page = html`<${VersionDiff}
      key=${route.id}
      projectId=${projectId}
      id=${route.id.split('/')[1]}
    />`;
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
  } else page = html`<${Welcome} projectId=${route.view === 'new' ? route.id : null} />`;

  const meetingId = route.view === 'meeting' ? route.id.split('/')[0] : null;
  return html`<div class="ss-shell">
      <${Topbar} projectName=${projectName} projectId=${projectId} meetingId=${meetingId} />
      <div class="ss-shell__body">
        <${Sidebar} route=${route} currentProjectId=${projectId} />
        ${page} ${materialsTarget && html`<${MaterialsPanel} target=${materialsTarget} />`}
        <${FilePreview} />
        ${assistantOpen && html`<${AssistantPanel} onClose=${() => actions.showAssistant(false)} />`}
      </div>
      <${Footbar} />
    </div>
    ${
      settingsPage !== null &&
      html`<${SettingsDialog} page=${settingsPage} onClose=${() => navigate(behind.current)} />`
    }
    <${UpdatePrompt} />
    <${Overlays} />`;
}
