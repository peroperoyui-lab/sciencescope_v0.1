// 项目置顶摘要 (ProjectSummary): the flyout from a project chat's header or the
// sidebar's 工作站简报 button: recent history versions, the latest log entries,
// and the way to the map and the workbench. Esc or a click outside closes it;
// the buttons that open it carry data-summary-trigger so they can toggle it.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { place } from '../floating.js';
import { html } from '../html.js';
import { formatTime, t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { RESOURCE_LABELS, useSnapshots } from '../resource-snapshots.js';
import { openResourceHistory } from './resource-history.js';
import { navigate } from '../route.js';
import { parseLog } from '../workbench-text.js';

const ICONS = { map: 'network', plans: 'list-checks', log: 'notebook-pen' };

/** @param {{ project: any, onClose: () => void, from?: 'header' | 'sidebar' }} props */
export function ProjectSummary({ project, onClose, from = 'header' }) {
  const actions = useActions();
  const version = useAppState((state) => state.workspaceVersion);
  const revisions = useSnapshots({ projectId: project.id, limit: 5 });
  const [showChanges, setShowChanges] = useState(true);
  const [log, setLog] = useState([]);
  useEffect(() => {
    actions
      .readResource('log', project.id)
      .then((file) => setLog(parseLog(file.text ?? '').slice(0, 3)))
      .catch(() => {});
  }, [project.id, version]);
  const panel = useRef(/** @type {HTMLElement | null} */ (null));
  // Beside the button that opened it: under the chat header, or right of the sidebar.
  useLayoutEffect(() => {
    const trigger = document.querySelector(
      `${from === 'sidebar' ? '.ss-sidebar' : '.ss-header'} [data-summary-trigger]`,
    );
    if (panel.current && trigger)
      place(
        panel.current,
        trigger.getBoundingClientRect(),
        from === 'sidebar' ? 'right-start' : 'bottom-end',
        6,
      );
  });
  useEffect(() => {
    const close = (event) => {
      if (event.key === 'Escape') onClose();
    };
    const outside = (event) => {
      const target = /** @type {Element} */ (event.target);
      if (panel.current?.contains(target)) return;
      if (target.closest?.('[data-summary-trigger], .ss-menu, .ss-dialog')) return;
      onClose();
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', outside);
    };
  }, []);
  const open = (route) => {
    onClose();
    navigate(route);
  };

  return html`<section
    ref=${panel}
    class="ss-flyout ss-flyout--fixed"
    data-project-summary
    role="dialog"
    aria-label=${t('项目置顶摘要')}
  >
    <div class="ss-flyout__head">
      <${Lucide} name="folder-open" small />
      <span class="ss-truncate">${project.name}</span>
      <button
        type="button"
        class="ss-icon-btn ss-icon-btn--sm"
        aria-label=${t('关闭项目摘要')}
        data-tip=${t('关闭项目摘要')}
        onClick=${onClose}
      >
        <${Lucide} name="x" />
      </button>
    </div>
    <button
      type="button"
      class="ss-list__group"
      aria-expanded=${String(showChanges)}
      onClick=${() => setShowChanges(!showChanges)}
    >
      <${Lucide} name="chevron-down" />${t('最近历史版本')}<span class="ss-count"
        >${revisions.length}</span
      >
    </button>
    ${
      showChanges &&
      html`<div class="ss-list">
        ${revisions.map(
          (snapshot) =>
            html`<div
              class="ss-list-row ss-list-row--link"
              key=${snapshot.id}
              data-summary-version
              role="button"
              tabindex="0"
              onClick=${() => {
                onClose();
                openResourceHistory(actions, { projectId: project.id }, snapshot.id);
              }}
            >
              <${Lucide}
                name=${ICONS[snapshot.resource] ?? 'file-text'}
                class="ss-list-row__icon"
              />
              <div class="ss-list-row__main">
                <span class="ss-list-row__title"
                  >${t(RESOURCE_LABELS[snapshot.resource] ?? snapshot.resource)}</span
                >
              </div>
              <span class="ss-list-row__meta ss-list-row__meta--time"
                >${formatTime(snapshot.createdAt)}</span
              >
            </div>`,
        )}
        ${!revisions.length && html`<div class="ss-flyout__empty">${t('还没有历史版本。')}</div>`}
      </div>`
    }
    <div class="ss-flyout__group">${t('最近日志')}</div>
    <div class="ss-list">
      ${log.map(
        (entry) =>
          html`<div
            class="ss-list-row ss-list-row--link"
            key=${entry.start}
            role="button"
            tabindex="0"
            onClick=${() => open({ view: 'journal', id: project.id })}
          >
            <${Lucide} name="notebook-pen" class="ss-list-row__icon" />
            <div class="ss-list-row__main">
              <span class="ss-list-row__title">${entry.title}</span>
            </div>
            <span class="ss-list-row__meta ss-list-row__meta--time">${entry.date}</span>
          </div>`,
      )}
      ${!log.length && html`<div class="ss-flyout__empty">${t('暂无项目日志')}</div>`}
    </div>
    <div class="ss-flyout__foot">
      <button
        type="button"
        class="ss-btn ss-btn--ghost ss-btn--sm"
        onClick=${() => open({ view: 'map', id: project.id })}
      >
        <${Lucide} name="network" />${t('研究导图')}
      </button>
      <button
        type="button"
        class="ss-btn ss-btn--sm"
        onClick=${() => open({ view: 'workbench', id: project.id })}
      >
        <${Lucide} name="box" />${t('打开工作站')}
      </button>
    </div>
  </section>`;
}
