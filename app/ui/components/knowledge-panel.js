// Node detail (design system Panel beside the knowledge list): properties,
// the node's connections grouped by relation with their evidence and who
// added them, and, for entities, labels and a restorable history.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { renderMarkdown } from '../markdown.js';
import { navigate } from '../route.js';
import { InfoTip } from './info-tip.js';
import { ResearchPayload } from './research-card.js';
import { authorText, researchLabel } from './research-fields.js';
import { addedBy, sourceStatus } from './research-list.js';
import { SidePanel } from './side-panel.js';
import {
  kindIcon,
  kindLabel,
  nodeKind,
  relationLabel,
  shortDate,
  splitRef,
} from './knowledge-fields.js';

const SYMMETRIC = new Set(['similar-to', 'same-as', 'compares']);
const INCOMING = {
  cites: '被引用',
  proposes: '被提出',
  implements: '被实现',
  'variant-of': '它的变体',
  uses: '被使用',
  'evaluates-on': '在此评测',
  describes: '被描述',
  supports: '被支持',
  contradicts: '被反驳',
  qualifies: '被限定',
  defines: '被定义',
  'part-of': '包含',
  'derived-from': '派生出',
};
const GROUP_ROWS = 8;

/** A short excerpt for tips. @param {string} [text] */
const clip = (text = '', length = 120) =>
  text.length > length ? text.slice(0, length) + '…' : text;

/**
 * Groups by relation and direction, so 「引用」 and 「被引用」 stay apart.
 * @param {any[]} rows @param {string} ref
 */
function groupEdges(rows, ref) {
  const groups = new Map();
  for (const row of rows) {
    const incoming = row.toRef === ref && row.fromRef !== ref && !SYMMETRIC.has(row.relation);
    const key = (incoming ? '<' : '>') + row.relation;
    if (!groups.has(key))
      groups.set(key, {
        key,
        relation: row.relation,
        title: incoming
          ? INCOMING[row.relation]
            ? t(INCOMING[row.relation])
            : `← ${relationLabel(row.relation)}`
          : relationLabel(row.relation),
        rows: [],
      });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()];
}

/** Where an edge's evidence came from, as page buttons that open the passage or message. */
function Evidence({ evidence }) {
  const actions = useActions();
  return evidence.map((item) => {
    if (item.missing)
      return html`<span class="ss-cite ss-cite--missing" data-tip=${t('依据已删除')}>?</span>`;
    if (item.messageId)
      return html`<button
        type="button"
        class="ss-cite"
        data-tip=${`《${item.meetingTitle ?? ''}》${clip(item.excerpt)}`}
        onClick=${(event) => {
          event.stopPropagation();
          navigate({ view: 'meeting', id: `${item.meetingId}/${item.messageId}` });
        }}
      >
        ${t('消息')}
      </button>`;
    return html`<button
      type="button"
      class="ss-cite"
      data-tip=${`${item.title ?? ''}：${clip(item.quote)}`}
      onClick=${(event) => {
        event.stopPropagation();
        actions.openPreview({
          kind: 'source',
          id: item.sourceId,
          page: item.page,
          highlight: item.quote,
        });
      }}
    >
      ${item.page != null ? `p.${item.page}` : t('原文')}
    </button>`;
  });
}

/**
 * @param {{nodeRef:string, edges:any, onOpen:(ref:string)=>void, onRemove:(edge:any)=>void}} props
 */
function Connections({ nodeRef, edges, onOpen, onRemove }) {
  const [expanded, setExpanded] = useState(/** @type {string[]} */ ([]));
  if (!edges) return null;
  const groups = groupEdges(edges.rows, nodeRef);
  return html`<section data-kb-connections>
    <h3 class="ss-section-title">
      ${t('相连')}<span class="ss-muted kb-count"> ${edges.total}</span>
    </h3>
    ${
      groups.length === 0
        ? html`<p class="ss-muted kb-note">
            ${t('还没有相连的节点。整理完成或专家按原文写入后会出现在这里。')}
          </p>`
        : groups.map((group) => {
            const open = expanded.includes(group.key);
            const rows = open ? group.rows : group.rows.slice(0, GROUP_ROWS);
            return html`<div class="ss-rel" data-kb-relation=${group.relation}>
              <div class="ss-rel__head">
                ${group.title}<span class="ss-rel__count">${group.rows.length}</span>
                ${group.relation === 'similar-to' && html`<${InfoTip} text=${t('按全文向量算出的线索，不是结论；只连相似度足够高的几篇。')} />`}
                ${group.relation === 'cites' && group.rows[0]?.layer === 'derived' && html`<${InfoTip} text=${t('从参考文献自动对上的引用，是找文献的线索。')} />`}
              </div>
              ${rows.map((edge) => {
                const peer = edge.peer ?? { ref: '', name: '', kind: '' };
                const { type } = splitRef(peer.ref);
                return html`<div
                  class="ss-rel__row kb-rel"
                  data-node-kind=${nodeKind(type, peer.kind)}
                  data-kb-edge=${edge.id}
                >
                  <span class="ss-kind__dot"></span>
                  <button
                    type="button"
                    class="ss-rel__label kb-rel__open"
                    data-tip=${kindLabel(type === 'source' ? 'source' : peer.kind)}
                    onClick=${() => onOpen(peer.ref)}
                  >
                    ${peer.name}
                  </button>
                  ${
                    edge.origin === 'ai' &&
                    edge.createdBy &&
                    html`<button
                      type="button"
                      class="ss-ai"
                      data-tip=${addedBy(edge.createdBy)}
                      onClick=${() =>
                        edge.createdBy.meetingId &&
                        navigate({
                          view: 'meeting',
                          id: [edge.createdBy.meetingId, edge.createdBy.messageId]
                            .filter(Boolean)
                            .join('/'),
                        })}
                    >
                      AI
                    </button>`
                  }
                  <${Evidence} evidence=${edge.evidence ?? []} />
                  ${edge.relation === 'similar-to' && edge.weight != null && html`<span class="ss-rel__meta">${Number(edge.weight).toFixed(2)}</span>`}
                  ${
                    edge.layer !== 'derived' &&
                    html`<button
                      type="button"
                      class="ss-icon-btn ss-icon-btn--sm kb-rel__remove"
                      aria-label=${t('删除这条关系')}
                      data-tip=${t('删除这条关系')}
                      onClick=${() => onRemove(edge)}
                    >
                      <${Lucide} name="x" />
                    </button>`
                  }
                </div>`;
              })}
              ${
                group.rows.length > GROUP_ROWS &&
                html`<button
                  type="button"
                  class="ss-linkbtn"
                  onClick=${() =>
                    setExpanded(
                      open ? expanded.filter((key) => key !== group.key) : [...expanded, group.key],
                    )}
                >
                  ${open ? t('收起') : t('还有 {n} 条', { n: group.rows.length - GROUP_ROWS })}
                </button>`
              }
            </div>`;
          })
    }
    ${edges.remaining > 0 && html`<p class="ss-muted kb-note">${t('还有 {n} 条没有列出', { n: edges.remaining })}</p>`}
  </section>`;
}

const FIELD_NAMES = {
  name: '名称',
  name_en: '英文名',
  aliases_json: '别名',
  description: '说明',
  kind: '种类',
  attrs_json: '属性',
  visibility: '可见范围',
};
/** 「你改了名称、说明」 from one revision's before and after rows. @param {any} row */
function revisionText(row) {
  const who = row.origin === 'ai' ? t('专家') : row.origin === 'system' ? t('系统') : t('你');
  if (row.op === 'create') return t('{who}建立了这个节点', { who });
  if (row.op === 'remove' || row.after?.status === 'removed')
    return t('{who}删除了这个节点', { who });
  if (row.op === 'merge') return t('{who}合并了节点', { who });
  if (row.op === 'restore') return t('{who}恢复了一个旧版本', { who });
  if (row.op === 'undo') return t('{who}撤销了一步', { who });
  if (row.op === 'redo') return t('{who}重做了一步', { who });
  const fields = Object.keys(FIELD_NAMES).filter(
    (key) => JSON.stringify(row.before?.[key]) !== JSON.stringify(row.after?.[key]),
  );
  return fields.length
    ? t('{who}改了{fields}', { who, fields: fields.map((key) => t(FIELD_NAMES[key])).join('、') })
    : t('{who}修改了这个节点', { who });
}

/** @param {{rows:any[], onRestore:(row:any)=>void}} props */
function History({ rows, onRestore }) {
  if (!rows?.length) return null;
  return html`<section data-kb-history>
    <h3 class="ss-section-title">${t('历史')}</h3>
    <div class="ss-list">
      ${rows.map(
        (row, index) =>
          html`<div class="ss-list-row ss-list-row--2">
            <span class="ss-list-row__icon"
              ><${Lucide} name=${row.origin === 'ai' ? 'sparkle' : 'pencil'}
            /></span>
            <div class="ss-list-row__main">
              <span class="ss-list-row__title">${revisionText(row)}</span>
              <span class="ss-list-row__sub"
                >${shortDate(row.createdAt)} ${row.createdAt?.slice(11, 16)}</span
              >
            </div>
            ${
              index > 0 &&
              html`<span class="ss-list-row__actions">
                <button
                  type="button"
                  class="ss-btn ss-btn--ghost ss-btn--sm"
                  onClick=${() => onRestore(row)}
                >
                  ${t('恢复到这一版')}
                </button>
              </span>`
            }
          </div>`,
      )}
    </div>
  </section>`;
}

/** Labels with remove buttons and an inline add field. */
function Labels({ labels, onChange }) {
  const [adding, setAdding] = useState(false);
  return html`<span class="kb-labels">
    ${labels.map(
      (label) =>
        html`<span class="ss-tag kb-label"
          >${label}<button
            type="button"
            aria-label=${t('移除标签 {label}', { label })}
            onClick=${() => onChange({ remove: [label] })}
          >
            <${Lucide} name="x" /></button
        ></span>`,
    )}
    ${
      adding
        ? html`<span class="ss-input ss-input--sm kb-label-input"
            ><input
              aria-label=${t('添加标签')}
              placeholder=${t('标签名')}
              ref=${(element) => element?.focus()}
              onKeyDown=${(event) => {
                const value = event.currentTarget.value.trim();
                if (event.key === 'Enter' && value) {
                  onChange({ add: [value] });
                  setAdding(false);
                }
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setAdding(false);
                }
              }}
              onBlur=${() => setAdding(false)}
          /></span>`
        : html`<button
            type="button"
            class="ss-icon-btn ss-icon-btn--sm"
            aria-label=${t('添加标签')}
            data-tip=${t('添加标签')}
            onClick=${() => setAdding(true)}
          >
            <${Lucide} name="plus" />
          </button>`
    }
  </span>`;
}

/**
 * @param {{selection:{type:string,id:string,title?:string}, projectId:string|null,
 *   onSelect:(selection:{type:string,id:string,title?:string})=>void, onClose:()=>void,
 *   sourceMenu:(source:any)=>any[], itemMenu:(item:any)=>any[], entityMenu:(entity:any)=>any[],
 *   onEditEntity:(entity:any)=>void, onEditItem:(item:any)=>void}} props
 */
export function KnowledgePanel({
  selection,
  projectId,
  onSelect,
  onClose,
  sourceMenu,
  itemMenu,
  entityMenu,
  onEditEntity,
  onEditItem,
}) {
  const actions = useActions();
  const version = useAppState((state) => state.researchVersion);
  const projects = useAppState((state) => state.projects);
  const [detail, setDetail] = useState(/** @type {any} */ (null));
  const [error, setError] = useState('');
  const ref = `${selection.type}:${selection.id}`;
  useEffect(() => {
    let current = true;
    setError('');
    const load =
      selection.type === 'entity'
        ? Promise.all([actions.knowledgeEntity(selection.id), actions.knowledgeHistory(ref)]).then(
            ([entity, history]) => ({ ...entity, history: history.rows }),
          )
        : Promise.all([
            selection.type === 'source'
              ? actions.researchSource(selection.id, { limit: 1 })
              : actions.researchItem(selection.id),
            actions.knowledgeEdges(ref).catch(() => null),
          ]).then(([record, edges]) => ({ ...record, edges }));
    load
      .then((value) => current && setDetail(value))
      .catch((caught) => current && setError(caught.message));
    return () => {
      current = false;
    };
  }, [ref, version]);
  const node = detail?.source ?? detail?.item ?? detail?.entity;
  const loaded = node && node.id === selection.id;
  const title = loaded ? (node.title ?? node.name) : (selection.title ?? '');
  const open = (target) => {
    const { type, id } = splitRef(target);
    if (['source', 'item', 'entity'].includes(type)) onSelect({ type, id });
  };
  const removeEdge = (edge) =>
    actions.attempt(async () => {
      const { version: change } = await actions.knowledgeSession(projectId, (sessionId) =>
        actions.removeKnowledgeEdge(edge.id, sessionId),
      );
      actions.toast(t('已删除这条关系'), {
        label: t('撤销'),
        run: () => actions.attempt(() => actions.restoreKnowledgeVersion(change.id)),
      });
    });
  const menuButton = (items) =>
    html`<button
      type="button"
      class="ss-icon-btn"
      aria-label=${t('节点菜单')}
      data-tip=${t('更多')}
      onClick=${(event) => actions.openMenu(event, items(), title)}
    >
      <${Lucide} name="ellipsis" />
    </button>`;
  let buttons = null;
  if (loaded && selection.type === 'source')
    buttons = html`<button
        type="button"
        class="ss-icon-btn"
        aria-label=${t('预览')}
        data-tip=${t('预览')}
        onClick=${() => actions.openPreview({ kind: 'source', id: node.id })}
      >
        <${Lucide} name="eye" /></button
      >${
        node.originalPath &&
        html`<button
          type="button"
          class="ss-icon-btn"
          aria-label=${t('打开原件')}
          data-tip=${t('打开原件')}
          onClick=${() => actions.attempt(() => actions.openResearchSource(node.id))}
        >
          <${Lucide} name="external-link" />
        </button>`
      }${menuButton(() => sourceMenu(node))}`;
  else if (loaded)
    buttons = html`<button
        type="button"
        class="ss-icon-btn"
        aria-label=${t('编辑')}
        data-tip=${t('编辑')}
        onClick=${() => (selection.type === 'entity' ? onEditEntity(node) : onEditItem(node))}
      >
        <${Lucide} name="pencil" /></button
      >${menuButton(() => (selection.type === 'entity' ? entityMenu(node) : itemMenu(node)))}`;

  let body = null;
  if (loaded && selection.type === 'source') {
    const metadata = node.metadata ?? {};
    body = html`<dl class="ss-props">
        <dt>${t('种类')}</dt>
        <dd>
          <span class="ss-kind" data-node-kind="source"
            ><${Lucide}
              name=${kindIcon(node.kind === 'dataset' ? 'dataset' : 'source')}
            />${researchLabel(node.kind)}</span
          >
        </dd>
        ${
          (metadata.authors?.length || metadata.year || metadata.venue) &&
          html`<dt>${t('作者')}</dt>
            <dd>
              ${[
                authorText(metadata.authors),
                metadata.year,
                metadata.venue && `《${metadata.venue}》`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </dd>`
        }
        ${
          (node.originalPath || node.name) &&
          html`<dt>${t('位置')}</dt>
            <dd class="kb-break">
              ${node.folderPath != null ? `${node.folderPath ? node.folderPath + '/' : ''}${node.name ?? ''}` : (node.originalPath ?? node.name)}
            </dd>`
        }
        <dt>${t('引用编号')}</dt>
        <dd>${node.label}</dd>
        <dt>${t('解析状态')}</dt>
        <dd>${sourceStatus(node)}</dd>
        ${
          metadata.tags?.length > 0 &&
          html`<dt>${t('标签')}</dt>
            <dd>${metadata.tags.map((tag) => html`<span class="ss-tag">${tag}</span> `)}</dd>`
        }
      </dl>
      <${Connections}
        nodeRef=${ref}
        edges=${detail.edges}
        onOpen=${open}
        onRemove=${removeEdge}
      />`;
  } else if (loaded && selection.type === 'item') {
    body = html`<dl class="ss-props">
        <dt>${t('种类')}</dt>
        <dd>
          <span class="ss-kind" data-node-kind=${nodeKind('item', node.type)}
            ><${Lucide} name=${kindIcon(node.type)} />${kindLabel(node.type)} ·
            ${researchLabel(node.subtype)}</span
          >
        </dd>
        <dt>${t('状态')}</dt>
        <dd>${researchLabel(node.status)}${node.pinned ? ` · ${t('已置顶')}` : ''}</dd>
        <dt>${t('修订')}</dt>
        <dd>r${node.revision} · ${shortDate(node.updatedAt)}</dd>
      </dl>
      <div class="rb-card kb-item-body" data-rb-item-detail=${node.id}>
        <div
          class="rendered-markdown"
          dangerouslySetInnerHTML=${{ __html: renderMarkdown(node.body) }}
        ></div>
        <${ResearchPayload} item=${node} />
        ${node.supersededBy && html`<button type="button" class="ss-linkbtn" onClick=${() => onSelect({ type: 'item', id: node.supersededBy })}>${t('查看取代记录')}</button>`}
      </div>
      <${Connections}
        nodeRef=${ref}
        edges=${detail.edges}
        onOpen=${open}
        onRemove=${removeEdge}
      />`;
  } else if (loaded) {
    const changeLabels = (change) => actions.attempt(() => actions.knowledgeLabels(ref, change));
    body = html`<dl class="ss-props">
        <dt>${t('种类')}</dt>
        <dd>
          <span class="ss-kind" data-node-kind=${node.kind}
            ><${Lucide} name=${kindIcon(node.kind)} />${kindLabel(node.kind)}</span
          >
        </dd>
        ${
          node.nameEn &&
          html`<dt>${t('英文名')}</dt>
            <dd>${node.nameEn}</dd>`
        }
        ${
          node.aliases?.length > 0 &&
          html`<dt>${t('别名')}</dt>
            <dd>${node.aliases.join('、')}</dd>`
        }
        ${
          node.description &&
          html`<dt>${t('说明')}</dt>
            <dd class="kb-break">${node.description}</dd>`
        }
        <dt>${t('标签')}</dt>
        <dd>
          <${Labels} labels=${detail.labels.map((row) => row.label)} onChange=${changeLabels} />
        </dd>
        ${
          detail.memberships.length > 0 &&
          html`<dt>${t('项目')}</dt>
            <dd>
              ${detail.memberships
                .map(
                  (row) =>
                    projects.find((project) => project.id === row.projectId)?.name ?? row.projectId,
                )
                .join('、')}
            </dd>`
        }
        ${
          node.createdBy &&
          html`<dt>${t('来源')}</dt>
            <dd>
              ${
                node.createdBy.meetingId
                  ? html`<button
                      type="button"
                      class="ss-linkbtn"
                      onClick=${() =>
                        navigate({
                          view: 'meeting',
                          id: [node.createdBy.meetingId, node.createdBy.messageId]
                            .filter(Boolean)
                            .join('/'),
                        })}
                    >
                      ${addedBy(node.createdBy)}
                    </button>`
                  : addedBy(node.createdBy)
              }
            </dd>`
        }
      </dl>
      <${Connections} nodeRef=${ref} edges=${detail.edges} onOpen=${open} onRemove=${removeEdge} />
      <${History}
        rows=${detail.history}
        onRestore=${(row) =>
          actions.attempt(async () => {
            await actions.restoreKnowledgeRevision(row.id);
            actions.toast(t('已恢复到这一版'));
          })}
      />`;
  }
  return html`<${SidePanel}
    name="knowledge"
    title=${title || t('节点详情')}
    closeLabel="关闭详情"
    className="kb-panel"
    defaultWidth=${360}
    onClose=${onClose}
    buttons=${buttons}
  >
    <div class="ss-panel__body kb-panel__body" data-kb-panel=${ref}>
      ${error && html`<p role="alert">${error}</p>`}
      ${!loaded && !error && html`<p class="ss-muted" role="status">${t('正在读取…')}</p>`} ${body}
    </div>
  <//>`;
}
