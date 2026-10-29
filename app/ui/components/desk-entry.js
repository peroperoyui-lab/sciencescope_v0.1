// The bar above a chat's input when an expert suggests the editing desk
// (desk_suggest; design system DeskEntry ③, U8). 接续当前对话 binds the desk
// to this chat; 开新分支进入 forks the chat at its latest message and binds the
// branch, so this chat stays where the draft was. Either opens the desk on the
// suggested document. Closing the bar hides this suggestion on this computer.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { openDesk } from '../desk-window.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';

const DISMISSED = 'sciencescope.desk.dismissed';

/** meetingId → the last suggestion closed there; storage may be unavailable. */
function dismissed() {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

/** @param {string} meetingId @param {number} seq */
function dismiss(meetingId, seq) {
  try {
    localStorage.setItem(DISMISSED, JSON.stringify({ ...dismissed(), [meetingId]: seq }));
  } catch {
    // Without storage the bar closes until the chat is opened again.
  }
}

/** @param {{ meeting: any }} props */
export function DeskEntryBar({ meeting }) {
  const actions = useActions();
  const version = useAppState((state) => state.deskEntryVersion);
  const [suggestion, setSuggestion] = useState(/** @type {any} */ (null));
  const [busy, setBusy] = useState(false);
  const meetingId = meeting.id;
  const projectId = meeting.projectId;

  useEffect(() => {
    if (!projectId) return setSuggestion(null);
    let alive = true;
    actions
      .deskSuggestion(meetingId)
      .then((found) => {
        const open = found.suggestion;
        if (alive) setSuggestion(open && dismissed()[meetingId] !== open.seq ? open : null);
      })
      .catch(() => alive && setSuggestion(null));
    return () => {
      alive = false;
    };
  }, [meetingId, projectId, version]);

  if (!suggestion) return null;
  /** @param {'continue' | 'branch'} mode */
  const enter = (mode) =>
    actions.attempt(async () => {
      setBusy(true);
      try {
        const entered = await actions.enterDesk({ projectId, meetingId, mode });
        setSuggestion(null);
        if (mode === 'branch')
          actions.toast(
            t('已从最新消息分出「{title}」，编辑台接着这段新对话', {
              title: entered.meeting.title,
            }),
          );
        await openDesk({ projectId, path: suggestion.document?.path ?? null });
      } finally {
        setBusy(false);
      }
    });
  return html`<div class="ss-callout ss-desk-entry" role="status">
    <${Lucide} name="file-pen" />
    <div class="ss-callout__body">
      <span class="ss-callout__title">${t('要进入编辑台继续改吗？')}</span>
      <span class="ss-desk-entry__why"
        >${[suggestion.document?.name, suggestion.reason].filter(Boolean).join(' · ')}</span
      >
    </div>
    <div class="ss-callout__actions">
      <button
        type="button"
        class="ss-btn ss-btn--sm"
        disabled=${busy}
        data-tip=${t('从最新消息分出一段新对话，这段对话停在这里')}
        onClick=${() => enter('branch')}
      >
        ${t('开新分支进入')}
      </button>
      <button
        type="button"
        class="ss-btn ss-btn--sm ss-btn--primary"
        disabled=${busy}
        onClick=${() => enter('continue')}
      >
        ${t('接续当前对话')}
      </button>
      <button
        type="button"
        class="ss-icon-btn ss-icon-btn--sm"
        aria-label=${t('不进入编辑台')}
        data-tip=${t('不进入编辑台')}
        onClick=${() => {
          dismiss(meetingId, suggestion.seq);
          setSuggestion(null);
        }}
      >
        <${Lucide} name="x" />
      </button>
    </div>
  </div>`;
}
