// A version's 稿件版本说明 (written by the task secretary) in the version
// tree's details: the notes, what they point to, and 整理 on demand or for
// every new version of the project.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { formatTime, t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { renderMarkdown } from '../markdown.js';
import { navigate } from '../route.js';
import { useSnapshotCapture } from '../resource-snapshots.js';
import { openResourceHistory } from './resource-history.js';
import { Select } from './settings-kit.js';

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
 * `onReference` is given in the main window: what the notes point to opens, and
 * the notes can be quoted into a chat. In the desk window they show as labels.
 */
export function VersionNotesBox({ versionId, projectId, onReference }) {
  const actions = useActions();
  const refresh = useAppState((state) => state.versionsVersion + state.workspaceVersion);
  const meetings = useAppState((state) => state.meetings);
  const key = `${projectId}/${versionId}`;
  const [doc, setDoc] = useState(/** @type {any} */ (null));
  const [auto, setAuto] = useState(/** @type {boolean | null} */ (null));
  const [busy, setBusy] = useState(false);
  const [baseline, setBaseline] = useState(/** @type {string | null} */ (null));
  const [editing, setEditing] = useState(
    /** @type {null | { text: string, revisionId: any }} */ (null),
  );
  const [extra, setExtra] = useState('');
  const [target, setTarget] = useState('');
  // Edits keep a history like other workspace files (历史版本).
  useSnapshotCapture([['versions', key]]);
  useEffect(() => {
    let active = true;
    // The notes and the catalog entry only: reading the version itself parses the whole file.
    Promise.all([actions.readResource('versions', key), actions.versionGroups(projectId)])
      .then(([notes, groups]) => {
        if (!active) return;
        const group = groups.find((entry) =>
          (entry.versions ?? []).some((version) => version.id === versionId),
        );
        const version = group?.versions.find((entry) => entry.id === versionId);
        setDoc({ notes, version, siblings: group?.versions ?? [] });
        setBaseline((current) => current ?? version?.baselineId ?? '');
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
  const chats = meetings.filter(
    (meeting) =>
      meeting.projectId === projectId &&
      !meeting.temporary &&
      !meeting.attachedToMeetingId &&
      !meeting.archived,
  );
  /** @param {() => Promise<any>} work */
  async function run(work) {
    setBusy(true);
    const result = await actions.attempt(work);
    setBusy(false);
    return result;
  }
  const organize = () =>
    run(async () => {
      if ((baseline || null) !== (version?.baselineId ?? null))
        await actions.versionBaseline(versionId, baseline || null);
      await actions.organizeVersion(versionId);
    });
  const iconButton = (icon, label, onClick, disabled = false) =>
    html`<button
      type="button"
      class="ss-icon-btn ss-icon-btn--sm"
      aria-label=${label}
      data-tip=${label}
      disabled=${disabled}
      onClick=${onClick}
    >
      <${Lucide} name=${icon} />
    </button>`;
  return html`<section class="ss-vtree__notes" data-version-notes=${versionId}>
    <div class="ss-block-head">
      <span class="ss-block-head__title">${t('版本说明')}</span>
      ${status && html`<span class=${`ss-tag ${tone ? `ss-tag--${tone}` : ''}`}>${t(status)}</span>`}
      <span class="ss-titlebar__spacer"></span>
      ${iconButton(
        'pencil',
        t('编辑说明'),
        () => setEditing({ text: doc.notes.text ?? '', revisionId: doc.notes.revisionId }),
        !doc?.notes?.exists || !!editing,
      )}
      ${iconButton('history', t('历史版本'), () =>
        openResourceHistory(actions, { projectId, resource: 'versions', key }),
      )}
      ${iconButton(
        'file-text',
        t('打开说明 MD'),
        () => actions.attempt(() => actions.openVersionNotes(versionId)),
        !doc?.notes?.exists,
      )}
    </div>
    ${
      version &&
      html`<div class="ss-vtree__organize">
        <${Select}
          label=${t('比较基线')}
          small
          width="auto"
          value=${baseline ?? ''}
          options=${[
            { value: '', text: t('首版，无前序版本') },
            ...doc.siblings
              .filter((entry) => entry.id !== versionId)
              .map((entry) => ({ value: entry.id, text: `v${entry.number} · ${entry.name}` })),
          ]}
          onChange=${setBaseline}
        />
        <button
          type="button"
          class="ss-btn ss-btn--sm"
          disabled=${busy || running}
          data-tip=${t('任务秘书比较这一版和基线，写下变化和建议')}
          onClick=${organize}
        >
          <${Lucide} name="wand-sparkles" />${text ? t('重新整理') : t('让秘书整理')}
        </button>
        ${
          version.generatedAt &&
          html`<span class="ss-muted">${t('生成时间')}：${formatTime(version.generatedAt)}</span>`
        }
      </div>`
    }
    ${
      editing
        ? html`<div class="ss-vtree__notes-edit">
            <textarea
              class="ss-textarea"
              aria-label=${t('编辑版本说明')}
              rows="10"
              value=${editing.text}
              onInput=${(event) => setEditing({ ...editing, text: event.currentTarget.value })}
            ></textarea>
            <div class="ss-vtree__notes-row">
              <button
                type="button"
                class="ss-btn ss-btn--sm ss-btn--primary"
                disabled=${busy}
                onClick=${async () => {
                  const saved = await run(() =>
                    actions.editVersionNotes(versionId, editing.text, editing.revisionId),
                  );
                  if (saved) setEditing(null);
                }}
              >
                ${t('保存说明')}
              </button>
              <button type="button" class="ss-btn ss-btn--sm" onClick=${() => setEditing(null)}>
                ${t('取消')}
              </button>
            </div>
          </div>`
        : doc
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
      doc?.notes?.exists &&
      !editing &&
      html`<div class="ss-vtree__notes-edit">
        <textarea
          class="ss-textarea"
          aria-label=${t('补充说明')}
          rows="2"
          placeholder=${t('写下你的补充，会接在说明末尾')}
          value=${extra}
          onInput=${(event) => setExtra(event.currentTarget.value)}
        ></textarea>
        ${
          extra.trim() &&
          html`<div class="ss-vtree__notes-row">
            <button
              type="button"
              class="ss-btn ss-btn--sm"
              disabled=${busy}
              onClick=${async () => {
                const saved = await run(() =>
                  actions.editResource('versions', key, 'append', { text: `\n${extra}\n` }),
                );
                if (saved) {
                  await actions.captureSnapshot('versions', key);
                  setExtra('');
                }
              }}
            >
              ${t('保存补充')}
            </button>
          </div>`
        }
      </div>`
    }
    ${
      onReference &&
      text &&
      chats.length > 0 &&
      html`<div class="ss-vtree__notes-row">
        <${Select}
          label=${t('引用到对话')}
          small
          width="auto"
          placeholder=${t('选一个对话')}
          value=${target}
          options=${chats.map((meeting) => ({ value: meeting.id, text: meeting.title }))}
          onChange=${setTarget}
        />
        <button
          type="button"
          class="ss-btn ss-btn--sm"
          disabled=${!target}
          onClick=${() =>
            actions.attempt(async () => {
              await actions.changeInput(target, {
                op: 'add',
                material: { type: 'version-notes', id: versionId, text: doc.notes.text },
              });
              navigate({ view: 'meeting', id: target });
            })}
        >
          <${Lucide} name="quote" />${t('引用说明到对话')}
        </button>
      </div>`
    }
    ${
      auto !== null &&
      html`<label class="ss-check">
        <input
          type="checkbox"
          checked=${auto}
          onChange=${(event) => {
            // Show the choice at once; a re-render before the save returns must not undo the tick.
            const checked = event.currentTarget.checked;
            setAuto(checked);
            actions.attempt(async () => {
              const result = await actions.setVersionPreferences(projectId, checked);
              setAuto(Boolean(result.autoOrganize));
            });
          }}
        /><span>${t('这个项目的新版本自动整理说明')}</span>
      </label>`
    }
  </section>`;
}
