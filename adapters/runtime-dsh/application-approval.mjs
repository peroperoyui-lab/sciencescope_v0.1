import { randomUUID } from 'node:crypto';

/** A narrow bridge for application tools that need the existing approval UI. */
export function createApplicationApprovalManager({ emit, isSessionActive, createRequestId = randomUUID } = {}) {
  if (typeof emit !== 'function' || typeof isSessionActive !== 'function') {
    throw new TypeError('emit and isSessionActive callbacks are required');
  }
  const pending = new Map();

  function isApplicationRequest(requestId) {
    return typeof requestId === 'string' && requestId.startsWith('app-');
  }

  function cancel(requestId, entry, reason) {
    if (!pending.delete(requestId)) return false;
    entry.signal?.removeEventListener('abort', entry.onAbort);
    entry.resolve(false);
    emit(entry.sessionId, { type: 'approval-cancelled', requestId, ...(reason ? { reason } : {}) });
    return true;
  }

  function request(args = {}) {
    const { sessionId, toolName, reason, packages, targetEnvironment, expertId, signal } = args;
    if (typeof sessionId !== 'string' || !isSessionActive(sessionId)) throw new Error(`Unknown DSH session: ${sessionId ?? ''}`);
    if (typeof toolName !== 'string' || !toolName.trim()) throw new TypeError('toolName is required');
    if (typeof reason !== 'string') throw new TypeError('reason is required');
    if (!Array.isArray(packages) || packages.some((item) => typeof item !== 'string')) throw new TypeError('packages must be an array of strings');
    if (typeof targetEnvironment !== 'string' || !targetEnvironment.trim()) throw new TypeError('targetEnvironment is required');
    if (signal?.aborted) return Promise.resolve(false);
    const suffix = String(createRequestId()).replaceAll('-', '');
    const requestId = `app-${suffix}`;
    return new Promise((resolve) => {
      const entry = { sessionId, expertId, resolve, signal, onAbort: null };
      entry.onAbort = () => cancel(requestId, entry, 'tool call cancelled');
      pending.set(requestId, entry);
      signal?.addEventListener('abort', entry.onAbort, { once: true });
      if (signal?.aborted) { entry.onAbort(); return; }
      emit(sessionId, {
        type: 'approval-request', requestId, toolName, reason, packages: [...packages], targetEnvironment,
        ...(typeof expertId === 'string' && expertId ? { expertId } : {}),
      });
    });
  }

  function reply({ sessionId, requestId, outcome } = {}) {
    if (!isApplicationRequest(requestId)) return null;
    const entry = pending.get(requestId);
    if (!entry) throw new Error('Unknown or expired application approval request');
    if (entry.sessionId !== sessionId) throw new Error('Application approval belongs to another session');
    if (outcome !== 'allowed-once' && outcome !== 'rejected') throw new TypeError('Invalid application approval outcome');
    pending.delete(requestId);
    entry.signal?.removeEventListener('abort', entry.onAbort);
    entry.resolve(outcome === 'allowed-once');
    return true;
  }

  function cancelSession(sessionId, reason = 'session interrupted') {
    for (const [requestId, entry] of pending) {
      if (entry.sessionId === sessionId) cancel(requestId, entry, reason);
    }
  }

  function cancelExperts(sessionId, expertIds, reason = 'expert run cancelled') {
    const ids = new Set(expertIds ?? []);
    if (!ids.size) return;
    for (const [requestId, entry] of pending) {
      if (entry.sessionId === sessionId && entry.expertId && ids.has(entry.expertId)) cancel(requestId, entry, reason);
    }
  }

  function cancelAll(reason = 'host closing') {
    for (const [requestId, entry] of pending) cancel(requestId, entry, reason);
  }

  return { request, reply, cancelSession, cancelExperts, cancelAll, isApplicationRequest };
}
