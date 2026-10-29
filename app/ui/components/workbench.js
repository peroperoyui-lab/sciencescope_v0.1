// A project's workbench (design system PageWorkbench): plan cards across all
// projects and this project's log as two strips, then the research map preview
// and the project folder. 版本树 opens the desk's version tree on the right for
// any of the project's manuscripts. Every edit is a workspace edit, retained in
// resource snapshots when an editing page is left.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { Illustration } from '../illustrations.js';
import { openDesk } from '../desk-window.js';
import { renderMarkdown } from '../markdown.js';
import { useSnapshotCapture } from '../resource-snapshots.js';
import { openResourceHistory } from './resource-history.js';
import { navigate } from '../route.js';
import {
  appendPlan,
  logEntryText,
  parseLog,
  parsePlans,
  removeLogEntry,
  replacePlan,
} from '../workbench-text.js';
import { Dialog, useQuestion } from './dialog.js';
import { JOURNAL_TABS } from './journal-entry.js';
import { MapCanvas } from './map-canvas.js';
import { ChoiceMenu } from './popover.js';
import { ProjectFolder } from './project-folder.js';
import { SidePanel } from './side-panel.js';
import { VersionTree } from './version-tree.js';
import { openVersionImport } from './version-import.js';
import { openVersionReference } from './version-notes-box.js';
import { openVersionCompare } from './version-compare-dialog.js';
import { FieldForm } from './overlays.js';

/**
 * Read resources and re-read them whenever the workspace changes.
 * @param {Array<[string, string]>} targets [resource, key] pairs
 */
function useResources(targets) {
  const actions = useActions();
  const version = useAppState((state) => state.workspaceVersion);
  const [results, setResults] = useState(/** @type {any[]} */ ([]));
  const signature = JSON.stringify(targets);
  useEffect(() => {
    let current = true;
    Promise.all(
      targets.map(([resource, key]) => actions.readResource(resource, key).catch(() => null)),
    ).then((values) => current && setResults(values));
    return () => {
      current = false;
    };
  }, [signature, version]);
  return results;
}

/** `10-24`, from an ISO date. @param {string} date */
const short = (date) => date.slice(5, 10);

/** A log entry's body as one line of plain text for its card. @param {string} body */
const plain = (body) =>
  body
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:#+|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Add or edit a plan: title, an optional note and deadline, and which project
 * (or 全局) it belongs to. Moving it to another owner moves its lines.
 * @param {{ plan?: any, projectId: string, projects: any[], onClose: () => void }} props
 */
function PlanDialog({ plan, projectId, projects, onClose }) {
  const actions = useActions();
  const [title, setTitle] = useState(plan?.text ?? '');
  const [note, setNote] = useState(plan?.note ?? '');
  const [due, setDue] = useState(plan?.due ?? '');
  const [key, setKey] = useState(plan?.key ?? projectId);
  const owners = [
    ...projects.map((project) => ({ key: project.id, name: project.name })),
    { key: 'global', name: t('全局计划') },
  ];
  const save = () =>
    actions.attempt(async () => {
      if (!title.trim()) return;
      const item = { done: plan?.done ?? false, text: title.trim(), note, due };
      onClose();
      if (plan && plan.key === key) {
        await actions.editResource('plans', key, 'write', {
          text: replacePlan(plan.file.text, plan, item),
        });
        return;
      }
      const current = (await actions.readResource('plans', key)).text ?? '';
      await actions.editResource('plans', key, 'write', { text: appendPlan(current, item) });
      if (plan)
        await actions.editResource('plans', plan.key, 'write', {
          text: replacePlan(plan.file.text, plan, null),
        });
    });
  return html`<${Dialog}
    title=${plan ? t('编辑计划') : t('添加计划')}
    onClose=${onClose}
    onSubmit=${save}
    foot=${html`<button type="button" class="ss-btn" onClick=${onClose}>${t('取消')}</button>
      <button type="submit" class="ss-btn ss-btn--primary" disabled=${!title.trim()}>
        ${plan ? t('保存') : t('添加')}
      </button>`}
  >
    <div class="ss-stack">
      <label class="ss-field">
        <span class="ss-field__label">${t('计划内容')}</span>
        <span class="ss-input">
          <input value=${title} onInput=${(event) => setTitle(event.currentTarget.value)} />
        </span>
      </label>
      <label class="ss-field">
        <span class="ss-field__label">${t('说明（可选）')}</span>
        <textarea
          class="ss-textarea"
          rows="2"
          value=${note}
          onInput=${(event) => setNote(event.currentTarget.value)}
        ></textarea>
      </label>
      <div class="ss-row ss-wb__plan-fields">
        <label class="ss-field">
          <span class="ss-field__label">${t('期限（可选）')}</span>
          <span class="ss-input">
            <input
              type="date"
              value=${due}
              onInput=${(event) => setDue(event.currentTarget.value)}
            />
          </span>
        </label>
        <div class="ss-field">
          <span class="ss-field__label">${t('归属')}</span>
          <${ChoiceMenu}
            label=${t('归属')}
            triggerClass="ss-select"
            placement="bottom-start"
            items=${owners.map((owner) => ({
              text: owner.name,
              selected: owner.key === key,
              run: () => setKey(owner.key),
            }))}
          >
            <span class="ss-select__value">
              ${owners.find((owner) => owner.key === key)?.name ?? key}
            </span>
          <//>
        </div>
      </div>
    </div>
  <//>`;
}

/** @param {{ projectId: string, onClose: () => void }} props */
function LogDialog({ projectId, onClose }) {
  const actions = useActions();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const save = () =>
    actions.attempt(async () => {
      if (!title.trim()) return;
      onClose();
      const date = new Date().toISOString().slice(0, 10);
      await actions.editResource('log', projectId, 'append', {
        text: logEntryText(title.trim(), body.trim(), date),
      });
    });
  return html`<${Dialog}
    title=${t('添加日志')}
    onClose=${onClose}
    onSubmit=${save}
    foot=${html`<button type="button" class="ss-btn" onClick=${onClose}>${t('取消')}</button>
      <button type="submit" class="ss-btn ss-btn--primary" disabled=${!title.trim()}>
        ${t('添加')}
      </button>`}
  >
    <div class="ss-stack">
      <label class="ss-field">
        <span class="ss-field__label">${t('标题')}</span>
        <span class="ss-input">
          <input value=${title} onInput=${(event) => setTitle(event.currentTarget.value)} />
        </span>
      </label>
      <label class="ss-field">
        <span class="ss-field__label">${t('日志详情')}</span>
        <textarea
          class="ss-textarea"
          rows="4"
          value=${body}
          onInput=${(event) => setBody(event.currentTarget.value)}
        ></textarea>
      </label>
    </div>
  <//>`;
}

/**
 * A strip's heading: title, count, 添加 and 查看全部.
 * @param {{ title: string, count: number, addLabel: string, onAdd: () => void, onAll: () => void }} props
 */
function BlockHead({ title, count, addLabel, onAdd, onAll }) {
  return html`<div class="ss-block-head">
    <span class="ss-block-head__title">${title}</span>
    <span class="ss-count">${count}</span>
    <span class="ss-block-head__end">
      <button
        type="button"
        class="ss-icon-btn ss-icon-btn--sm"
        aria-label=${addLabel}
        data-tip=${addLabel}
        onClick=${onAdd}
      >
        <${Lucide} name="plus" />
      </button>
      <button type="button" class="ss-btn ss-btn--ghost ss-btn--sm" onClick=${onAll}>
        ${t('查看全部')}<${Lucide} name="chevron-right" />
      </button>
    </span>
  </div>`;
}

/**
 * Plans of every project plus the global plans: a strip on the workbench, or
 * the full page (`full`, 查看全部).
 * @param {{ project: any, projects: any[], full?: boolean }} props
 */
export function PlanStrip({ project, projects, full = false }) {
  const actions = useActions();
  const keys = ['global', ...projects.map((p) => p.id)];
  const files = useResources(keys.map((key) => ['plans', key]));
  useSnapshotCapture(keys.map((key) => ['plans', key]));
  const [dialog, setDialog] = useState(/** @type {{ plan?: any } | null} */ (null));
  const history = () => openResourceHistory(actions, { projectId: project.id, resource: 'plans' });
  const scopeName = (key) =>
    key === 'global' ? t('全局计划') : (projects.find((p) => p.id === key)?.name ?? key);

  const cards = keys.flatMap((key, index) =>
    parsePlans(files[index]?.text ?? '').map((item) => ({ ...item, key, file: files[index] })),
  );
  // Open plans first, this project's before the rest; done ones last.
  cards.sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      Number(b.key === project.id) - Number(a.key === project.id),
  );

  const save = (card, item) =>
    actions.attempt(() =>
      actions.editResource('plans', card.key, 'write', {
        text: replacePlan(card.file.text, card, item),
      }),
    );
  const toggle = (card) => save(card, { ...card, done: !card.done });
  const menu = (event, card) =>
    actions.openMenu(
      event,
      [
        { text: t('编辑计划'), icon: 'pencil', run: () => setDialog({ plan: card }) },
        {
          text: card.done ? t('标为未完成') : t('标为完成'),
          icon: 'circle-check',
          run: () => toggle(card),
        },
        { text: t('改归属…'), icon: 'folder', run: () => setDialog({ plan: card }) },
        { sep: true },
        { text: t('删除'), icon: 'trash-2', danger: true, run: () => save(card, null) },
      ],
      card.text,
    );

  const cardList = cards.map(
    (card) =>
      html`<div
        key=${`${card.key}:${card.line}`}
        class=${`ss-note-card ${card.done ? 'ss-note-card--done' : ''}`}
        role="button"
        tabindex="0"
        aria-label=${card.text}
        onClick=${() => setDialog({ plan: card })}
        onKeyDown=${(event) => event.key === 'Enter' && setDialog({ plan: card })}
        onContextMenu=${(event) => menu(event, card)}
      >
        <span class="ss-note-card__top">
          <label class="ss-check" onClick=${(event) => event.stopPropagation()}>
            <input
              type="checkbox"
              aria-label=${t('切换完成状态')}
              checked=${card.done}
              onChange=${() => toggle(card)}
            />
          </label>
          <span class="ss-note-card__title" title=${card.text}>${card.text}</span>
        </span>
        ${card.note && html`<span class="ss-note-card__text">${card.note}</span>`}
        <span class="ss-note-card__meta">
          <span class="ss-tag">${scopeName(card.key)}</span>
          ${card.due && html`<span>${t('{date} 前', { date: short(card.due) })}</span>`}
        </span>
      </div>`,
  );
  const form =
    dialog &&
    html`<${PlanDialog}
      plan=${dialog.plan}
      projectId=${project.id}
      projects=${projects}
      onClose=${() => setDialog(null)}
    />`;

  if (full) {
    return html`<div class="ss-content">
      <div class="ss-wb ss-wb--page">
        <div class="ss-block-head">
          <span class="ss-block-head__title">${t('所有项目的计划')}</span>
          <span class="ss-count">${cards.length}</span>
          <span class="ss-block-head__end">
            <button type="button" class="ss-btn ss-btn--ghost ss-btn--sm" onClick=${history}>
              <${Lucide} name="history" />${t('历史版本')}
            </button>
            <button
              type="button"
              class="ss-btn ss-btn--primary ss-btn--sm"
              onClick=${() => setDialog({})}
            >
              <${Lucide} name="plus" />${t('添加计划')}
            </button>
          </span>
        </div>
        <div class="ss-wb__grid">${cardList}</div>
        ${!cards.length && html`<p class="ss-wb__empty">${t('暂无计划')}</p>`}
      </div>
      ${form}
    </div>`;
  }
  return html`<section aria-label=${t('全局计划')}>
    <${BlockHead}
      title=${t('全局计划')}
      count=${cards.length}
      addLabel=${t('添加计划')}
      onAdd=${() => setDialog({})}
      onAll=${() => navigate({ view: 'plans', id: project.id })}
    />
    <div class="ss-wb__strip">
      ${cardList}
      ${
        !cards.length &&
        html`<p class="ss-wb__empty">
          ${t('还没有计划。点 + 添加一条，所有项目的计划都列在这里。')}
        </p>`
      }
    </div>
    ${form}
  </section>`;
}

/**
 * This project's log: cards on the workbench, or the full page (`full`).
 * @param {{ project: any, full?: boolean }} props
 */
export function JournalStrip({ project, full = false }) {
  const actions = useActions();
  const [file] = useResources([['log', project.id]]);
  useSnapshotCapture([['log', project.id]]);
  const [adding, setAdding] = useState(false);
  const history = () => openResourceHistory(actions, { projectId: project.id, resource: 'log' });
  const entries = parseLog(file?.text ?? '');
  const details = (entry, initial = '日志详情') =>
    navigate({
      view: 'journal-entry',
      id: `${project.id}/${entry.start}/${JOURNAL_TABS.indexOf(initial)}`,
    });
  const menu = (event, entry) =>
    actions.openMenu(
      event,
      [
        { text: t('日志详情'), icon: 'file-text', run: () => details(entry) },
        { text: t('文件列表'), icon: 'paperclip', run: () => details(entry, '文件列表') },
        { sep: true },
        {
          text: t('删除'),
          icon: 'trash-2',
          danger: true,
          run: () =>
            actions.attempt(() =>
              actions.editResource('log', project.id, 'write', {
                text: removeLogEntry(file.text, entry),
              }),
            ),
        },
      ],
      entry.title,
    );
  const form =
    adding && html`<${LogDialog} projectId=${project.id} onClose=${() => setAdding(false)} />`;

  if (full) {
    return html`<div class="ss-content">
      <div class="ss-doc">
        <div class="ss-block-head">
          <span class="ss-block-head__title">${t('项目日志')}</span>
          <span class="ss-count">${entries.length}</span>
          <span class="ss-block-head__end">
            <button type="button" class="ss-btn ss-btn--ghost ss-btn--sm" onClick=${history}>
              <${Lucide} name="history" />${t('历史版本')}
            </button>
            <button
              type="button"
              class="ss-btn ss-btn--primary ss-btn--sm"
              onClick=${() => setAdding(true)}
            >
              <${Lucide} name="plus" />${t('添加日志')}
            </button>
          </span>
        </div>
        <div class="ss-journal-list">
          ${entries.map(
            (entry) =>
              html`<article
                class="ss-journal-list__entry"
                key=${entry.start}
                aria-label=${entry.title}
                onContextMenu=${(event) => menu(event, entry)}
              >
                <div class="ss-journal-list__head">
                  <button
                    type="button"
                    class="ss-journal-list__title ss-truncate"
                    onClick=${() => details(entry)}
                  >
                    ${entry.title}
                  </button>
                  ${entry.date && html`<span class="ss-muted">${entry.date}</span>`}
                  <button
                    type="button"
                    class="ss-btn ss-btn--ghost ss-btn--sm"
                    onClick=${() => details(entry, '文件列表')}
                  >
                    <${Lucide} name="paperclip" />${t('文件列表')} ${entry.references.length}
                  </button>
                  <button
                    type="button"
                    class="ss-icon-btn ss-icon-btn--sm"
                    aria-label=${t('日志菜单')}
                    data-tip=${t('日志菜单')}
                    onClick=${(event) => menu(event, entry)}
                  >
                    <${Lucide} name="ellipsis" />
                  </button>
                </div>
                <div
                  class="ss-prose"
                  dangerouslySetInnerHTML=${{ __html: renderMarkdown(entry.body || t('没有详细内容。')) }}
                ></div>
              </article>`,
          )}
        </div>
        ${!entries.length && html`<p class="ss-wb__empty">${t('暂无项目日志')}</p>`}
      </div>
      ${form}
    </div>`;
  }
  return html`<section aria-label=${t('本项目日志')}>
    <${BlockHead}
      title=${t('本项目日志')}
      count=${entries.length}
      addLabel=${t('添加日志')}
      onAdd=${() => setAdding(true)}
      onAll=${() => navigate({ view: 'journal', id: project.id })}
    />
    <div class="ss-wb__strip">
      ${entries.map((entry) => {
        const text = plain(entry.body);
        const files = entry.references.length;
        return html`<div
          key=${entry.start}
          class="ss-note-card"
          role="button"
          tabindex="0"
          aria-label=${entry.title}
          onClick=${() => details(entry)}
          onKeyDown=${(event) => event.key === 'Enter' && details(entry)}
          onContextMenu=${(event) => menu(event, entry)}
        >
          <span class="ss-note-card__top">
            <span class="ss-note-card__title" title=${entry.title}>${entry.title}</span>
          </span>
          ${text && html`<span class="ss-note-card__text">${text}</span>`}
          <span class="ss-note-card__meta">
            ${entry.date && html`<span>${short(entry.date)}</span>`}
            ${
              files > 0 &&
              html`<span
                ><${Lucide} name="paperclip" small />${t('{n} 个文件', { n: files })}</span
              >`
            }
          </span>
        </div>`;
      })}
      ${
        !entries.length &&
        html`<p class="ss-wb__empty">
          ${t('还没有日志。完成一个关键节点时记一条，秘书也会在对话后补上。')}
        </p>`
      }
    </div>
    ${form}
  </section>`;
}

/** The workbench's map preview: a click opens that node on the map page. @param {{ project: any }} props */
function ResearchMap({ project }) {
  const [file] = useResources([['map', project.id]]);
  useSnapshotCapture([['map', project.id]]);
  return html`<div class="ss-box-card">
    <div class="ss-box-card__head">
      <span>${t('研究框架与进展')}</span>
      <span class="ss-tag">${t('预览')}</span>
      <button
        type="button"
        class="ss-icon-btn"
        aria-label=${t('打开研究导图')}
        data-tip=${t('打开研究导图')}
        onClick=${() => navigate({ view: 'map', id: project.id })}
      >
        <${Lucide} name="maximize-2" />
      </button>
    </div>
    <div class="ss-wb__map">
      <${MapCanvas}
        nodes=${file?.value?.nodes ?? []}
        edges=${file?.value?.edges ?? []}
        preview
        onOpen=${(node) => navigate({ view: 'map', id: `${project.id}/${node.id}` })}
      />
    </div>
  </div>`;
}

/** The latest version's time in a group, for picking the manuscript worked on last. */
const touched = (group) => group.versions?.[0]?.createdAt ?? group.createdAt ?? '';

/**
 * The project's manuscripts in the desk's version tree, with a picker for which
 * one. 在编辑台打开这一版 opens that version in the desk; 导入 adds files from
 * outside as versions.
 * @param {{ project: any, focusId?: string | null, onClose: () => void }} props
 * `focusId` is a version to show first (a quoted 版本说明 opened from a chat).
 */
function WorkbenchVersions({ project, focusId = null, onClose }) {
  const actions = useActions();
  const refresh = useAppState((state) => state.versionsVersion);
  const [groups, setGroups] = useState(/** @type {any[] | null} */ (null));
  const [groupId, setGroupId] = useState(/** @type {string | null} */ (null));
  const [question, ask] = useQuestion();
  const fileInput = useRef(/** @type {HTMLInputElement | null} */ (null));
  /** @param {FileList | null | undefined} files */
  const importFiles = (files) =>
    openVersionImport(actions, {
      projectId: project.id,
      groups: groups ?? [],
      files: Array.from(files ?? []),
      groupId,
    });
  const importButton = html`<button
    type="button"
    class="ss-icon-btn ss-icon-btn--sm"
    aria-label=${t('导入文件为版本')}
    data-tip=${t('导入文件为版本')}
    onClick=${() => fileInput.current?.click()}
  >
    <${Lucide} name="plus" />
  </button>`;
  useEffect(() => {
    let active = true;
    actions
      .versionGroups(project.id)
      .then((list) => {
        if (!active) return;
        const sorted = [...list].sort((a, b) => touched(b).localeCompare(touched(a)));
        setGroups(sorted);
        const focused = focusId
          ? sorted.find((group) => group.versions?.some((version) => version.id === focusId))
          : null;
        setGroupId((current) =>
          focused
            ? focused.id
            : sorted.some((group) => group.id === current)
              ? current
              : (sorted[0]?.id ?? null),
        );
      })
      .catch((failure) => active && actions.toast(failure.message));
    return () => {
      active = false;
    };
  }, [project.id, refresh, focusId]);
  const group = groups?.find((entry) => entry.id === groupId) ?? null;
  const name = (entry) => entry.sourcePath ?? entry.name;
  const choice =
    groups &&
    groups.length > 0 &&
    html`<${ChoiceMenu}
      label=${t('文稿')}
      triggerClass="ss-select ss-select--sm ss-vtree__pick"
      placement="bottom-start"
      items=${groups.map((entry) => ({
        text: name(entry),
        selected: entry.id === groupId,
        run: () => setGroupId(entry.id),
      }))}
    >
      <span class="ss-select__value ss-truncate">${group ? name(group) : ''}</span>
    <//>`;
  const renameButton =
    group &&
    html`<button
      type="button"
      class="ss-icon-btn ss-icon-btn--sm"
      aria-label=${t('重命名版本组')}
      data-tip=${t('重命名版本组')}
      onClick=${() =>
        actions.openModal(
          t('重命名版本组'),
          html`<${FieldForm}
            label=${t('版本组名称')}
            value=${group.name}
            submitText=${t('保存')}
            onSubmit=${(next) => actions.renameVersionGroup(group.id, next)}
          />`,
        )}
    >
      <${Lucide} name="pencil" />
    </button>`;
  const picker = choice && html`${choice}${renameButton}${importButton}`;
  const open = (node) =>
    actions.attempt(() =>
      openDesk({
        projectId: project.id,
        versionId: node.id,
        name: group?.versions?.find((entry) => entry.id === node.id)?.name ?? group?.name,
        group: group?.name,
      }),
    );
  return html`<${SidePanel}
    name="versions"
    title=${t('版本树')}
    closeLabel=${t('关闭版本树')}
    onClose=${onClose}
    bare
  >
    <input
      ref=${fileInput}
      type="file"
      multiple
      hidden
      data-version-import
      onChange=${(event) => {
        importFiles(event.currentTarget.files);
        event.currentTarget.value = '';
      }}
    />
    <div
      class="ss-contents"
      onDragOver=${(event) => event.preventDefault()}
      onDrop=${(event) => {
        event.preventDefault();
        importFiles(event.dataTransfer?.files);
      }}
    >
      ${
        group
          ? html`<${VersionTree}
              key=${group.id}
              group=${group}
              name=${group.name}
              currentId=${null}
              editing=${false}
              canCompare=${true}
              canEdit=""
              openLabel=${t('在编辑台打开这一版')}
              picker=${picker}
              onClose=${onClose}
              onWiden=${() =>
                actions.attempt(() =>
                  actions.updateSettings({ appearance: { panels: { versions: 560 } } }),
                )}
              onOpen=${open}
              onEdit=${open}
              onReference=${(reference) => openVersionReference(actions, reference, project.id)}
              onPreview=${(node) =>
                actions.openPreview({ kind: 'version', id: node.id, projectId: project.id })}
              onCompare=${(left, right) =>
                openVersionCompare(actions, { versions: group.versions ?? [], left, right })}
              focusId=${focusId}
              ask=${ask}
            />`
          : html`<div class="ss-panel__head">
                <${Lucide} name="git-fork" />
                <span class="ss-panel__title">${t('版本树')}</span>
                <span class="ss-titlebar__spacer"></span>
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
              <div class="ss-panel__body">
                ${
                  groups
                    ? html`<div class="ss-empty">
                        <${Illustration} name="versions" />
                        <div class="ss-empty__title">${t('还没有文稿版本')}</div>
                        <div class="ss-empty__text">
                          ${t('在编辑台打开项目里的 docx、tex、md 或 pdf，保存时就会留下版本。')}
                        </div>
                        <div class="ss-empty__actions">
                          <button
                            type="button"
                            class="ss-btn ss-btn--sm"
                            onClick=${() => fileInput.current?.click()}
                          >
                            <${Lucide} name="plus" />${t('导入文件为版本')}
                          </button>
                        </div>
                      </div>`
                    : html`<div class="ss-desk-canvas__state"><span class="ss-spin"></span></div>`
                }
              </div>`
      }
    </div>
    ${question}
  <//>`;
}

/** @param {{ projectId: string }} props */
export function Workbench({ projectId }) {
  const actions = useActions();
  const projects = useAppState((state) => state.projects);
  const [versions, setVersions] = useState(false);
  const [focusVersion, setFocusVersion] = useState(/** @type {string | null} */ (null));
  const versionRequest = useAppState((state) => state.versionRequest);
  useEffect(() => {
    if (!versionRequest || versionRequest.projectId !== projectId) return;
    setFocusVersion(versionRequest.versionId);
    setVersions(true);
    actions.consumeVersionRequest();
  }, [versionRequest, projectId]);
  const project = projects.find((p) => p.id === projectId);
  if (!project) {
    return html`<main class="ss-main">
      <div class="ss-empty">${t('找不到这个项目。')}</div>
    </main>`;
  }
  const active = projects.filter((p) => !p.archived);
  const more = (event) =>
    actions.openMenu(
      event,
      [
        {
          text: t('在项目中新对话'),
          icon: 'square-pen',
          run: () => navigate({ view: 'new', id: project.id }),
        },
        {
          text: t('打开项目文件夹'),
          icon: 'folder-open',
          run: () => actions.attempt(() => actions.fileOp(project.id, { op: 'open', path: '' })),
        },
        {
          text: t('导出项目快照'),
          icon: 'package',
          run: () => actions.attempt(() => actions.download(`/api/projects/${project.id}/export`)),
        },
        { sep: true },
        {
          text: t('计划的历史版本'),
          icon: 'history',
          run: () => openResourceHistory(actions, { projectId: project.id, resource: 'plans' }),
        },
        {
          text: t('日志的历史版本'),
          icon: 'history',
          run: () => openResourceHistory(actions, { projectId: project.id, resource: 'log' }),
        },
      ],
      project.name,
    );
  return html`<main class="ss-main workbench-page">
      <div class="ss-header">
        <div class="ss-header__title"><span>${t('工作站')}</span></div>
        <${ChoiceMenu}
          label=${t('项目')}
          triggerClass="ss-select ss-select--ghost"
          placement="bottom-start"
          items=${active.map((entry) => ({
            text: entry.name,
            selected: entry.id === project.id,
            run: () => navigate({ view: 'workbench', id: entry.id }),
          }))}
        >
          <${Lucide} name="folder-open" />
          <span class="ss-select__value">${project.name}</span>
        <//>
        <div class="ss-header__actions">
          <button
            type="button"
            class="ss-btn ss-btn--ghost"
            aria-pressed=${String(versions)}
            data-tip=${t('在右侧打开这个项目文稿的版本树')}
            onClick=${() => setVersions(!versions)}
          >
            <${Lucide} name="git-fork" />${t('版本树')}
          </button>
          ${html`<button
            type="button"
            class="ss-btn"
            data-tip=${t('打开编辑台，显示这个项目的文稿')}
            onClick=${() => actions.attempt(() => openDesk({ projectId: project.id }))}
          >
            <${Lucide} name="file-pen" />${t('在编辑台打开')}
          </button>`}
          <button
            type="button"
            class="ss-icon-btn"
            aria-label=${t('更多')}
            aria-haspopup="menu"
            data-tip=${t('更多')}
            onClick=${more}
          >
            <${Lucide} name="ellipsis" />
          </button>
        </div>
      </div>
      <div class="ss-content ss-wb__scroll">
        <div class="ss-wb">
          <${PlanStrip} project=${project} projects=${active} />
          <${JournalStrip} project=${project} />
          <div class="ss-wb__bottom">
            <${ResearchMap} project=${project} />
            <${ProjectFolder} project=${project} />
          </div>
        </div>
      </div>
    </main>
    ${
      versions &&
      html`<${WorkbenchVersions}
        project=${project}
        focusId=${focusVersion}
        onClose=${() => setVersions(false)}
      />`
    }`;
}
