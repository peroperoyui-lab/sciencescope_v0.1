// What answers show under them (the turn and its steps, citation targets, the
// knowledge change) comes in one request per 50 messages when a page of a
// chat loads. Each part is handed out once; later reads, and messages the
// batch could not answer, use the single-message requests as before.

const BATCH = 50;

/** @param {import('./api.js').Api} api */
export function createMessageExtras(api) {
  /** @type {Record<'citations' | 'knowledge', Map<string, Promise<{ value: any } | null>>>} */
  const parts = { citations: new Map(), knowledge: new Map() };

  /**
   * Ask for these messages' extras; resolves to `{[id]: item}` (an item with
   * `error` when that message could not be read). A failed batch gives `{}`.
   * @param {string} meetingId @param {string[]} ids
   * @returns {Promise<Record<string, any>>}
   */
  function prefetch(meetingId, ids) {
    const batches = [];
    for (let at = 0; at < ids.length; at += BATCH) {
      const chunk = ids.slice(at, at + BATCH);
      const batch = api
        .get(
          `/api/meetings/${encodeURIComponent(meetingId)}/message-extras?ids=${chunk
            .map(encodeURIComponent)
            .join(',')}`,
        )
        .then((answer) => answer.items ?? {})
        .catch(() => ({}));
      for (const id of chunk)
        for (const name of /** @type {const} */ (['citations', 'knowledge']))
          parts[name].set(
            id,
            batch.then((items) =>
              items[id] && !items[id].error ? { value: items[id][name] } : null,
            ),
          );
      batches.push(batch);
    }
    return Promise.all(batches).then((found) => Object.assign({}, ...found));
  }

  /**
   * The batch's part for one message, once: `{ value }`, or null when the
   * batch did not cover it and the caller asks on its own.
   * @param {string} id @param {'citations' | 'knowledge'} name
   */
  async function take(id, name) {
    const entry = parts[name].get(id);
    if (!entry) return null;
    parts[name].delete(id);
    return entry;
  }

  return { prefetch, take };
}
