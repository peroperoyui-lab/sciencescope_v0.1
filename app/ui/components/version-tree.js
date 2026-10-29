// The editing desk's version fork tree (U7, docs/architecture/EDITING_DESK.md
// §4.3): one document's versions growing top-down in the side panel, a filter,
// and the selected version's details. Right-click opens, edits from, compares,
// renames, re-tiers, marks or deletes a version. Description (标记) and key
// versions (重点) show once the server sends them (D10).
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { formatTime, t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { NODE, layoutVersions, pathToRoot } from '../version-layout.js';
import { ChoiceMenu } from './popover.js';
import { VersionNotesBox } from './version-notes-box.js';

const ORIGINS = {
  import: ['import', '导入'],
  desk: ['pencil', '编辑台'],
  external: ['file-pen', '外部修改'],
};
const originOf = (node) => ORIGINS[node.origin] ?? ['file', node.origin];

/** The tier's colour: the last tier is final, the first none, the others in between. */
function tierKind(tier, tiers) {
  if (!tier || tier === tiers[0]) return undefined;
  return tier === tiers.at(-1) ? 'final' : 'submit';
}

/** @param {any} node @param {string} words */
function matches(node, words) {
  if (!words) return true;
  const text = [
    node.displayTitle,
    node.label,
    node.branch,
    node.tier,
    node.description,
    node.notesExcerpt,
    ...(node.instructions ?? []),
    `v${node.number}`,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return text.includes(words.toLowerCase());
}

/**
 * @param {{ group: any, name: string, currentId: string | null, editing: boolean,
 *   canCompare: boolean, canEdit: string, onClose: () => void, onWiden: () => void,
 *   onOpen: (version: any) => void, onEdit: (version: any) => void,
 *   onCompare?: (left: string, right: string) => void, openLabel?: string, picker?: any,
 *   onReference?: (reference: any) => void,
 *   ask: (question: any) => Promise<string | null> }} props
 * `currentId` is the version open in the active tab (`editing` when it is being
 * edited); `canEdit` is why 从这一版开始编辑 is off, or ''. Outside the desk
 * (the workbench) `openLabel` names the one action, opening a version in the
 * desk, `picker` chooses the manuscript, and without `onCompare` there is no
 * comparing; `onReference` opens what a version note points to (main window only).
 */
export function VersionTree({
  group,
  name,
  currentId,
  editing,
  canCompare,
  canEdit,
  onClose,
  onWiden,
  onOpen,
  onEdit,
  onCompare,
  openLabel,
  picker,
  onReference,
  ask,
}) {
  const actions = useActions();
  const tiers = useAppState((state) => state.settings?.desk?.tiers ?? []);
  const refresh = useAppState((state) => state.versionsVersion);
  const [nodes, setNodes] = useState(/** @type {any[] | null} */ (null));
  const [selected, setSelected] = useState(/** @type {string | null} */ (null));
  const [filter, setFilter] = useState('');
  const [folded, setFolded] = useState(() => new Set());
  const [title, setTitle] = useState('');
  const [mark, setMark] = useState('');
  const scroller = useRef(/** @type {HTMLElement | null} */ (null));
  const nameInput = useRef(/** @type {HTMLInputElement | null} */ (null));
  const markInput = useRef(/** @type {HTMLTextAreaElement | null} */ (null));

  useEffect(() => {
    let active = true;
    actions
      .versionGraph(group.id)
      .then((graph) => active && setNodes(graph.nodes))
      .catch((failure) => active && actions.toast(failure.message));
    return () => {
      active = false;
    };
  }, [group.id, refresh]);
  // The open version is selected first, and kept in view.
  useEffect(() => setSelected(currentId), [group.id, currentId]);

  const node = nodes?.find((entry) => entry.id === selected) ?? null;
  const current = nodes?.find((entry) => entry.id === currentId) ?? null;
  useEffect(() => {
    setTitle(node?.displayTitle ?? '');
    setMark(node?.description ?? '');
  }, [node?.id, node?.displayTitle, node?.description]);
  // Marks and key versions need the server's D10 fields.
  const marks = !!nodes?.length && 'description' in nodes[0];

  if (!nodes)
    return html`<div class="ss-panel__body ss-desk-canvas__state">
      <span class="ss-spin"></span>
    </div>`;

  const layout = layoutVersions(nodes, folded);
  const path = pathToRoot(nodes, currentId);
  const words = filter.trim();
  const children = (id) => nodes.filter((entry) => entry.parentId === id);
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));

  /** @param {any} target @param {Record<string, any>} changes */
  async function update(target, changes) {
    try {
      await actions.updateVersion(target.id, changes);
      const graph = await actions.versionGraph(group.id);
      setNodes(graph.nodes);
    } catch (failure) {
      actions.toast(failure.message);
    }
  }
  // Read the box itself: a blur right after typing can come before the re-render.
  /** @param {FocusEvent} event */
  const saveTitle = (event) => {
    const next = /** @type {HTMLInputElement} */ (event.currentTarget).value.trim();
    if (node && next && next !== node.displayTitle) void update(node, { title: next });
    else setTitle(node?.displayTitle ?? '');
  };
  /** @param {FocusEvent} event */
  const saveMark = (event) => {
    const value = /** @type {HTMLTextAreaElement} */ (event.currentTarget).value;
    if (node && value.trim() !== (node.description ?? ''))
      void update(node, { description: value });
  };

  async function remove(target) {
    const choice = await ask({
      title: t('删除 v{n}？', { n: target.number }),
      text: t('这一版的文件和版本说明会移到回收站，版本树里不再显示。'),
      options: [
        { value: 'cancel', label: t('取消') },
        { value: 'delete', label: t('删除'), primary: true },
      ],
    });
    if (choice !== 'delete') return;
    try {
      await actions.deleteVersion(target.id);
      setSelected(target.parentId ?? null);
      const graph = await actions.versionGraph(group.id);
      setNodes(graph.nodes);
    } catch (failure) {
      actions.toast(failure.message);
    }
  }

  const compareLabel = (target) =>
    current && target.id !== current.id
      ? t('和 v{n} 比较', { n: current.number })
      : t('和当前版本比较');
  const compareOff = (target) => !canCompare || !current || target.id === current.id;

  /** @param {MouseEvent} event @param {any} target */
  function menu(event, target) {
    setSelected(target.id);
    const kids = children(target.id).length;
    const deleteOff = kids > 0 || target.id === currentId;
    actions.openMenu(
      event,
      [
        ...(openLabel
          ? [
              {
                text: canEdit ? `${openLabel}（${canEdit}）` : openLabel,
                icon: 'file-pen',
                disabled: !!canEdit,
                run: () => onOpen(target),
              },
            ]
          : [
              { text: t('打开（只读）'), icon: 'eye', run: () => onOpen(target) },
              {
                text: canEdit ? `${t('从这一版开始编辑')}（${canEdit}）` : t('从这一版开始编辑'),
                icon: 'pencil',
                disabled: !!canEdit,
                run: () => onEdit(target),
              },
            ]),
        ...(onCompare
          ? [
              {
                text: compareLabel(target),
                icon: 'git-compare',
                disabled: compareOff(target),
                run: () => onCompare(target.id, /** @type {any} */ (current).id),
              },
            ]
          : []),
        { sep: true },
        {
          text: t('改名'),
          icon: 'pencil',
          run: () => requestAnimationFrame(() => nameInput.current?.select()),
        },
        {
          text: t('层级…'),
          icon: 'tag',
          run: () =>
            requestAnimationFrame(() =>
              /** @type {HTMLElement | null | undefined} */ (
                scroller.current?.parentElement?.parentElement?.querySelector('[data-tier-pick]')
              )?.click(),
            ),
        },
        ...(marks
          ? [
              {
                text: t('标记…'),
                icon: 'tag',
                run: () => requestAnimationFrame(() => markInput.current?.focus()),
              },
              {
                text: target.key ? t('取消重点') : t('设为重点'),
                icon: 'star',
                run: () => update(target, { key: !target.key }),
              },
            ]
          : []),
        { sep: true },
        {
          text: t('打开原件'),
          icon: 'external-link',
          run: () => actions.attempt(() => actions.openVersion(target.id)),
        },
        {
          text: t('在资源管理器定位'),
          icon: 'folder-open',
          run: () => actions.attempt(() => actions.openVersion(target.id, true)),
        },
        { sep: true },
        {
          text: deleteOff
            ? `${t('删除这一版')}（${kids > 0 ? t('有后续版本，不能删') : t('正在打开，不能删')}）`
            : t('删除这一版'),
          icon: 'trash-2',
          danger: true,
          disabled: deleteOff,
          run: () => remove(target),
        },
      ],
      t('版本'),
    );
  }

  const meta = (entry) => {
    if (entry.id === currentId)
      return html`<${Lucide} name="pencil" />${editing ? t('正在编辑') : t('正在看')}`;
    // A mark (标记) says more than the date, so it takes the line.
    if (entry.description)
      return html`<${Lucide} name="tag" /><span class="ss-truncate">${entry.description}</span>`;
    const [icon, origin] = originOf(entry);
    return html`<${Lucide} name=${icon} />${entry.createdAt.slice(5, 10)} ·
      ${entry.tier || t(origin)}`;
  };

  const parent = node?.parentId ? byId.get(node.parentId) : null;
  const kids = node ? children(node.id) : [];
  return html`<div class="ss-panel__head">
      <${Lucide} name="git-fork" />
      <span class="ss-panel__title ss-truncate ss-vtree__title"
        >${picker ? t('版本树') : `${t('版本树')} · ${name}`}</span
      >
      <button
        type="button"
        class="ss-icon-btn"
        aria-label=${t('拉宽')}
        data-tip=${t('拉宽')}
        onClick=${onWiden}
      >
        <${Lucide} name="maximize-2" />
      </button>
      <button
        type="button"
        class="ss-icon-btn"
        aria-label=${t('关闭版本树')}
        data-tip=${t('关闭版本树')}
        onClick=${onClose}
      >
        <${Lucide} name="x" />
      </button>
    </div>
    <div class="ss-toolbar ss-vtree__filter">
      ${picker}
      <span class="ss-input ss-input--sm">
        <${Lucide} name="search" />
        <input
          type="search"
          aria-label=${t('筛选版本')}
          placeholder=${picker ? t('筛选版本') : t('按标题、标签、备注、修改指令筛选')}
          value=${filter}
          onInput=${(event) => setFilter(event.currentTarget.value)}
        />
      </span>
    </div>
    <div class="ss-vtree__wrap">
      <div class="ss-vtree" ref=${scroller} role="tree" aria-label=${t('版本')}>
        <div
          class="ss-vtree__canvas"
          style=${{ width: `${layout.width}px`, height: `${layout.height + 40}px` }}
        >
          <svg
            class="ss-vtree__links"
            width=${layout.width}
            height=${layout.height}
            aria-hidden="true"
          >
            ${layout.links.map(
              (link) =>
                html`<path
                  key=${link.to}
                  d=${link.d}
                  data-on=${path.has(link.to) && path.has(link.from) ? '' : undefined}
                />`,
            )}
            ${layout.folds.map(
              (fold) =>
                html`<path
                  key=${`f${fold.id}`}
                  d=${`M${fold.x + NODE.width} ${fold.y + NODE.height / 2 + fold.lane * 8}h30`}
                />`,
            )}
          </svg>
          ${layout.placed.map(
            ({ node: entry, x, y }) =>
              html`<button
                key=${entry.id}
                type="button"
                class="ss-vnode"
                role="treeitem"
                style=${{ left: `${x}px`, top: `${y}px` }}
                aria-selected=${String(entry.id === selected)}
                data-current=${entry.id === currentId ? '' : undefined}
                data-tier=${tierKind(entry.tier, tiers)}
                data-origin=${entry.origin === 'external' ? 'external' : undefined}
                data-key=${entry.key ? '' : undefined}
                data-dim=${matches(entry, words) ? undefined : ''}
                data-tip=${entry.description || undefined}
                onClick=${() => setSelected(entry.id)}
                onDblClick=${() => onOpen(entry)}
                onContextMenu=${(event) => menu(event, entry)}
              >
                <span class="ss-vnode__top">
                  <span class="ss-vnode__v">v${entry.number}</span>
                  <span class="ss-vnode__title">${entry.displayTitle}</span>
                  ${entry.key && html`<${Lucide} name="star" small />`}
                </span>
                <span class="ss-vnode__meta">${meta(entry)}</span>
              </button>`,
          )}
          ${layout.branches.map(
            (branch) =>
              html`<button
                key=${`b${branch.id}`}
                type="button"
                class="ss-vbranch"
                style=${{
                  left: `${branch.x + NODE.width + 34}px`,
                  top: `${branch.y + NODE.height / 2 + branch.lane * 8 - 10}px`,
                }}
                data-tip=${t('收起这一枝')}
                onClick=${() => setFolded(new Set([...folded, branch.id]))}
              >
                <${Lucide} name="git-branch" small />${branch.name || t('未命名分支')}
              </button>`,
          )}
          ${layout.folds.map(
            (fold) =>
              html`<button
                key=${`f${fold.id}`}
                type="button"
                class="ss-vfold"
                style=${{
                  left: `${fold.x + NODE.width + 30}px`,
                  top: `${fold.y + NODE.height / 2 + fold.lane * 8 - 9}px`,
                }}
                data-tip=${t('展开这一枝')}
                onClick=${() => setFolded(new Set([...folded].filter((id) => id !== fold.id)))}
              >
                ${t('{name} · {n} 版', { name: fold.name || t('分支'), n: fold.count })}
                <${Lucide} name="chevron-down" small />
              </button>`,
          )}
        </div>
      </div>
      <div class="ss-vtree__legend">
        ${
          tiers.length > 1 &&
          html`<span><i data-tier="final"></i>${tiers.at(-1)}</span>
            ${tiers.length > 2 && html`<span><i data-tier="submit"></i>${t('其他层级')}</span>`}`
        }
        <span><${Lucide} name="file-pen" small />${t('虚线：外部修改')}</span>
        <span><span class="ss-dot ss-dot--ok"></span>${editing ? t('正在编辑') : t('正在看')}</span>
      </div>
    </div>
    ${
      node &&
      html`<div class="ss-vtree__detail">
        <div class="ss-vtree__fields">
          <span class="ss-input ss-input--sm">
            <span class="ss-mono ss-muted">v${node.number}</span>
            <input
              ref=${nameInput}
              aria-label=${t('版本名称')}
              value=${title}
              onInput=${(event) => setTitle(event.currentTarget.value)}
              onBlur=${saveTitle}
              onKeyDown=${(event) => {
                if (event.key === 'Enter' && !event.isComposing) event.currentTarget.blur();
                if (event.key === 'Escape') {
                  setTitle(node.displayTitle);
                  requestAnimationFrame(() => event.currentTarget?.blur());
                }
              }}
            />
          </span>
          <dl class="ss-props">
            <dt>${t('层级')}</dt>
            <dd>
              <${ChoiceMenu}
                label=${t('层级')}
                triggerClass="ss-select ss-select--sm"
                placement="bottom-start"
                attrs=${{ 'data-tier-pick': '' }}
                items=${[
                  { text: t('不标'), selected: !node.tier, run: () => update(node, { tier: '' }) },
                  ...tiers.map((tier) => ({
                    text: tier,
                    selected: node.tier === tier,
                    run: () => update(node, { tier }),
                  })),
                ]}
              >
                <span class="ss-select__value">${node.tier || t('不标')}</span>
              <//>
            </dd>
            <dt>${t('分支')}</dt>
            <dd>${node.branch || t('主线')}</dd>
            <dt>${t('来自')}</dt>
            <dd>${t(originOf(node)[1])} · ${formatTime(node.createdAt)}</dd>
            <dt>${t('派生')}</dt>
            <dd>
              ${parent ? t('父 v{n}', { n: parent.number }) : t('最早的一版')}${
                kids.length > 0 &&
                ` · ${t('子 {list}', { list: kids.map((kid) => `v${kid.number}`).join('、') })}`
              }
            </dd>
            ${
              node.instructions?.length > 0 &&
              html`<dt>${t('修改指令')}</dt>
                <dd class="ss-truncate">${node.instructions.slice(0, 3).join('；')}</dd>`
            }
          </dl>
          ${
            marks &&
            html`<label class="ss-field ss-vtree__mark">
              <span class="ss-field__label">${t('标记')}</span>
              <textarea
                ref=${markInput}
                class="ss-textarea"
                rows="2"
                placeholder=${t('给这一版写一句说明，例如「导师看过的版本」')}
                value=${mark}
                onInput=${(event) => setMark(event.currentTarget.value)}
                onBlur=${saveMark}
              ></textarea>
            </label>`
          }
          <${VersionNotesBox}
            key=${node.id}
            versionId=${node.id}
            projectId=${group.projectId}
            onReference=${onReference}
          />
        </div>
        <div class="ss-vtree__actions">
          <button
            type="button"
            class="ss-btn ss-btn--sm"
            disabled=${!!canEdit}
            data-tip=${canEdit || undefined}
            onClick=${() => (openLabel ? onOpen(node) : onEdit(node))}
          >
            ${
              openLabel
                ? html`<${Lucide} name="file-pen" />${openLabel}`
                : html`<${Lucide} name="pencil" />${t('从这一版开始编辑')}`
            }
          </button>
          ${
            onCompare &&
            html`<button
              type="button"
              class="ss-btn ss-btn--sm ss-btn--ghost"
              disabled=${compareOff(node)}
              onClick=${() => onCompare(node.id, /** @type {any} */ (current).id)}
            >
              <${Lucide} name="git-compare" />${compareLabel(node)}
            </button>`
          }
        </div>
      </div>`
    }`;
}
