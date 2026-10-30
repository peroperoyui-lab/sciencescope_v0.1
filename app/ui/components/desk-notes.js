// 「批注与索引」 on the desk (U5; gallery PageDesk; EDITING_DESK.md §6): one
// panel for comments and indexes, the person's and the experts'. New ones
// start from a selection; each card can be found in the text, edited and
// deleted. Marks in the text move with the words: deleting the last marked
// character removes the item, and undo in the editor brings it back.
import { useEffect, useRef, useState } from 'preact/hooks';
import { navigateMain } from '../assistant-window.js';
import { useActions, useAppState } from '../context.js';
import { textBlockAt, textBlockStart } from '../desk-assist.js';
import { html } from '../html.js';
import { formatTime, t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { renderMarkdown } from '../markdown.js';
import { routeHref } from '../route.js';
import { DeskIndexPicker, referenceKind } from './desk-index-picker.js';
import { ChoiceMenu } from './popover.js';

/** @param {any} item */
const isUser = (item) => item.author?.id === 'person_user';
/** @param {any} item */
const authorName = (item) => (isUser(item) ? t('你') : (item.author?.name ?? t('外部作者')));
/** @param {any} item */
const authorKey = (item) => item.author?.id ?? `name:${item.author?.name ?? ''}`;

/**
 * The message after typing removed marked text. Replies go with their comment
 * and are not counted. @param {{type:string,parentId?:string}[]} all
 */
export function removedText(all) {
  const removed = all.filter((item) => !item.parentId);
  const comments = removed.filter((item) => item.type === 'comment').length;
  const indexes = removed.length - comments;
  if (comments && indexes)
    return t('删掉的文字带走了 {a} 条批注和 {b} 条索引', { a: comments, b: indexes });
  return comments
    ? t('删掉的文字带走了 {n} 条批注', { n: comments })
    : t('删掉的文字带走了 {n} 条索引', { n: indexes });
}

/**
 * @param {{ tab: any, editing: any, onOpen: () => void }} props
 * `editing.current` is the open editor with its `session`; `onOpen` shows the
 * panel's 「批注与索引」 tab.
 */
export function useDeskNotes({ tab, editing, onOpen }) {
  const actions = useActions();
  const sessionId = editing.current?.session?.id ?? null;
  const bump = useAppState((state) => (sessionId ? state.deskNotes[sessionId] : undefined));
  const [items, setItems] = useState(/** @type {any[]} */ ([]));
  const [active, setActive] = useState(/** @type {string | null} */ (null));
  const [type, setType] = useState('all');
  const [author, setAuthor] = useState('all');
  const [draft, setDraft] = useState(/** @type {any} */ (null));
  const [edit, setEdit] = useState(/** @type {any} */ (null));
  const [reply, setReply] = useState(/** @type {any} */ (null));
  const [picker, setPicker] = useState(/** @type {any} */ (null));
  const latest = useRef(/** @type {any[]} */ ([]));
  // The active id for callers holding an older render's functions (the editors' onSelection).
  const shownActive = useRef(/** @type {string | null} */ (null));
  const retry = useRef(/** @type {any} */ (null));
  const list = useRef(/** @type {HTMLElement | null} */ (null));
  const frame = useRef(0);
  const format = tab?.format;
  const docx = format === 'docx';
  const pdf = format === 'pdf';
  // docx and PDF selections come with their session block; Markdown and TeX are found by order.
  const placed = docx || pdf;
  const editable = !!sessionId;

  /** Try again shortly, with the newest list. @param {any} current */
  function later(current) {
    clearTimeout(retry.current);
    retry.current = setTimeout(() => {
      if (editing.current === current) void place(current, latest.current);
    }, 300);
  }

  /** Marks follow the server's list once this side has nothing unsent. */
  async function place(current, all) {
    if (!current?.applyNotes) return;
    if (current.session.pending) {
      later(current);
      return;
    }
    const anchored = all.filter((item) => item.status !== 'lost');
    if (docx) return current.applyNotes(anchored.filter((item) => item.type === 'index'));
    const { blocks } = await actions.deskSession(current.session.id);
    if (editing.current !== current) return;
    if (current.session.pending) {
      later(current);
      return;
    }
    current.applyNotes(
      anchored.map((item) => ({
        ...item,
        // Replies share their comment's words; resolved comments stay quiet.
        quiet: item.type === 'comment' && (!!item.parentId || !!item.resolved),
      })),
      blocks,
    );
  }

  async function reload() {
    const current = editing.current;
    if (!current?.session) {
      latest.current = [];
      setItems([]);
      return;
    }
    try {
      const { items: fresh } = await actions.deskAnnotations(current.session.id);
      if (editing.current !== current) return;
      latest.current = fresh;
      setItems(fresh);
      await place(current, fresh);
    } catch (failure) {
      actions.toast(failure.message);
    }
  }

  useEffect(() => {
    setDraft(null);
    setEdit(null);
    setReply(null);
    shownActive.current = null;
    setActive(null);
    void reload();
  }, [sessionId]);
  useEffect(() => {
    if (bump != null) void reload();
  }, [bump]);
  useEffect(() => () => clearTimeout(retry.current), []);

  /** Highlight one item in the text and its card. @param {string | null} id */
  function activate(id, scroll = false) {
    shownActive.current = id;
    setActive(id);
    cancelAnimationFrame(frame.current);
    // The editors must not be told during their own update.
    frame.current = requestAnimationFrame(() => {
      editing.current?.activate?.(id);
      if (scroll && id)
        list.current?.querySelector(`[data-note="${CSS.escape(id)}"]`)?.scrollIntoView({
          block: 'nearest',
        });
    });
  }

  /** The cursor moved: the card of the item under it lights up. */
  function onSelection() {
    const current = editing.current;
    if (!current?.notesAt) return;
    const ids = current.notesAt();
    const next = ids.find((id) => latest.current.some((item) => item.id === id)) ?? null;
    if (next !== shownActive.current) activate(next, !!next);
  }

  /**
   * Where the selection (or the sentence at the cursor) is in the session:
   * one block, offsets in its text. Sends what was typed first.
   */
  async function selectionPlace() {
    const current = editing.current;
    if (!current?.session) return null;
    if (!current.selection()) current.selectSentence();
    let selected = current.selection();
    if (!selected) {
      actions.toast(t('先划选要标注的文字'));
      return null;
    }
    await current.session.flush();
    const single = t('批注和索引请在同一段里划选');
    if (placed) {
      selected = current.selection() ?? selected;
      if (selected.from == null || !selected.blockId) {
        actions.toast(single);
        return null;
      }
      return {
        blockId: selected.blockId,
        from: selected.from,
        to: selected.to,
        quote: selected.quote,
      };
    }
    const { blocks } = await actions.deskSession(current.session.id);
    const found = textBlockAt(current.text(), format, selected.from);
    const from = selected.from - (found?.start ?? 0);
    const to = selected.to - (found?.start ?? 0);
    if (!found || from < 0 || to > found.block.text.length || to <= from) {
      actions.toast(single);
      return null;
    }
    return { blockId: blocks[found.index]?.id, from, to, quote: selected.quote };
  }

  /** @param {'comment' | 'index'} kind */
  async function add(kind) {
    try {
      const where = await selectionPlace();
      if (!where) return;
      if (kind === 'index') setPicker({ place: where });
      else {
        onOpen();
        setDraft({ place: where, text: '' });
      }
    } catch (failure) {
      actions.toast(failure.message);
    }
  }

  async function run(work, done) {
    try {
      const result = await work();
      await reload();
      done?.(result);
      return result;
    } catch (failure) {
      actions.toast(failure.message);
      return null;
    }
  }

  const submitDraft = () =>
    draft?.text.trim() &&
    run(
      () =>
        actions.addDeskAnnotation(sessionId, {
          type: 'comment',
          blockId: draft.place.blockId,
          from: draft.place.from,
          to: draft.place.to,
          text: draft.text.trim(),
        }),
      (result) => {
        setDraft(null);
        if (result?.item) activate(result.item.id, true);
      },
    );

  /** Bring an item's words into view. @param {any} item */
  async function locate(item) {
    const current = editing.current;
    if (!current || item.status === 'lost') return;
    activate(item.id);
    if (placed) {
      current.reveal(item.blockId, item.from, item.to);
      return;
    }
    const { blocks } = await actions.deskSession(current.session.id);
    const index = blocks.findIndex((block) => block.id === item.blockId);
    const start = index < 0 ? null : textBlockStart(current.text(), format, index);
    if (start != null) current.reveal(start + item.from, start + item.to);
  }

  /** Attach a lost item to the words selected now. @param {any} item */
  async function relocate(item) {
    const current = editing.current;
    if (!current?.selection()) {
      actions.toast(t('先在正文里选中这段文字，再点「重新定位」'));
      return;
    }
    const where = await selectionPlace();
    if (!where) return;
    await run(() =>
      actions.updateDeskAnnotation(item.id, {
        blockId: where.blockId,
        from: where.from,
        to: where.to,
      }),
    );
  }

  /** Open what an index points to. @param {any} reference */
  function open(reference) {
    if (reference.kind === 'project-file' || reference.kind === 'script')
      actions.openPreview({
        kind: 'project',
        projectId: reference.projectId ?? tab.projectId,
        path: reference.path,
      });
    else if (reference.kind === 'source' || reference.kind === 'chunk')
      actions.openPreview({ kind: 'source', id: reference.sourceId ?? reference.id });
    else if (reference.kind === 'version')
      actions.openPreview({ kind: 'version', id: reference.id, projectId: tab.projectId });
    else if (reference.kind === 'message')
      navigateMain(routeHref({ view: 'meeting', id: `${reference.meetingId}/${reference.id}` }));
    else if (reference.kind === 'item')
      void actions.attempt(async () => {
        const detail = await actions.researchItem(reference.id);
        actions.openModal(
          detail.item.title,
          html`<div
            class="ss-prose"
            dangerouslySetInnerHTML=${{ __html: renderMarkdown(detail.item.body ?? '') }}
          />`,
        );
      });
  }

  /** Right-click 「查看索引」: show the index under the cursor. */
  function viewAt() {
    const ids = editing.current?.notesAt?.() ?? [];
    const found = latest.current.find((item) => ids.includes(item.id) && item.type === 'index');
    if (!found) return;
    onOpen();
    activate(found.id, true);
  }
  const indexAt = () => {
    const ids = editing.current?.notesAt?.() ?? [];
    return latest.current.some((item) => ids.includes(item.id) && item.type === 'index');
  };

  const roots = items.filter((item) => !item.parentId);
  const replies = (id) => items.filter((item) => item.parentId === id);
  const authors = [...new Map(roots.map((item) => [authorKey(item), authorName(item)])).entries()];
  const shown = roots.filter(
    (item) =>
      (type === 'all' || item.type === type) && (author === 'all' || authorKey(item) === author),
  );

  const card = (item) => {
    const lost = item.status === 'lost';
    const comment = item.type === 'comment';
    const threaded = comment && !docx;
    const editingThis = edit?.id === item.id;
    return html`<article
      class="ss-desk-card"
      key=${item.id}
      data-note=${item.id}
      data-active=${active === item.id ? '' : undefined}
      data-done=${item.resolved ? '' : undefined}
      onClick=${(event) => {
        if (!(/** @type {HTMLElement} */ (event.target).closest('button, textarea, a')))
          activate(item.id);
      }}
    >
      <div class="ss-desk-card__head">
        <${Lucide}
          name=${comment ? 'message-square' : 'link-2'}
          small
          class=${comment ? 'ss-desk-card__kind--comment' : 'ss-desk-card__kind--index'}
        />
        <span>${comment ? t('批注') : t('索引')}</span>
        <span class=${`ss-avatar${isUser(item) ? ' ss-avatar--user' : ''}`}
          >${Array.from(isUser(item) ? 'Y' : authorName(item))[0] ?? ''}</span
        >
        <span class="ss-truncate">${authorName(item)}</span>
        ${lost && html`<span class="ss-tag ss-tag--warn"><${Lucide} name="triangle-alert" small />${t('需重新定位')}</span>`}
        ${item.resolved && html`<span class="ss-tag ss-tag--ok">${t('已解决')}</span>`}
        <time datetime=${item.createdAt}>${formatTime(item.createdAt)}</time>
      </div>
      <p class="ss-desk-card__quote" title=${item.quote?.exact}>${item.quote?.exact}</p>
      ${
        editingThis
          ? html`<textarea
              class="ss-textarea"
              rows="2"
              aria-label=${t('批注内容')}
              value=${edit.text}
              onInput=${(event) => setEdit({ ...edit, text: event.currentTarget.value })}
              onKeyDown=${(event) => {
                if (event.key === 'Escape') setEdit(null);
              }}
            ></textarea>`
          : (comment ? item.text : item.note) &&
            html`<p class="ss-desk-card__body">${comment ? item.text : item.note}</p>`
      }
      ${
        !comment &&
        item.sources?.length > 0 &&
        html`<dl class="ss-props ss-desk-card__sources">
          ${item.sources.map(
            (reference, index) =>
              html`<dt key=${`k${index}`}>${referenceKind(reference).label}</dt>
                <dd key=${`v${index}`}>
                  <button
                    type="button"
                    class="ss-linkbtn ss-truncate"
                    title=${reference.label ?? reference.path}
                    onClick=${() => open(reference)}
                  >
                    ${reference.label ?? reference.path ?? reference.id}
                  </button>
                </dd>`,
          )}
        </dl>`
      }
      ${replies(item.id).map(
        (answer) =>
          html`<div class="ss-desk-reply" key=${answer.id}>
            <div class="ss-desk-card__head">
              <span class=${`ss-avatar${isUser(answer) ? ' ss-avatar--user' : ''}`}
                >${Array.from(isUser(answer) ? 'Y' : authorName(answer))[0] ?? ''}</span
              >
              <span>${authorName(answer)}</span>
              <time datetime=${answer.createdAt}>${formatTime(answer.createdAt)}</time>
            </div>
            <p class="ss-desk-card__body">${answer.text}</p>
          </div>`,
      )}
      ${
        reply?.id === item.id &&
        html`<textarea
            class="ss-textarea"
            rows="2"
            aria-label=${t('回复')}
            placeholder=${t('写回复')}
            value=${reply.text}
            onInput=${(event) => setReply({ ...reply, text: event.currentTarget.value })}
          ></textarea>
          <div class="ss-desk-card__foot">
            <span class="ss-desk-card__spacer"></span>
            <button type="button" class="ss-btn ss-btn--ghost" onClick=${() => setReply(null)}>
              ${t('取消')}
            </button>
            <button
              type="button"
              class="ss-btn ss-btn--primary"
              disabled=${!reply.text.trim()}
              onClick=${() =>
                run(
                  () =>
                    actions.addDeskAnnotation(sessionId, {
                      type: 'comment',
                      blockId: item.blockId,
                      from: item.from,
                      to: item.to,
                      text: reply.text.trim(),
                      parentId: item.id,
                    }),
                  () => setReply(null),
                )}
            >
              ${t('回复')}
            </button>
          </div>`
      }
      ${
        editingThis
          ? html`<div class="ss-desk-card__foot">
              <span class="ss-desk-card__spacer"></span>
              <button type="button" class="ss-btn ss-btn--ghost" onClick=${() => setEdit(null)}>
                ${t('取消')}
              </button>
              <button
                type="button"
                class="ss-btn ss-btn--primary"
                disabled=${!edit.text.trim()}
                onClick=${() =>
                  run(
                    () => actions.updateDeskAnnotation(item.id, { text: edit.text.trim() }),
                    () => setEdit(null),
                  )}
              >
                ${t('保存')}
              </button>
            </div>`
          : reply?.id !== item.id &&
            editable &&
            html`<div class="ss-desk-card__foot">
              ${
                lost
                  ? html`<button
                      type="button"
                      class="ss-btn ss-btn--ghost"
                      data-tip=${t('先在正文里选中这段文字，再点这里')}
                      onClick=${() => relocate(item)}
                    >
                      <${Lucide} name="locate" />${t('重新定位')}
                    </button>`
                  : html`<button
                      type="button"
                      class="ss-btn ss-btn--ghost"
                      onClick=${() => locate(item)}
                    >
                      <${Lucide} name="locate" />${t('定位')}
                    </button>`
              }
              <button
                type="button"
                class="ss-btn ss-btn--ghost"
                onClick=${() =>
                  comment
                    ? setEdit({ id: item.id, text: item.text })
                    : setPicker({ place: { quote: item.quote?.exact ?? '' }, item })}
              >
                <${Lucide} name="pencil" />${t('编辑')}
              </button>
              <button
                type="button"
                class="ss-btn ss-btn--ghost"
                onClick=${() => run(() => actions.removeDeskAnnotation(item.id))}
              >
                <${Lucide} name="trash-2" />${t('删除')}
              </button>
              ${
                threaded &&
                html`<span class="ss-desk-card__spacer"></span>
                  <button
                    type="button"
                    class="ss-icon-btn ss-icon-btn--sm"
                    aria-label=${t('回复')}
                    data-tip=${t('回复')}
                    onClick=${() => setReply({ id: item.id, text: '' })}
                  >
                    <${Lucide} name="reply" />
                  </button>
                  <button
                    type="button"
                    class="ss-icon-btn ss-icon-btn--sm"
                    aria-label=${item.resolved ? t('重新打开') : t('标为已解决')}
                    data-tip=${item.resolved ? t('重新打开') : t('标为已解决')}
                    aria-pressed=${String(!!item.resolved)}
                    onClick=${() =>
                      run(() =>
                        actions.updateDeskAnnotation(item.id, { resolved: !item.resolved }),
                      )}
                  >
                    <${Lucide} name="circle-check" />
                  </button>`
              }
            </div>`
      }
    </article>`;
  };

  const composer =
    draft &&
    html`<div class="ss-desk-card ss-desk-card--new">
      <div class="ss-desk-card__head">
        <${Lucide} name="message-square-plus" small class="ss-desk-card__kind--index" />
        <span>${t('新批注')}</span>
      </div>
      <p class="ss-desk-card__quote" title=${draft.place.quote}>${draft.place.quote}</p>
      <textarea
        class="ss-textarea"
        rows="2"
        aria-label=${t('批注内容')}
        placeholder=${t('写下你的意见或要核对的地方')}
        value=${draft.text}
        ref=${(element) => element && !draft.focused && (element.focus(), (draft.focused = true))}
        onInput=${(event) => setDraft({ ...draft, text: event.currentTarget.value })}
        onKeyDown=${(event) => {
          if (event.key === 'Escape') setDraft(null);
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void submitDraft();
        }}
      ></textarea>
      <div class="ss-desk-card__foot">
        <button
          type="button"
          class="ss-btn ss-btn--ghost"
          onClick=${() => {
            setPicker({ place: draft.place, note: draft.text });
            setDraft(null);
          }}
        >
          <${Lucide} name="link-2" />${t('改成索引')}
        </button>
        <span class="ss-desk-card__spacer"></span>
        <button type="button" class="ss-btn ss-btn--ghost" onClick=${() => setDraft(null)}>
          ${t('取消')}
        </button>
        <button
          type="button"
          class="ss-btn ss-btn--primary"
          data-kbd="Ctrl Enter"
          disabled=${!draft.text.trim()}
          onClick=${submitDraft}
        >
          ${t('添加')}
        </button>
      </div>
    </div>`;

  const panel = html`${
      roots.length > 0 &&
      html`<div class="ss-toolbar ss-desk-notes__bar">
        <div class="ss-seg ss-seg--sm" role="group" aria-label=${t('类型')}>
          ${[
            ['all', t('全部')],
            ['comment', t('批注')],
            ['index', t('索引')],
          ].map(
            ([name, label]) =>
              html`<button
                type="button"
                key=${name}
                aria-pressed=${String(type === name)}
                onClick=${() => setType(name)}
              >
                ${label}
              </button>`,
          )}
        </div>
        <span class="ss-desk-card__spacer"></span>
        <${ChoiceMenu}
          label=${t('按作者筛选')}
          triggerClass="ss-select ss-select--sm ss-select--ghost"
          placement="bottom-end"
          items=${[
            { text: t('所有人'), selected: author === 'all', run: () => setAuthor('all') },
            ...authors.map(([key, name]) => ({
              text: name,
              selected: author === key,
              run: () => setAuthor(key),
            })),
          ]}
        >
          <span class="ss-select__value"
            >${author === 'all' ? t('所有人') : (authors.find(([key]) => key === author)?.[1] ?? '')}</span
          >
          <${Lucide} name="chevron-down" />
        <//>
      </div>`
    }
    <div class="ss-panel__body ss-desk-notes" ref=${list}>
      ${composer}
      ${
        roots.length
          ? html`<div class="ss-desk-list">${shown.map(card)}</div>
              <p class="ss-prov">
                ${
                  pdf
                    ? t('PDF 正文不会改动，批注和索引只在 ScienceScope 里，不写进 PDF。')
                    : html`${t('标记的文字全部删掉时，批注或索引跟着删掉；撤销会把文字和它们一起恢复。')}
                      ${docx ? t('批注保存时写进 Word 批注，索引只在 ScienceScope 里。') : t('批注和索引只在 ScienceScope 里。')}`
                }
              </p>`
          : !draft &&
            html`<div class="ss-empty">
              <div class="ss-empty__icon"><${Lucide} name="message-square" /></div>
              <div class="ss-empty__title">${t('还没有批注和索引')}</div>
              <div class="ss-empty__text">
                ${t('划选文字后可以添加批注或索引，专家加的也会列在这里。')}
              </div>
            </div>`
      }
    </div>`;

  const layer =
    picker &&
    html`<${DeskIndexPicker}
      projectId=${tab?.projectId}
      quote=${picker.place.quote ?? ''}
      item=${picker.item}
      note=${picker.note}
      onClose=${() => setPicker(null)}
      onSubmit=${async (value) => {
        const result = await run(() =>
          picker.item
            ? actions.updateDeskAnnotation(picker.item.id, value)
            : actions.addDeskAnnotation(sessionId, {
                type: 'index',
                blockId: picker.place.blockId,
                from: picker.place.from,
                to: picker.place.to,
                ...value,
              }),
        );
        if (!result) return;
        setPicker(null);
        onOpen();
        const id = picker.item?.id ?? result.item?.id;
        if (id) activate(id, true);
      }}
    />`;

  return {
    count: roots.length,
    /** The document's indexes, for the 「来源」 tab. */
    indexes: roots.filter((item) => item.type === 'index'),
    authorName,
    locate,
    openReference: open,
    panel,
    layer,
    add,
    viewAt,
    indexAt,
    onSelection,
    /** Typing here removed marked text: say so, with undo. @param {{type:string}[]} removed */
    onRemoved: (removed) =>
      actions.toast(removedText(removed), {
        label: t('撤销'),
        run: () => editing.current?.command('undo'),
      }),
  };
}
