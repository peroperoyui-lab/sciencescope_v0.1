/** Process-local notifications. A subscriber never rejects a producer's work. */
export function createHostEvents({onError = () => {}, idleMs = 10 * 60 * 1000, isBusy = () => false} = {}) {
  const handlers = new Map(), running = new Set(), idle = new Map();
  let closed = false;
  function armIdle(chatId) {
    clearTimeout(idle.get(chatId));
    const timer=setTimeout(()=>{
      idle.delete(chatId);
      if(closed)return;
      // A long-running turn is not inactivity, even if its last commit was old.
      if(isBusy(chatId)){armIdle(chatId);return;}
      void emit('chat.idle',{chatId});
    },idleMs);
    timer.unref?.();idle.set(chatId,timer);
  }
  function on(type, handler) {
    if (closed) throw new Error('HOST_EVENTS_CLOSED');
    const set = handlers.get(type) ?? new Set();
    set.add(handler); handlers.set(type, set);
    return () => { set.delete(handler); if (!set.size) handlers.delete(type); };
  }
  function emit(type, payload = {}) {
    if (closed) return Promise.resolve();
    if ((type === 'chat.turn.persisted' || type === 'discussion.finished') && payload.chatId) {
      armIdle(payload.chatId);
    }
    const jobs = [...(handlers.get(type) ?? [])].map(handler => {
      const job = Promise.resolve().then(() => handler(payload)).catch(error => {
        try { onError(error, {type}); } catch { /* logging must also be isolated */ }
      }).finally(() => running.delete(job));
      running.add(job); return job;
    });
    return Promise.all(jobs).then(() => undefined);
  }
  async function close() {
    closed = true;
    for (const timer of idle.values()) clearTimeout(timer);
    idle.clear(); handlers.clear();
    while (running.size) await Promise.all([...running]);
  }
  return {on, emit, close};
}
