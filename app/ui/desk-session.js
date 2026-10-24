// One open document on the editing desk (EDITING_DESK.md §3, §8). Typing is
// sent to the desk session shortly after it stops; the session keeps a
// journal and a working copy, and only Save writes the project file. One
// request is in flight at a time. When the server has moved on (an expert's
// edit, or a conflict), the editor takes the server's text except where this
// side has changes still to send.
import { blockDelta, confirmedOf, mergeBlocks, mergeText } from './desk-blocks.js';

export const SYNC_DELAY = 800;

/**
 * Write a session's working copy to the project file. When the person must
 * choose first, returns { confirm: {versionId, versionNumber} } (the file is
 * at another version) or { external: {versionId} } (changed outside).
 * @param {any} actions @param {string} id @param {boolean} [confirm]
 */
export async function writeBack(actions, id, confirm = false) {
  try {
    const result = await actions.saveDesk(id, {
      to: 'project',
      ...(confirm ? { confirm: true } : {}),
    });
    return { saved: true, session: result.session };
  } catch (failure) {
    if (failure.code === 'DESK_SAVE_CONFIRM') return { confirm: failure.details };
    if (failure.code === 'DESK_EXTERNAL_CHANGE') return { external: failure.details };
    throw failure;
  }
}

/**
 * @typedef {{ state: 'saved'|'unsaved'|'syncing'|'error', message?: string }} DeskStatus
 * @typedef {{ snapshot: () => any, adopt: (value: any) => void, rename?: (ids: Record<string,string>) => void }} DeskEditor
 */

/**
 * @param {{ actions: any, opened: any, editor: DeskEditor,
 *   onStatus?: (status: DeskStatus) => void, onError?: (message: string) => void,
 *   delay?: number, schedule?: (run: () => void, ms: number) => any, cancel?: (timer: any) => void }} options
 */
export function createDeskSession({
  actions,
  opened,
  editor,
  onStatus = () => {},
  onError = () => {},
  delay = SYNC_DELAY,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  const docx = typeof opened.text !== 'string';
  const id = opened.session.id;
  let seq = opened.session.seq;
  let saved = opened.session.savedSeq;
  let confirmed = docx ? confirmedOf(opened.blocks) : opened.text;
  let remote = seq;
  let edits = 0;
  let sentEdits = 0;
  let timer = null;
  /** @type {Promise<void> | null} */
  let running = null;
  let error = '';
  let closed = false;

  const report = () =>
    onStatus(
      error
        ? { state: 'error', message: error }
        : running
          ? { state: 'syncing' }
          : edits !== sentEdits || seq !== saved
            ? { state: 'unsaved' }
            : { state: 'saved' },
    );

  function build() {
    if (docx) {
      const delta = blockDelta(confirmed, editor.snapshot());
      return delta && { delta };
    }
    const text = editor.snapshot();
    return text === confirmed ? null : { text };
  }

  function accept(body, result) {
    seq = result.seq;
    if (!docx) {
      confirmed = body.text;
      return;
    }
    const { blocks, inserted, removed } = body.delta;
    for (const [block, inlines] of Object.entries(blocks))
      confirmed.set(block, { ...confirmed.get(block), inlines });
    for (const entry of inserted)
      confirmed.set(result.inserted[entry.id], { kind: 'paragraph', inlines: entry.inlines });
    for (const block of removed) confirmed.delete(block);
    editor.rename?.(result.inserted ?? {});
  }

  /** @param {Set<string> | 'all' | null} [force] */
  async function refresh(force = null) {
    const fresh = await actions.deskSession(id);
    seq = fresh.session.seq;
    saved = fresh.session.savedSeq;
    remote = Math.max(remote, seq);
    if (docx) {
      const before = confirmed;
      confirmed = confirmedOf(fresh.blocks);
      editor.adopt(mergeBlocks(fresh.blocks, before, editor.snapshot(), force));
    } else {
      const local = force ? confirmed : editor.snapshot();
      editor.adopt(mergeText(confirmed, local, fresh.text));
      confirmed = fresh.text;
    }
  }

  async function send() {
    for (let round = 0; round < 3; round++) {
      const counted = edits;
      const body = build();
      if (!body) {
        sentEdits = counted;
        if (remote > seq) await refresh();
        return;
      }
      const before = seq;
      try {
        const result = docx
          ? await actions.patchDeskBlocks(id, { baseSeq: seq, ...body.delta })
          : await actions.putDeskText(id, { baseSeq: seq, text: body.text });
        accept(body, result);
        sentEdits = counted;
        // Someone else wrote between our two requests: pick up their text.
        if (result.seq > before + 1 || remote > result.seq) await refresh();
        return;
      } catch (failure) {
        if (failure.code === 'DESK_CONFLICT') {
          await refresh(docx ? new Set(failure.details?.blockIds ?? []) : null);
          continue;
        }
        if (failure.status === 409 || failure.status === 400) {
          // The server refused this edit (a section break, a table cell): go back to its text.
          onError(failure.message);
          await refresh('all');
          sentEdits = edits;
          return;
        }
        throw failure;
      }
    }
  }

  /** Send everything typed so far; resolves once the session has it. */
  async function flush() {
    if (timer != null) cancel(timer);
    timer = null;
    while (running) await running.catch(() => {});
    if (closed) return;
    running = send();
    report();
    try {
      await running;
      error = '';
    } catch (failure) {
      error = failure.message || '同步失败';
      throw failure;
    } finally {
      running = null;
      report();
    }
  }

  return {
    id,
    get seq() {
      return seq;
    },
    /** The editor changed: send after a pause in typing. */
    changed() {
      edits++;
      if (timer != null) cancel(timer);
      timer = schedule(() => {
        timer = null;
        flush().catch((failure) => onError(failure.message));
      }, delay);
      report();
    },
    flush,
    /** A `desk.changed` sequence from the event stream. @param {number} value */
    remoteSeq(value) {
      if (value <= remote) return;
      remote = value;
      if (value > seq && !running && timer == null && edits === sentEdits)
        flush().catch((failure) => onError(failure.message));
    },
    /**
     * Send what is typed, then write the project file (see `writeBack`).
     * @param {boolean} [confirm]
     */
    async save(confirm = false) {
      await flush();
      const result = await writeBack(actions, id, confirm);
      if (result.session) {
        seq = result.session.seq;
        saved = result.session.savedSeq;
        report();
      }
      return result;
    },
    /** Keep these changes as a new version (a branch beside the project file). */
    async saveVersion() {
      await flush();
      const result = await actions.saveDesk(id, { to: 'version' });
      seq = result.session.seq;
      saved = result.session.savedSeq;
      report();
      return result.version;
    },
    /** True when something is not yet written to the project file. */
    get unsaved() {
      return edits !== sentEdits || seq !== saved || timer != null;
    },
    /** Close the session; the server keeps changed text as a version. */
    async close() {
      await flush().catch(() => {});
      closed = true;
      return actions.closeDesk(id);
    },
    /** Stop without closing: the session stays open on the server and comes back next time. */
    detach() {
      if (timer != null) cancel(timer);
      timer = null;
      closed = true;
    },
  };
}
