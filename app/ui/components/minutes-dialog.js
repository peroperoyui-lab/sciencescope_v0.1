// The legacy conversation-minutes dialog: the secretary builds on saved edits.
// Keep the editing revision separate from live status so a background update
// cannot replace a draft or silently change its optimistic revision.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { renderMarkdown } from '../markdown.js';
import { useSnapshotCapture } from '../resource-snapshots.js';
import { ResourceHistory } from './resource-history.js';
import { InfoTip } from './info-tip.js';

const HELP =
  '任务秘书按自动总结设置或手动请求更新纪要；没有新内容时不调用模型。所有专家都能读取纪要并按编号回查原文。\n你的修改会成为最新一版，秘书之后在此基础上继续整理。';

/**
 * @param {{ meetingId: string }} props
 * @returns {import('preact').VNode}
 */
export function MinutesDialog({ meetingId }) {
  const actions = useActions();
  const version = useAppState((state) => state.minutesVersion);
  const messages = useAppState((state) => state.messages[meetingId]);
  const [data, setData] = useState(/** @type {any} */ (null));
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  useSnapshotCapture([['minutes', meetingId]]);
  const revision = useRef(null);
  const input = useRef(null);

  useEffect(() => {
    let current = true;
    actions
      .readMinutes(meetingId)
      .then((next) => {
        if (current) {
          setData(next);
          setError('');
        }
      })
      .catch((failure) => current && setError(failure.message));
    return () => {
      current = false;
    };
  }, [meetingId, version, messages]);

  // The status event normally settles the view. Poll only an open dialog whose
  // secretary is still running, including a task started before it was opened.
  useEffect(() => {
    if (!data?.updating || busy) return undefined;
    const timer = setTimeout(async () => {
      try {
        setData(await actions.readMinutes(meetingId));
      } catch (failure) {
        setError(failure.message);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [data, busy]);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  async function save() {
    setBusy(true);
    setError('');
    try {
      setData(await actions.editMinutes(meetingId, text, revision.current));
      setEditing(false);
      actions.toast(t('纪要已保存；秘书之后会在此基础上继续整理。'));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setError('');
    try {
      setData(await actions.refreshMinutes(meetingId));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  const next = [];
  if (Number.isFinite(data?.messagesRemaining))
    next.push(t('再 {count} 条消息', { count: data.messagesRemaining }));
  const thresholds = [...next];
  if (Number.isFinite(data?.tokensRemaining))
    thresholds.push(t('约 {count} token', { count: data.tokensRemaining }));
  const help = [
    t(HELP),
    thresholds.length
      ? t('下次自动总结：{remaining}', { remaining: thresholds.join(t(' 或 ')) })
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  const metadata = [];
  if (data?.revision) {
    if (data.author)
      metadata.push(
        ['user', 'person_user'].includes(data.author) ? t('由你编辑') : t('任务秘书整理'),
      );
    if (data.revisionNumber != null)
      metadata.push(t('第 {revision} 版', { revision: data.revisionNumber }));
    metadata.push(
      t('涵盖第 1–{through} 条（共 {latest} 条）', {
        through: data.throughSeq,
        latest: data.latestSeq,
      }),
    );
  }
  if (!data) metadata.push(t('正在读取…'));
  if (busy || data?.updating) metadata.push(t('任务秘书正在整理…'));

  if (showHistory)
    return html`<div>
      <button class="btn tiny" onClick=${() => setShowHistory(false)}>${t('返回纪要')}</button
      ><${ResourceHistory} query=${{ resource: 'minutes', key: meetingId }} />
    </div>`;

  return html`<div class="minutes-dialog" data-meeting-id=${meetingId}>
    <p class="minutes-meta">
      <span data-minutes-meta>${metadata.join(' · ')}</span>
      <${InfoTip} text=${help} label=${t('对话纪要说明')} />
    </p>
    <p class="minutes-meta" data-minutes-next>
      ${next.length ? t('下次自动总结：{remaining}', { remaining: next.join(t(' 或 ')) }) : ''}
    </p>
    <p role="status" data-minutes-status>
      ${[error, data?.error, data?.workbenchError].filter(Boolean).join(' · ')}
    </p>
    <div class="minutes-body rendered-markdown" data-minutes-body>
      ${
        editing
          ? html`<textarea
              ref=${input}
              data-minutes-text
              aria-label=${t('纪要内容')}
              value=${text}
              onInput=${(event) => setText(event.currentTarget.value)}
            ></textarea>`
          : data?.revision
            ? html`<div dangerouslySetInnerHTML=${{ __html: renderMarkdown(data.text) }}></div>`
            : data && html`<p class="minutes-empty">${t('还没有纪要。')}</p>`
      }
    </div>
    ${
      data?.incompleteOutput &&
      html`<details>
        <summary>${t('未完成的秘书输出')}</summary>
        <div
          class="minutes-body rendered-markdown"
          dangerouslySetInnerHTML=${{ __html: renderMarkdown(data.incompleteOutput) }}
        ></div>
      </details>`
    }
    <div class="saverow">
      ${
        editing
          ? html`<button
                type="button"
                class="btn"
                data-minutes-cancel
                disabled=${busy}
                onClick=${() => setEditing(false)}
              >
                ${t('取消')}
              </button>
              <button
                type="button"
                class="btn primary"
                data-minutes-save
                disabled=${busy}
                onClick=${save}
              >
                ${t('保存纪要')}
              </button>`
          : html`<button type="button" class="btn" onClick=${() => setShowHistory(true)}>
                ${t('历史版本')}</button
              ><button
                type="button"
                class="btn"
                data-minutes-refresh
                disabled=${!data || busy || data.updating}
                onClick=${refresh}
              >
                ${t('让秘书更新')}
              </button>
              <button
                type="button"
                class="btn"
                data-minutes-edit
                disabled=${!data?.revision || busy || data?.updating}
                onClick=${() => {
                  revision.current = data.revision;
                  setText(data.text);
                  setEditing(true);
                }}
              >
                ${t('编辑')}
              </button>
              <button
                type="button"
                class="btn primary"
                data-minutes-close
                onClick=${actions.closeModal}
              >
                ${t('关闭')}
              </button>`
      }
    </div>
  </div>`;
}
