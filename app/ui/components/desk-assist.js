// Help around a selection on the desk (U4; gallery DeskMenus, PageDesk): the
// floating toolbar (format, rewrite, quote to chat), the right-click menu, the
// note after an expert changes the text (看改了什么 / 撤销), and a paragraph's
// change history. Experts' edits go straight into the text; who changed what
// stays in the session's change records.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import {
  PRESETS,
  changeRuns,
  deskMark,
  textBlockAt,
  textBlockStart,
  wordDiff,
} from '../desk-assist.js';
import { html } from '../html.js';
import { formatTime, t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { Dialog } from './dialog.js';

const SOURCE_MARKUP = {
  md: [
    ['**', '**', '加粗'],
    ['*', '*', '斜体'],
  ],
  tex: [
    ['\\textbf{', '}', '\\textbf'],
    ['\\emph{', '}', '\\emph'],
    ['$', '$', '转成公式 $…$'],
  ],
};

/** @param {any} participants @param {string} id */
const nameOf = (participants, id) =>
  id === 'person_user' ? t('你') : (participants.find((person) => person.id === id)?.name ?? id);

/** Before and after of one change run, marked by words. @param {{ run: any, diff: any }} props */
function ChangeText({ run, diff }) {
  if (run.op === 'insert-block' || !run.before)
    return html`<p class="ss-desk-change__text"><span class="ss-rev-ins">${run.after}</span></p>`;
  if (!run.after)
    return html`<p class="ss-desk-change__text"><span class="ss-diff-del">${run.before}</span></p>`;
  return html`<p class="ss-desk-change__text">
    ${wordDiff(diff, run.before, run.after).map((part) =>
      part.type === 'same'
        ? part.text
        : html`<span class=${part.type === 'del' ? 'ss-diff-del' : 'ss-rev-ins'}
            >${part.text}</span
          >`,
    )}
  </p>`;
}

/**
 * @param {{ tab: any, editing: any, canvas: any, notes: any }} props
 * `editing.current` is the open editor with its `session` and `opened` session;
 * `notes` starts comments and indexes (useDeskNotes).
 * @returns {{ layer: any, onContextMenu: (event: MouseEvent) => void, onSelection: () => void,
 *   onScroll: () => void, revealBlock: (blockId: string) => Promise<any> }}
 */
export function useDeskAssist({ tab, editing, canvas, notes }) {
  const actions = useActions();
  const participants = useAppState((state) => state.participants);
  const turns = useAppState((state) => state.turns);
  const sessionId = editing.current?.session?.id ?? null;
  const edits = useAppState((state) => (sessionId ? state.deskEdits[sessionId] : undefined));
  const [info, setInfo] = useState(/** @type {any} */ (null));
  const [faded, setFaded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const pressed = useRef(false);
  const [instruction, setInstruction] = useState('');
  const [note, setNote] = useState(/** @type {any} */ (null));
  const [dialog, setDialog] = useState(/** @type {any} */ (null));
  const [position, setPosition] = useState({ left: -9999, top: -9999 });
  const bar = useRef(/** @type {HTMLElement | null} */ (null));
  const input = useRef(/** @type {HTMLInputElement | null} */ (null));
  const seen = useRef(-1);
  const frame = useRef(0);
  const format = tab?.format;
  const docx = format === 'docx';

  const read = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      setInfo(editing.current?.selection?.() ?? null);
      setFaded(false);
    });
  };

  // Edits already there when the page opens are not news.
  useEffect(() => {
    seen.current = edits?.at(-1)?.seq ?? -1;
    setNote(null);
    setInfo(null);
  }, [sessionId]);
  useEffect(() => {
    const fresh = (edits ?? []).filter((edit) => edit.seq > seen.current);
    if (!fresh.length) return;
    seen.current = fresh.at(-1).seq;
    setNote((current) => {
      const same = current?.kind === 'edit' && current.actorId === fresh[0].actorId;
      const base = same
        ? current
        : { kind: 'edit', actorId: fresh[0].actorId, changeIds: [], blockIds: [] };
      return {
        ...base,
        turnId: current?.turnId,
        changeIds: [...base.changeIds, ...fresh.flatMap((edit) => edit.changeIds)],
        blockIds: [...new Set([...base.blockIds, ...fresh.flatMap((edit) => edit.blockIds)])],
      };
    });
  }, [edits]);
  // A finished request that changed nothing says so once.
  const waiting = note?.kind === 'busy' && note.turnId ? turns[note.turnId] : null;
  useEffect(() => {
    if (!waiting?.endedAt) return;
    setNote(null);
    actions.toast(
      waiting.status === 'failed'
        ? t('这次改写没有完成，详情在对话里。')
        : t('专家没有改动正文，回复在对话里。'),
    );
  }, [waiting?.endedAt]);

  useLayoutEffect(() => {
    if (!info || !bar.current) return;
    const { width, height } = bar.current.getBoundingClientRect();
    const above = info.rect.top - height - 8;
    setPosition({
      left: Math.max(8, Math.min(info.rect.left, innerWidth - width - 8)),
      top: above > 72 ? above : Math.min(info.rect.bottom + 8, innerHeight - height - 8),
    });
  }, [info]);

  useEffect(() => {
    const down = (event) => {
      if (!canvas.current?.contains(event.target) || bar.current?.contains(event.target)) return;
      pressed.current = true;
      setDragging(true);
    };
    // Only a selection made in the page: a click in a dialog leaves the toolbar closed.
    const up = () => {
      if (!pressed.current) return;
      pressed.current = false;
      setDragging(false);
      read();
    };
    // Office's floating toolbar fades when the pointer moves away from it.
    const move = (event) => {
      if (!bar.current || document.activeElement === input.current) return;
      const box = bar.current.getBoundingClientRect();
      const dx = Math.max(box.left - event.clientX, 0, event.clientX - box.right);
      const dy = Math.max(box.top - event.clientY, 0, event.clientY - box.bottom);
      if (Math.hypot(dx, dy) > 140) setFaded(true);
    };
    const key = (event) => {
      if (event.key === 'Escape' && info) {
        setInfo(null);
        return;
      }
      const mod = event.ctrlKey || event.metaKey;
      if (!mod || !editing.current?.session) return;
      if (event.key.toLowerCase() === 'j' && !event.shiftKey) {
        event.preventDefault();
        openAsk();
      } else if (event.key.toLowerCase() === 'l' && event.shiftKey) {
        event.preventDefault();
        void quote();
      }
    };
    addEventListener('pointerdown', down, true);
    addEventListener('pointerup', up, true);
    addEventListener('pointermove', move);
    addEventListener('keydown', key);
    return () => {
      removeEventListener('pointerdown', down, true);
      removeEventListener('pointerup', up, true);
      removeEventListener('pointermove', move);
      removeEventListener('keydown', key);
    };
  });
  // Only on close: a render in between must not drop the pending selection read.
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /** With nothing selected, menus and shortcuts act on the sentence at the cursor. */
  const selectionOrSentence = () => {
    const current = editing.current;
    if (!current) return null;
    if (!current.selection()) current.selectSentence();
    return current.selection();
  };
  const openAsk = () => {
    const next = selectionOrSentence();
    if (!next) return;
    setInfo(next);
    setFaded(false);
    requestAnimationFrame(() => input.current?.focus());
  };

  /**
   * Send what is typed, then find the selection's session block and the bound
   * chat; with no chat yet, the project's latest one is bound (or a new one).
   */
  async function locate(selected) {
    const current = editing.current;
    await current.session.flush();
    const opened = await actions.deskSession(current.session.id);
    let blockId;
    let paragraph;
    let from = selected.from;
    let to = selected.to;
    if (docx) {
      blockId = current.selection()?.blockId ?? selected.blockId;
      paragraph = current.paragraphOf(blockId);
    } else {
      const text = current.text();
      const found = textBlockAt(text, format, selected.from);
      blockId = opened.blocks[found?.index ?? 0]?.id;
      paragraph = (found?.index ?? 0) + 1;
      from = found ? selected.from - found.start : null;
      to = found ? selected.to - found.start : null;
    }
    return { session: opened.session, blockId, paragraph, from, to };
  }
  async function bindChat(session) {
    if (session.meetingId) return session.meetingId;
    const entered = await actions.enterDesk({ projectId: tab.projectId, mode: 'continue' });
    return entered.meeting.id;
  }

  async function rewrite(text) {
    const selected = info ?? selectionOrSentence();
    const request = text.trim();
    if (!selected || !request) return;
    setInfo(null);
    setInstruction('');
    try {
      const place = await locate(selected);
      const body = { blockId: place.blockId, quote: selected.quote, instruction: request };
      let meetingId = place.session.meetingId;
      let result;
      try {
        result = await actions.rewriteDesk(editing.current.session.id, body);
      } catch (failure) {
        if (failure.code !== 'DESK_MEETING_REQUIRED' || meetingId) throw failure;
        meetingId = await bindChat(place.session);
        result = await actions.rewriteDesk(editing.current.session.id, body);
      }
      setNote({ kind: 'busy', meetingId, turnId: result.turnId, queued: !!result.queued });
    } catch (failure) {
      actions.toast(failure.message);
    }
  }

  async function quote() {
    const selected = info ?? selectionOrSentence();
    if (!selected) return actions.toast(t('先选中要引用的文字'));
    setInfo(null);
    try {
      const place = await locate(selected);
      const meetingId = await bindChat(place.session);
      const mark = deskMark({
        version: { id: place.session.baseVersionId, projectId: tab.projectId },
        groupId: place.session.groupId,
        title: tab.name,
        blockId: place.blockId,
        paragraph: place.paragraph,
        quote: selected.quote,
        from: place.from,
        to: place.to,
      });
      await actions.changeInput(meetingId, { op: 'mark-add', mark: { ...mark, comment: '' } });
      actions.toast(t('已引用到对话，回到主窗口的对话里可以接着问'));
    } catch (failure) {
      actions.toast(failure.message);
    }
  }

  /** Bring a session block into view; Markdown and TeX blocks are found by their order. */
  async function revealBlock(blockId) {
    const current = editing.current;
    if (!current) return;
    if (docx) return current.reveal(blockId);
    const { blocks } = await actions.deskSession(current.session.id);
    const index = blocks.findIndex((block) => block.id === blockId);
    const start = index < 0 ? null : textBlockStart(current.text(), format, index);
    if (start != null) current.reveal(start, start + blocks[index].text.length);
  }

  async function showChanges(title, pick, allowUndo) {
    const current = editing.current;
    if (!current) return;
    try {
      await current.session.flush();
      const [{ changes }, { diffArrays }] = await Promise.all([
        actions.deskSession(current.session.id),
        import('../readers/vendor.js'),
      ]);
      const runs = changeRuns(changes.filter(pick)).reverse();
      setDialog({ title, runs, diff: diffArrays, allowUndo });
      if (runs[0]) void revealBlock(runs.at(-1).blockId);
    } catch (failure) {
      actions.toast(failure.message);
    }
  }

  /** Withdraw changes newest first; a later edit to the same text blocks it. @param {string[]} ids */
  async function undo(ids) {
    try {
      for (const id of [...ids].reverse()) await actions.undoDeskChange(id);
      actions.toast(t('已撤销'));
      return true;
    } catch (failure) {
      actions.toast(
        failure.code === 'DESK_UNDO_BLOCKED'
          ? t('这里之后又改过，请先撤销后来的修改。')
          : failure.message,
      );
      return false;
    }
  }

  async function history() {
    const current = editing.current;
    if (!current) return;
    let blockId = docx ? current.currentBlock() : null;
    if (!docx) {
      await current.session.flush();
      const { blocks } = await actions.deskSession(current.session.id);
      blockId = blocks[textBlockAt(current.text(), format, current.cursor())?.index ?? 0]?.id;
    }
    if (blockId)
      await showChanges(t('这句的修改记录'), (change) => change.blockId === blockId, true);
  }

  /** @param {MouseEvent} event */
  function onContextMenu(event) {
    const current = editing.current;
    if (!current?.session) return;
    let selected = current.selection();
    const { clientX: x, clientY: y } = event;
    const { rect } = selected ?? {};
    if (!rect || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      current.caretAt(x, y);
      selected = null;
    }
    const later = t('稍后接入');
    actions.openMenu(
      event,
      [
        {
          text: t('剪切'),
          icon: 'scissors',
          key: 'Ctrl X',
          disabled: !selected,
          run: () => current.copy(true).catch(() => actions.toast(t('请用 Ctrl X 剪切'))),
        },
        {
          text: t('复制'),
          icon: 'copy',
          key: 'Ctrl C',
          disabled: !selected,
          run: () => current.copy().catch(() => actions.toast(t('请用 Ctrl C 复制'))),
        },
        {
          text: t('粘贴'),
          icon: 'clipboard-paste',
          key: 'Ctrl V',
          run: () =>
            navigator.clipboard
              .readText()
              .then((text) => current.paste(text))
              .catch(() => actions.toast(t('请用 Ctrl V 粘贴'))),
        },
        { sep: true },
        { text: t('改写…'), icon: 'wand-sparkles', key: 'Ctrl J', run: openAsk },
        { text: t('引用到对话'), icon: 'text-quote', key: 'Ctrl Shift L', run: () => quote() },
        { sep: true },
        {
          text: t('添加批注'),
          icon: 'message-square-plus',
          run: () => {
            setInfo(null);
            void notes.add('comment');
          },
        },
        {
          text: t('添加索引…'),
          icon: 'link-2',
          run: () => {
            setInfo(null);
            void notes.add('index');
          },
        },
        ...(notes.indexAt()
          ? [{ text: t('查看索引'), icon: 'link-2', run: () => notes.viewAt() }]
          : []),
        { sep: true },
        { text: t('这句的修改记录'), icon: 'history', run: () => history() },
        { text: `${t('在版本树里定位')}（${later}）`, icon: 'git-fork', disabled: true },
      ],
      t('文字'),
    );
  }

  const run = (name) => {
    editing.current?.command(name);
    read();
  };
  const edit = editing.current;
  const toolbar =
    info &&
    !dragging &&
    !notes.layer &&
    edit?.session &&
    html`<div
      class="ss-ftb ss-desk-ftb"
      role="toolbar"
      aria-label=${t('划选工具')}
      ref=${bar}
      data-faded=${faded ? 'true' : undefined}
      style=${{ left: `${position.left}px`, top: `${position.top}px` }}
      onPointerEnter=${() => setFaded(false)}
    >
      <div class="ss-ftb__row">
        ${
          docx
            ? html`${[
                ['b', 'bold', t('加粗'), 'Ctrl B'],
                ['i', 'italic', t('斜体'), 'Ctrl I'],
                ['u', 'underline', t('下划线'), 'Ctrl U'],
                ['sup', 'superscript', t('上标'), ''],
                ['sub', 'subscript', t('下标'), ''],
              ].map(
                ([name, icon, label, kbd]) =>
                  html`<button
                    type="button"
                    class="ss-icon-btn"
                    aria-label=${label}
                    data-tip=${label}
                    data-kbd=${kbd || undefined}
                    onMouseDown=${(event) => event.preventDefault()}
                    onClick=${() => run(name)}
                  >
                    <${Lucide} name=${icon} />
                  </button>`,
              )}`
            : (SOURCE_MARKUP[format] ?? []).map(
                ([before, after, label]) =>
                  html`<button
                    type="button"
                    class="ss-ftb__label"
                    onMouseDown=${(event) => event.preventDefault()}
                    onClick=${() => {
                      edit.wrap(before, after);
                      read();
                    }}
                  >
                    ${t(label)}
                  </button>`,
              )
        }
        <span class="ss-ribbon__sep"></span>
        <button
          type="button"
          class="ss-icon-btn"
          aria-label=${t('添加批注')}
          data-tip=${t('添加批注')}
          onMouseDown=${(event) => event.preventDefault()}
          onClick=${() => {
            setInfo(null);
            void notes.add('comment');
          }}
        >
          <${Lucide} name="message-square-plus" />
        </button>
        <button
          type="button"
          class="ss-icon-btn"
          aria-label=${t('添加索引')}
          data-tip=${t('添加索引')}
          onMouseDown=${(event) => event.preventDefault()}
          onClick=${() => {
            setInfo(null);
            void notes.add('index');
          }}
        >
          <${Lucide} name="link-2" />
        </button>
        <button
          type="button"
          class="ss-ftb__label"
          data-kbd="Ctrl Shift L"
          onMouseDown=${(event) => event.preventDefault()}
          onClick=${() => quote()}
        >
          <${Lucide} name="text-quote" />${t('引用到对话')}
        </button>
      </div>
      <div class="ss-ftb__row">
        <label class="ss-ftb__ask">
          <${Lucide} name="wand-sparkles" />
          <input
            ref=${input}
            type="text"
            aria-label=${t('改写指令')}
            placeholder=${t('告诉专家怎么改，例如「语气缓和些」')}
            value=${instruction}
            onInput=${(event) => setInstruction(event.currentTarget.value)}
            onKeyDown=${(event) => {
              if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) {
                event.preventDefault();
                void rewrite(instruction);
              } else if (event.key === 'Escape') {
                setInfo(null);
                edit.focus();
              }
            }}
          />
          <span class="ss-kbd">Enter</span>
        </label>
      </div>
      <div class="ss-ftb__chips">
        ${PRESETS.map(
          (preset) =>
            html`<button
              type="button"
              key=${preset}
              onMouseDown=${(event) => event.preventDefault()}
              onClick=${() => rewrite(t(preset))}
            >
              ${t(preset)}
            </button>`,
        )}
      </div>
    </div>`;

  const section =
    note?.kind === 'edit' && docx && note.blockIds[0] ? edit?.sectionOf?.(note.blockIds[0]) : '';
  const who = note?.kind === 'edit' ? nameOf(participants, note.actorId) : '';
  const toast =
    note &&
    html`<div class="ss-toast ss-desk-note" role="status" data-note=${note.kind}>
      ${
        note.kind === 'busy'
          ? html`<span class="ss-spin"></span>
              <span class="ss-toast__msg"
                >${note.queued ? t('已排队，前一条回答结束后改写') : t('专家正在改写…')}</span
              >
              ${
                note.meetingId &&
                html`<button
                  type="button"
                  class="ss-btn ss-btn--ghost ss-btn--sm"
                  onClick=${() => {
                    void actions.interrupt(note.meetingId).catch(() => {});
                    setNote(null);
                  }}
                >
                  ${t('停止')}
                </button>`
              }`
          : html`<span class="ss-avatar">${Array.from(who)[0] ?? ''}</span>
              <span class="ss-toast__msg">
                ${
                  section
                    ? t('{name}改写了「{section}」{n} 段', {
                        name: who,
                        section,
                        n: note.blockIds.length,
                      })
                    : t('{name}改写了 {n} 段', { name: who, n: note.blockIds.length })
                }
              </span>
              <button
                type="button"
                class="ss-btn ss-btn--ghost ss-btn--sm"
                onClick=${() =>
                  showChanges(t('改了什么'), (change) => note.changeIds.includes(change.id), false)}
              >
                ${t('看改了什么')}
              </button>
              <button
                type="button"
                class="ss-btn ss-btn--ghost ss-btn--sm"
                onClick=${async () => {
                  if (await undo(note.changeIds)) setNote(null);
                }}
              >
                ${t('撤销')}
              </button>`
      }
      <button
        type="button"
        class="ss-icon-btn ss-icon-btn--sm"
        aria-label=${t('关闭')}
        onClick=${() => setNote(null)}
      >
        <${Lucide} name="x" />
      </button>
    </div>`;

  const changes =
    dialog &&
    html`<${Dialog}
      title=${dialog.title}
      size="md"
      onClose=${() => setDialog(null)}
      foot=${html`<button type="button" class="ss-btn" onClick=${() => setDialog(null)}>
        ${t('关闭')}
      </button>`}
    >
      ${
        dialog.runs.length
          ? html`<ol class="ss-desk-changes">
              ${dialog.runs.map(
                (entry) =>
                  html`<li class="ss-desk-change" key=${entry.ids[0]}>
                    <div class="ss-desk-change__head">
                      <span class="ss-avatar"
                        >${Array.from(nameOf(participants, entry.actorId))[0]}</span
                      >
                      <b>${nameOf(participants, entry.actorId)}</b>
                      <time>${formatTime(entry.createdAt)}</time>
                      ${entry.instruction && html`<span class="ss-truncate">「${entry.instruction}」</span>`}
                      <span class="ss-desk-change__end"></span>
                      ${
                        dialog.allowUndo &&
                        html`<button
                          type="button"
                          class="ss-btn ss-btn--ghost ss-btn--sm"
                          onClick=${async () => {
                            if (await undo(entry.ids)) setDialog(null);
                          }}
                        >
                          ${t('撤销')}
                        </button>`
                      }
                    </div>
                    <${ChangeText} run=${entry} diff=${dialog.diff} />
                  </li>`,
              )}
            </ol>`
          : html`<p class="ss-muted">${t('这段还没有修改记录。')}</p>`
      }
    <//>`;

  return {
    layer: html`${toolbar}${toast}${changes}`,
    onContextMenu,
    onSelection: read,
    onScroll: () => info && read(),
    revealBlock,
  };
}
