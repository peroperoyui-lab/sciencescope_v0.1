// History keeps the legacy list/card markup; previews never expose edit controls.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { formatTime, t } from '../i18n/index.js';
import { renderMarkdown } from '../markdown.js';
import { RESOURCE_LABELS, SOURCE_LABELS, useSnapshots } from '../resource-snapshots.js';
import { MapCanvas } from './map-canvas.js';
import { InfoTip } from './info-tip.js';

const HELP =
  '离开编辑页面或 AI 发言结束时保留内容有变化的版本。恢复前会先保留当前内容；删除版本不会删除当前内容。';

/** @param {import('../actions.js').Actions} actions @param {any} query @param {string} [snapshotId] */
export function openResourceHistory(actions, query, snapshotId) {
  actions.openModal(
    t('历史版本'),
    html`<${ResourceHistory} query=${query} snapshotId=${snapshotId} />`,
  );
}

/** @param {{query:any,snapshotId?:string,compact?:boolean}} props */
export function ResourceHistory({ query, snapshotId, compact = false }) {
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
  if (deleting)
    return html`<div data-snapshot-confirm>
      <p>${t('删除这个历史版本？当前内容不受影响。')}</p>
      <p>
        ${t(RESOURCE_LABELS[deleting.resource] ?? deleting.resource)} ·
        ${formatTime(deleting.createdAt)}
      </p>
      <div class="saverow">
        <button class="btn" disabled=${busy} onClick=${() => setDeleting(null)}>${t('取消')}</button
        ><button class="btn danger" disabled=${busy} onClick=${remove}>${t('删除版本')}</button>
      </div>
    </div>`;
  return html`<div data-resource-history>
    <div class="between">
      <span>${compact ? '' : t('历史版本')}</span><${InfoTip} text=${t(HELP)} />
    </div>
    ${
      selected
        ? html`<div data-snapshot-preview>
            <div class="row" style="margin:12px 0">
              <button class="btn tiny" onClick=${() => setSelected(null)}>
                ${t('返回版本列表')}</button
              ><span class="tag">${t('只读预览')}</span>
            </div>
            ${
              preview
                ? html`<p>
                      <strong>${t(RESOURCE_LABELS[preview.resource] ?? preview.resource)}</strong> ·
                      ${formatTime(preview.createdAt)} · ${author(preview)}
                    </p>
                    ${preview.resource === 'map' ? html`<div style="height:280px;position:relative;overflow:auto"><${MapCanvas} nodes=${preview.value?.nodes ?? []} edges=${preview.value?.edges ?? []} readonly /></div>` : html`<div class="rendered-markdown" style="max-height:380px;overflow:auto" dangerouslySetInnerHTML=${{ __html: renderMarkdown(preview.text ?? '') }}></div>`}
                    <div class="saverow">
                      <button class="btn" disabled=${busy} onClick=${() => setDeleting(preview)}>
                        ${t('删除')}</button
                      ><button
                        class="btn primary"
                        disabled=${busy}
                        onClick=${() => restore(preview.id)}
                      >
                        ${t('恢复到此版本')}
                      </button>
                    </div>`
                : html`<p>${t('正在读取…')}</p>`
            }
          </div>`
        : html`<div class="versionlist" style="max-height:500px;overflow:auto">
            ${Object.keys(RESOURCE_LABELS).map((resource) => {
              const group = snapshots.filter((snapshot) => snapshot.resource === resource);
              if (!group.length) return null;
              return html`<section data-snapshot-group=${resource}>
                <h3>${t(RESOURCE_LABELS[resource])}</h3>
                ${group.map(
                  (snapshot) =>
                    html`<div
                      class="listrow"
                      style="display:block"
                      key=${snapshot.id}
                      data-snapshot-id=${snapshot.id}
                    >
                      <span class="grow"
                        ><strong>${author(snapshot)}</strong
                        ><small style="display:block"
                          >${formatTime(snapshot.createdAt)}${snapshot.key === 'global' ? ` · ${t('全局')}` : ''}${resource === 'minutes' ? ` · ${meetings.find((meeting) => meeting.id === snapshot.key)?.title ?? ''}` : ''}</small
                        ><small
                          >${snapshot.description || t(SOURCE_LABELS[snapshot.source] ?? snapshot.source)}</small
                        ></span
                      >
                      <div class="row" style="flex-wrap:wrap;margin-top:8px">
                        <button
                          class="btn tiny"
                          disabled=${busy}
                          onClick=${() => (compact ? openResourceHistory(actions, query, snapshot.id) : setSelected(snapshot.id))}
                        >
                          ${t('查看')}</button
                        ><button
                          class="btn tiny"
                          disabled=${busy}
                          onClick=${() => restore(snapshot.id)}
                        >
                          ${t('恢复到此版本')}</button
                        ><button
                          class="btn tiny"
                          disabled=${busy}
                          onClick=${() => setDeleting(snapshot)}
                        >
                          ${t('删除')}
                        </button>
                      </div>
                    </div>`,
                )}
              </section>`;
            })}
            ${!snapshots.length && html`<p class="inline-empty">${t('还没有历史版本。')}</p>`}
          </div>`
    }
  </div>`;
}
