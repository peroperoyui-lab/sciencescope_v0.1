// A version's 稿件版本说明 (written by the task secretary) in the version
// tree's details: the notes, what they point to, and 整理 on demand or for
// every new version of the project.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { renderMarkdown } from '../markdown.js';
import { navigate } from '../route.js';

const STATUS = {
  pending: ['', '等待整理'],
  running: ['', '整理中'],
  completed: ['ok', '已整理'],
  failed: ['danger', '整理失败'],
};

/**
 * Opens what a version note points to, in the main window.
 * @param {import('../actions.js').Actions} actions
 * @param {any} reference
 * @param {string} projectId
 */
export function openVersionReference(actions, reference, projectId) {
  const project = reference.projectId ?? projectId;
  if (reference.kind === 'map-node') navigate({ view: 'map', id: `${project}/${reference.id}` });
  else if (reference.kind === 'version')
    actions.openPreview({
      kind: 'version',
      id: reference.id,
      projectId: project,
      page: reference.location?.page,
    });
  else if (reference.kind === 'project-file' || reference.kind === 'script') {
    if (reference.path === 'workbench/plans.md') navigate({ view: 'plans', id: project });
    else actions.openPreview({ kind: 'project', path: reference.path, projectId: project });
  } else if (reference.kind === 'message')
    navigate({ view: 'meeting', id: `${reference.meetingId}/${reference.id}` });
  else if (reference.kind === 'source' || reference.kind === 'chunk')
    actions.openPreview({ kind: 'source', id: reference.sourceId ?? reference.id, projectId });
  else if (reference.kind === 'item')
    void actions.attempt(async () => {
      const detail = await actions.researchItem(reference.id);
      actions.openModal(
        t('条目详情'),
        html`<div class="ss-dialog__body">
          <h3 class="ss-item-card__title">${detail.item.title}</h3>
          <div
            class="ss-prose rendered-markdown"
            dangerouslySetInnerHTML=${{ __html: renderMarkdown(detail.item.body) }}
          ></div>
        </div>`,
      );
    });
}

/**
 * @param {{ versionId: string, projectId: string, onReference?: (reference: any) => void }} props
 * Without `onReference` (the desk window) what the notes point to shows as plain labels.
 */
export function VersionNotesBox({ versionId, projectId, onReference }) {
  const actions = useActions();
  const refresh = useAppState((state) => state.versionsVersion);
  const [doc, setDoc] = useState(/** @type {any} */ (null));
  const [auto, setAuto] = useState(/** @type {boolean | null} */ (null));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    // The notes and the catalog entry only: reading the version itself parses the whole file.
    Promise.all([
      actions.readResource('versions', `${projectId}/${versionId}`),
      actions.versionGroups(projectId),
    ])
      .then(([notes, groups]) => {
        if (!active) return;
        const version = groups
          .flatMap((group) => group.versions ?? [])
          .find((entry) => entry.id === versionId);
        setDoc({ notes, version });
      })
      .catch((failure) => active && actions.toast(failure.message));
    return () => {
      active = false;
    };
  }, [versionId, projectId, refresh]);
  useEffect(() => {
    let active = true;
    actions
      .versionPreferences(projectId)
      .then((value) => active && setAuto(Boolean(value.autoOrganize)))
      .catch(() => active && setAuto(null));
    return () => {
      active = false;
    };
  }, [projectId]);
  const version = doc?.version;
  const text = doc?.notes?.text?.trim() ?? '';
  const [tone, status] = STATUS[version?.notesStatus] ?? ['', ''];
  const running = version?.notesStatus === 'running';
  async function organize() {
    setBusy(true);
    await actions.attempt(() => actions.organizeVersion(versionId));
    setBusy(false);
  }
  return html`<section class="ss-vtree__notes" data-version-notes=${versionId}>
    <div class="ss-block-head">
      <span class="ss-block-head__title">${t('版本说明')}</span>
      ${status && html`<span class=${`ss-tag ${tone ? `ss-tag--${tone}` : ''}`}>${t(status)}</span>`}
      <span class="ss-titlebar__spacer"></span>
      <button
        type="button"
        class="ss-btn ss-btn--ghost ss-btn--sm"
        disabled=${busy || running || !version}
        data-tip=${t('任务秘书比较这一版和上一版，写下变化和建议')}
        onClick=${organize}
      >
        <${Lucide} name="wand-sparkles" />${text ? t('重新整理') : t('让秘书整理')}
      </button>
    </div>
    ${
      doc
        ? text
          ? html`<div
              class="ss-prose rendered-markdown ss-vtree__notes-text"
              dangerouslySetInnerHTML=${{ __html: renderMarkdown(text) }}
            ></div>`
          : html`<p class="ss-muted">${t('还没有版本说明。')}</p>`
        : html`<p class="ss-muted" role="status">${t('正在读取…')}</p>`
    }
    ${
      version?.notesError && html`<p class="ss-field__error" role="alert">${version.notesError}</p>`
    }
    ${
      version?.references?.length > 0 &&
      html`<div class="ss-vtree__refs">
        ${version.references.map((reference, index) =>
          onReference
            ? html`<button
                type="button"
                key=${index}
                class="ss-btn ss-btn--sm"
                onClick=${() => onReference(reference)}
              >
                ${reference.label ?? reference.path ?? reference.id}
              </button>`
            : html`<span class="ss-tag" key=${index}
                >${reference.label ?? reference.path ?? reference.id}</span
              >`,
        )}
      </div>`
    }
    ${
      auto !== null &&
      html`<label class="ss-check">
        <input
          type="checkbox"
          checked=${auto}
          onChange=${(event) =>
            actions.attempt(async () => {
              const result = await actions.setVersionPreferences(
                projectId,
                event.currentTarget.checked,
              );
              setAuto(Boolean(result.autoOrganize));
            })}
        /><span>${t('这个项目的新版本自动整理说明')}</span>
      </label>`
    }
  </section>`;
}
