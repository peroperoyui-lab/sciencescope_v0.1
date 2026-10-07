import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { navigate } from '../route.js';
import { InfoTip } from './info-tip.js';

const STATES = {
  idle: '尚无整理记录',
  running: '正在整理候选记忆…',
  completed: '候选已整理，请到收件箱确认。',
  failed: '记忆整理失败；原文和已确认记忆保留。',
  skipped: '本次没有可整理的新证据。',
  waiting: '等待当前发言结束后整理。',
};

/**
 * @param {{ meetingId:string, projectId:string|null }} props
 * @returns {import('preact').VNode}
 */
export function MemoryStatusDialog({ meetingId, projectId }) {
  const actions = useActions();
  const version = useAppState((state) => state.memoryVersion);
  const [status, setStatus] = useState(/** @type {any} */ (null));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    actions
      .memoryStatus(meetingId)
      .then((next) => current && setStatus(next))
      .catch((failure) => current && setError(failure.message));
    return () => {
      current = false;
    };
  }, [meetingId, version]);
  useEffect(() => {
    if (!status?.running) return;
    const timer = setTimeout(
      () =>
        actions
          .memoryStatus(meetingId)
          .then(setStatus)
          .catch((failure) => setError(failure.message)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [status]);
  async function run() {
    setBusy(true);
    setError('');
    try {
      setStatus(await actions.runMemory(meetingId));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return html`<div class="memory-consolidation-dialog">
    <h2>
      ${t('候选记忆')}<${InfoTip}
        text=${t('空闲时只整理纪要的变化和对应原文；候选须在记忆收件箱接受后才进入主专家的项目简报。')}
      />
    </h2>
    <p role="status" data-consolidate-status>
      ${
        error ||
        status?.error?.message ||
        status?.error ||
        (status?.skipReason === 'budget'
          ? t('本次 token 预算不足；未处理批次保留，下次接着整理。')
          : busy
            ? t(STATES.running)
            : status
              ? t(STATES[status.state] ?? STATES.idle)
              : t('正在读取…'))
      }
    </p>
    ${
      status?.usage?.requests > 0 &&
      html`<p data-consolidate-usage>
        ${t('累计 token：{tokens} · 请求 {requests} 次', { tokens: status.usage.tokens ?? 0, requests: status.usage.requests })}
        · ${status.usage.estimatedRequests ? t('含估算用量') : t('服务商报告用量')}
      </p>`
    }
    ${
      status?.pending &&
      html`<p>${t('未处理批次保留，下次接着整理。')}</p>
        <p data-consolidate-pending>
          ${t('处理进度：第 {page} / {pages} 批', { page: (status.pending.pageIndex ?? 0) + 1, pages: status.pending.pages ?? 1 })}
        </p>`
    }
    ${(status?.retainedOutputs ?? []).map(
      (output) =>
        html`<details>
          <summary>${t('已保留的模型输出')}</summary>
          <pre>${output.text ?? output}</pre>
        </details>`,
    )}
    <div class="saverow">
      <button
        class="btn"
        data-consolidate-inbox
        onClick=${() => {
          actions.closeModal();
          navigate(projectId ? { view: 'database', id: projectId } : { view: 'library' });
          actions.openMemoryInbox(projectId);
        }}
      >
        ${t('打开记忆收件箱')}
      </button>
      <button
        class="btn primary"
        data-consolidate-run
        disabled=${busy || status?.running || !status}
        onClick=${run}
      >
        ${t('开始整理')}
      </button>
    </div>
  </div>`;
}
