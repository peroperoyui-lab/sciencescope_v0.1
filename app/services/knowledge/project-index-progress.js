// Transient progress is coalesced per project, including the terminal event.
// GET status stays immediate even while the next SSE notification is waiting.
import { performance } from 'node:perf_hooks';

/**
 * @param {import('../../core/index.js').Core} core
 */
export function createIndexProgress(core) {
  const pending = new Map();
  function publish(projectId, value) {
    let entry = pending.get(projectId);
    if (!entry) {
      entry = { last: -Infinity, timer: null, value };
      pending.set(projectId, entry);
    }
    entry.value = value;
    const emit = () => {
      entry.timer = null;
      entry.last = performance.now();
      core.events.transient(
        'research.index.progress',
        { projectId, ...entry.value },
        { projectId },
      );
    };
    const delay = Math.max(0, 1000 - (performance.now() - entry.last));
    if (!delay) {
      clearTimeout(entry.timer);
      emit();
    } else if (!entry.timer) entry.timer = setTimeout(emit, Math.ceil(delay));
  }
  return {
    publish,
    close() {
      for (const entry of pending.values()) clearTimeout(entry.timer);
      pending.clear();
    },
  };
}
