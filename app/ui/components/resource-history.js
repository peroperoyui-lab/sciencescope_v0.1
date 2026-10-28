// 历史版本 of an editable file (plans, log, map, minutes, version notes): the
// versions grouped by file, a read-only preview, restore and delete. Previews
// never show edit controls.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { formatTime, t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { renderMarkdown } from '../markdown.js';
import { RESOURCE_LABELS, SOURCE_LABELS, useSnapshots } from '../resource-snapshots.js';
import { MapCanvas } from './map-canvas.js';

const HELP =
  '离开编辑页面或 AI 发言结束时保留内容有变化的版本。恢复前会先保留当前内容；删除版本不会删除当前内容。';

/** @param {import('../actions.js').Actions} actions @param {any} query @param {string} [snapshotId] */
export function openResourceHistory(actions, query, snapshotId) {
  actions.openModal(
    t('历史版本'),
    html`<div class="ss-dialog__body">
      <${ResourceHistory} query=${query} snapshotId=${snapshotId} />
    </div>`,
    'lg',
  );
}

/** @param {{ query: any, snapshotId?: string }} props */
export function ResourceHistory({ query, snapshotId }) {
  const actions = useActions();
  const snapshots = useSnapshots(query);
  const participants = useAppState((state) => state.participants);
  const meetings = useAppState((state) => state.meetings);
  const [selected, setSelected] = useState(snapshotId ?? null);
  const [preview, setPreview] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    setPreview(null);
    if (selected)
      actions
        .readSnapshot(selected)
        .then((value) => current && setPreview(value))
        .catch((error) => actions.toast(error.message));
    return () => {
      current = false;
    };
  }, [selected]);
  const author = (snapshot) =>
    participants.find((participant) => participant.id === snapshot.actorId)?.name ??
    (snapshot.actorId === 'user' ? t('你') : (snapshot.actorId ?? t('你')));
  async function restore(id) {
    setBusy(true);
    const result = await actions.attempt(() => actions.restoreSnapshot(id));
    setBusy(false);
    if (result) actions.toast(t('已恢复到此版本。'));
  }
  async function remove() {
    setBusy(true);
    const result = await actions.attempt(() => actions.deleteSnapshot(deleting.id));
    setBusy(false);
    if (result) {
      if (selected === deleting.id) setSelected(null);
      setDeleting(null);
    }
  }
  const label = (resource) => t(RESOURCE_LABELS[resource] ?? resource);
  if (deleting)
    return html`<div class="ss-history" data-snapshot-confirm>
      <p class="ss-history__text">${t('删除这个历史版本？当前内容不受影响。')}</p>
      <p class="ss-muted ss-history__text">
        ${label(deleting.resource)} · ${formatTime(deleting.createdAt)}
      </p>
      <div class="ss-history__foot">
        <button type="button" class="ss-btn" disabled=${busy} onClick=${() => setDeleting(null)}>
          ${t('取消')}
        </button>
        <button type="button" class="ss-btn ss-btn--danger" disabled=${busy} onClick=${remove}>
          ${t('删除版本')}
        </button>
      </div>
    </div>`;
  if (selected)
    return html`<div class="ss-history" data-resource-history data-snapshot-preview>
      <div class="ss-history__bar">
        <button type="button" class="ss-linkbtn" onClick=${() => setSelected(null)}>
          <${Lucide} name="chevron-left" small />${t('返回版本列表')}
        </button>
        <span class="ss-tag">${t('只读预览')}</span>
      </div>
      ${
        preview
          ? html`<p class="ss-muted ss-history__text">
                <strong>${label(preview.resource)}</strong> · ${formatTime(preview.createdAt)} ·
                ${author(preview)}
              </p>
              ${
                preview.resource === 'map'
                  ? html`<div class="ss-history__map">
                      <${MapCanvas}
                        nodes=${preview.value?.nodes ?? []}
                        edges=${preview.value?.edges ?? []}
                        readonly
                      />
                    </div>`
                  : html`<div
                      class="ss-prose ss-history__preview"
                      dangerouslySetInnerHTML=${{ __html: renderMarkdown(preview.text ?? '') }}
                    ></div>`
              }
              <div class="ss-history__foot">
                <button
                  type="button"
                  class="ss-btn"
                  disabled=${busy}
                  onClick=${() => setDeleting(preview)}
                >
                  ${t('删除')}
                </button>
                <button
                  type="button"
                  class="ss-btn ss-btn--primary"
                  disabled=${busy}
                  onClick=${() => restore(preview.id)}
                >
                  ${t('恢复到此版本')}
                </button>
              </div>`
          : html`<p class="ss-muted ss-history__text">${t('正在读取…')}</p>`
      }
    </div>`;
  return html`<div class="ss-history" data-resource-history>
    <p class="ss-muted ss-history__text">${t(HELP)}</p>
    ${Object.keys(RESOURCE_LABELS).map((resource) => {
      const group = snapshots.filter((snapshot) => snapshot.resource === resource);
      if (!group.length) return null;
      return html`<section key=${resource} data-snapshot-group=${resource}>
        <div class="ss-block-head">
          <span class="ss-block-head__title">${label(resource)}</span>
          <span class="ss-count">${group.length}</span>
        </div>
        <div class="ss-list">
          ${group.map((snapshot) => {
            const where = [
              formatTime(snapshot.createdAt),
              snapshot.key === 'global' ? t('全局') : '',
              resource === 'minutes'
                ? (meetings.find((meeting) => meeting.id === snapshot.key)?.title ?? '')
                : '',
              snapshot.description || t(SOURCE_LABELS[snapshot.source] ?? snapshot.source),
            ].filter(Boolean);
            return html`<div
              class="ss-list-row ss-list-row--2"
              key=${snapshot.id}
              data-snapshot-id=${snapshot.id}
            >
              <${Lucide} name="history" class="ss-list-row__icon" />
              <div class="ss-list-row__main">
                <span class="ss-list-row__title">${author(snapshot)}</span>
                <span class="ss-list-row__sub">${where.join(' · ')}</span>
              </div>
              <span class="ss-list-row__actions">
                <button
                  type="button"
                  class="ss-btn ss-btn--ghost ss-btn--sm"
                  disabled=${busy}
                  onClick=${() => setSelected(snapshot.id)}
                >
                  ${t('查看')}
                </button>
                <button
                  type="button"
                  class="ss-btn ss-btn--ghost ss-btn--sm"
                  disabled=${busy}
                  onClick=${() => restore(snapshot.id)}
                >
                  ${t('恢复到此版本')}
                </button>
                <button
                  type="button"
                  class="ss-icon-btn ss-icon-btn--sm"
                  aria-label=${t('删除')}
                  data-tip=${t('删除')}
                  disabled=${busy}
                  onClick=${() => setDeleting(snapshot)}
                >
                  <${Lucide} name="trash-2" />
                </button>
              </span>
            </div>`;
          })}
        </div>
      </section>`;
    })}
    ${
      !snapshots.length &&
      html`<div class="ss-empty">
        <div class="ss-empty__icon"><${Lucide} name="history" /></div>
        <div class="ss-empty__title">${t('还没有历史版本。')}</div>
      </div>`
    }
  </div>`;
}
