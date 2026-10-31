// What an answer did with the knowledge base, under its text (KB-12): the
// sources the turn read or cited, with the graph path that found them
// (「本轮用到的资料」, UsedSources), and the entities and links it wrote
// (「本轮修改了知识库」, KnowledgeChange) with 在图中查看 and 撤回这组修改.
// Both use the delivered-files row (ss-files): one line, open for the list.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { usedSources } from '../turn-sources.js';
import { kindLabel, nodeKind, relationLabel, splitRef } from './knowledge-fields.js';

const SHOWN = 6;

/** @param {{ calls: any[], text: string, projectId?: string | null }} props */
export function UsedSources({ calls, text }) {
  const actions = useActions();
  const [open, setOpen] = useState(false);
  const sources = usedSources(calls, text);
  if (!sources.length) return null;
  const viaGraph = sources.filter((source) => source.via.length).length;
  return html`<div class="ss-files" data-used-sources data-open=${open || undefined}>
    <button
      type="button"
      class="ss-files__head"
      aria-expanded=${open}
      onClick=${() => setOpen(!open)}
    >
      <${Lucide} name="book-open" />
      <span class="ss-files__count">${t('本轮用到的资料')}</span>
      ${
        !open &&
        html`<span class="ss-files__names">
          ${t('{n} 份资料', { n: sources.length })}${
            viaGraph ? t('，{n} 份经由知识库找到', { n: viaGraph }) : ''
          }
        </span>`
      }
      <${Lucide} name="chevron-down" class="ss-files__chev" />
    </button>
    ${
      open &&
      html`<div class="ss-files__list" aria-label=${t('本轮用到的资料')}>
        ${sources.map(
          (source) =>
            html`<div class="ss-used" key=${source.id} data-source=${source.id}>
              <button
                type="button"
                class="ss-files__row"
                title=${t('预览')}
                onClick=${() => actions.openPreview({ kind: 'source', id: source.id })}
              >
                <span class="ss-files__icon"><${Lucide} name="file-text" /></span>
                <span class="ss-files__name">
                  ${source.label && html`<span class="ss-used__label">${source.label}</span>`}
                  ${source.title}
                </span>
                <span class="ss-files__desc ss-mono">
                  ${source.folderPath ?? (source.projectId ? t('项目导入的资料') : t('全局资料'))}${
                    source.pages.size
                      ? ` · p.${[...source.pages].sort((a, b) => a - b).join(', ')}`
                      : ''
                  }
                </span>
              </button>
              ${source.via.map(
                (via) =>
                  html`<div class="ss-used__via" key=${via}>
                    <${Lucide} name="waypoints" small />
                    <span class="ss-used__path">${t('经由：')}${via}</span>
                    <button
                      type="button"
                      class="ss-btn ss-btn--ghost ss-btn--sm"
                      onClick=${() =>
                        actions.openKnowledgeNode({
                          type: 'source',
                          id: source.id,
                          title: source.title,
                          graph: true,
                        })}
                    >
                      ${t('在图中查看')}
                    </button>
                  </div>`,
              )}
            </div>`,
        )}
      </div>`
    }
  </div>`;
}

/** One change's words: 新增实体 csQCA, csQCA —变种→ QCA, 删除关系 …. @param {any} change */
function changeText(change) {
  const removed = change.after?.status === 'removed';
  const edge = change.ref.startsWith('edge:');
  const name =
    edge && change.from && change.to
      ? `${change.from.name} —${relationLabel(change.name)}→ ${change.to.name}`
      : change.name;
  if (removed) return edge ? t('删除关系 {name}', { name }) : t('删除 {name}', { name });
  if (change.op === 'create') return edge ? name : t('新增实体 {name}', { name });
  return t('修改 {name}', { name });
}

/** 依据 p.6 / 你在对话中说的 / 缺证据, for an edge. @param {any} change */
function evidenceText(change) {
  const evidence = change.evidence ?? [];
  if (!evidence.length) return null;
  const first = evidence[0];
  if (String(first.ref ?? '').startsWith('message:')) return t('你在对话中说的');
  return first.page ? t('依据 p.{page}', { page: first.page }) : t('有原文依据');
}

/** @param {any[]} changes */
function summary(changes) {
  const count = { entities: 0, edges: 0, changed: 0, removed: 0 };
  for (const change of changes) {
    if ((change.after?.status ?? '') === 'removed') count.removed++;
    else if (change.op !== 'create') count.changed++;
    else if (change.ref.startsWith('edge:')) count.edges++;
    else count.entities++;
  }
  const parts = [];
  if (count.entities) parts.push(t('新增 {n} 个实体', { n: count.entities }));
  if (count.edges) parts.push(t('{n} 条关系', { n: count.edges }));
  if (count.changed) parts.push(t('修改 {n} 项', { n: count.changed }));
  if (count.removed) parts.push(t('删除 {n} 项', { n: count.removed }));
  return parts.join(t('、'));
}

/** @param {{ message: any }} props */
export function KnowledgeChange({ message }) {
  const actions = useActions();
  const researchVersion = useAppState((state) => state.researchVersion);
  const [group, setGroup] = useState(/** @type {any} */ (null));
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const turnId = message.turnId;
  const load = async () => {
    const batched = await actions.batchedKnowledge(message.id);
    if (batched) return batched.value && { ...batched.value, last: batched.value.lastId };
    const page = await actions.knowledgeVersions({ turnId, limit: 1 });
    const version = page.rows?.[0];
    if (!version?.closedAt) return null;
    const detail = await actions.knowledgeVersion(version.id);
    // Each 撤回 or 恢复 restores the newest version in the chain and is itself
    // a version, so an odd number of links means the group is withdrawn now.
    let last = detail.version;
    let links = 0;
    while (last.restoredBy && links < 20) {
      last = (await actions.knowledgeVersion(last.restoredBy)).version;
      links++;
    }
    return { ...detail, last: last.id, withdrawn: links % 2 === 1 };
  };
  useEffect(() => {
    if (!turnId) return;
    let current = true;
    load()
      .then((value) => current && setGroup(value))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [turnId, researchVersion]);
  const changes = (group?.changes ?? []).filter((change) => !change.ref.startsWith('chunk:'));
  if (!changes.length) return null;
  const { withdrawn } = group;
  const centre =
    changes.find((change) => change.ref.startsWith('entity:'))?.ref ??
    changes.find((change) => change.from)?.from.ref;
  const showInGraph = () =>
    actions.openKnowledgeNode({ ...splitRef(centre), title: '', graph: true });
  const restore = (undoing) =>
    actions.attempt(async () => {
      setBusy(true);
      try {
        const result = await actions.restoreKnowledgeVersion(group.last);
        const done = result.refs?.length ?? 0;
        const skipped = result.skipped?.length ?? 0;
        setNote(
          skipped
            ? t('已撤回 {done} 条；{skipped} 条之后又被你改过，没有撤回。', { done, skipped })
            : undoing
              ? t('已撤回 {done} 条。', { done })
              : t('已恢复 {done} 条。', { done }),
        );
        setGroup(await load());
      } finally {
        setBusy(false);
      }
    });
  const shown = all ? changes : changes.slice(0, SHOWN);
  return html`<div class="ss-files" data-knowledge-change data-open=${open || undefined}>
      <button
        type="button"
        class="ss-files__head"
        aria-expanded=${open}
        onClick=${() => setOpen(!open)}
      >
        <${Lucide} name="waypoints" />
        <span class="ss-files__count">${t('本轮修改了知识库')}</span>
        ${
          !open &&
          html`<span class="ss-files__names">
            ${summary(changes)}${withdrawn ? ` · ${t('已撤回')}` : ''}
          </span>`
        }
        <${Lucide} name="chevron-down" class="ss-files__chev" />
      </button>
      ${
        open &&
        html`<div class="ss-files__list" aria-label=${t('本轮修改了知识库')}>
            ${shown.map((change) => {
              const edge = change.ref.startsWith('edge:');
              const evidence = edge ? evidenceText(change) : null;
              const target = edge ? change.from?.ref : change.ref;
              const { type } = target ? splitRef(target) : { type: '' };
              return html`<button
                key=${change.rowid ?? change.id}
                type="button"
                class="ss-rel__row"
                data-node-kind=${nodeKind(type, edge ? change.from?.kind : change.kind)}
                onClick=${() =>
                  target &&
                  actions.openKnowledgeNode({
                    ...splitRef(target),
                    title: change.name,
                    graph: true,
                  })}
              >
                <span class="ss-kind__dot"></span>
                <span class="ss-rel__label">${changeText(change)}</span>
                ${edge && !evidence && html`<span class="ss-ai ss-ai--missing">${t('缺证据')}</span>`}
                <span class="ss-rel__meta"
                  >${evidence ?? (edge ? '' : kindLabel(change.kind))}</span
                >
              </button>`;
            })}
            ${
              !all &&
              changes.length > SHOWN &&
              html`<button
                type="button"
                class="ss-linkbtn ss-used__more"
                onClick=${() => setAll(true)}
              >
                ${t('还有 {n} 条', { n: changes.length - SHOWN })}
              </button>`
            }
          </div>
          <div class="ss-files__foot">
            <button
              type="button"
              class="ss-btn ss-btn--ghost ss-btn--sm"
              disabled=${!centre}
              onClick=${showInGraph}
            >
              <${Lucide} name="waypoints" />${t('在图中查看')}
            </button>
            <span class="ss-toolbar__spacer"></span>
            ${
              withdrawn
                ? html`<button
                    type="button"
                    class="ss-btn ss-btn--ghost ss-btn--sm"
                    disabled=${busy}
                    onClick=${() => restore(false)}
                  >
                    <${Lucide} name="redo-2" />${t('恢复这组修改')}
                  </button>`
                : html`<button
                    type="button"
                    class="ss-btn ss-btn--ghost ss-btn--sm"
                    disabled=${busy}
                    onClick=${() => restore(true)}
                  >
                    <${Lucide} name="undo-2" />${t('撤回这组修改')}
                  </button>`
            }
          </div>`
      }
    </div>
    ${
      note &&
      html`<div class="ss-callout ss-used__note" role="status">
        <${Lucide} name="info" />
        <div class="ss-callout__body">${note}</div>
      </div>`
    }`;
}
