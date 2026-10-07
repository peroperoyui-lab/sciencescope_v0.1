import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { InfoTip } from './info-tip.js';

const states = {
  disabled: '已关闭',
  warming: '正在预热模型',
  downloading: '正在下载模型',
  indexing: '正在建立索引',
  paused: '对话运行中，索引已暂停',
  ready: '混合检索就绪',
  'model-missing': '模型未下载',
  unsupported: '未满足本地模型最低配置',
  error: '本地检索准备失败',
};
export function SemanticSettings() {
  const actions = useActions();
  const pushedStatus = useAppState((state) => state.semanticStatus);
  const settings = useAppState((state) => state.settings?.semantic);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  // A request samples state at its start. A later pushed state wins over that
  // sample, even when the HTTP response arrives after the event.
  const latestPush = useRef(pushedStatus);
  latestPush.current = pushedStatus;
  useEffect(() => {
    let current = true;
    const startedWith = latestPush.current;
    actions
      .semanticStatus()
      .then((value) => {
        if (current && latestPush.current === startedWith) {
          setStatus(value);
          setError('');
        }
      })
      .catch((caught) => {
        if (current) setError(caught.message);
      });
    return () => {
      current = false;
    };
  }, [settings?.enabled]);
  useEffect(() => {
    if (pushedStatus) setStatus(pushedStatus);
  }, [pushedStatus]);
  async function run(action) {
    setPending(true);
    setError('');
    const startedWith = latestPush.current;
    try {
      let value;
      if (action === 'toggle') {
        await actions.updateSettings({ semantic: { enabled: !status.enabled } });
        value = await actions.semanticStatus();
      } else
        value = await (action === 'download'
          ? actions.semanticDownload()
          : actions.semanticRebuild());
      if (latestPush.current === startedWith) setStatus(value);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setPending(false);
    }
  }
  if (!settings && !status) return null;
  return html`<section data-semantic-settings>
    <h2>
      ${t('本地混合检索')}<${InfoTip}
        text=${t('模型仅在本机运行，首次下载需要明确点击。对话期间暂停建立索引。模型缺失、索引未完成、版本不一致或语义检索超时时，本次使用关键词检索。重建索引不会改动资料原件。')}
        label=${t('混合检索说明')}
      />
    </h2>
    ${!status && !error && html`<p role="status">${t('正在读取检索状态…')}</p>`}
    ${
      status &&
      html`<p role="status">${t(states[status.state] ?? status.state)}</p>
        <p>
          <code
            >${typeof status.model === 'string' ? status.model : (status.model?.name ?? 'multilingual-e5-small · int8 · 384')}</code
          >
        </p>
        ${status.hardware && html`<p>${t('硬件状态')} · ${status.hardware.supported ? t('满足本地模型配置') : t('未满足本地模型最低配置')}</p>`}
        ${status.hardware && !status.hardware.supported && html`<p role="alert">${t('需要 AVX2、8 GB 内存及 5 GB 可用空间；当前使用关键词检索。')}</p>`}
        ${status.enabled && status.state !== 'ready' && html`<p>${t('本次为关键词检索')}</p>`}
        <p>${t('索引进度')} ${status.indexed} / ${status.total}</p>
        ${status.download && html`<p>${t('下载进度')} ${status.download.completed} / ${status.download.files}${status.download.bytes ? ` · ${(status.download.bytes / 1048576).toFixed(1)} MB` : ''}</p>`}
        ${status.error && html`<p role="alert">${status.error}</p>`}
        <div class="saverow">
          <button class="btn" disabled=${pending} onClick=${() => run('toggle')}>
            ${status.enabled ? t('关闭语义检索') : t('开启语义检索')}</button
          ><button
            class="btn"
            disabled=${pending || status.state === 'downloading'}
            onClick=${() => run('download')}
          >
            ${t('下载或修复本地模型')}</button
          ><button
            class="btn"
            disabled=${pending || !status.enabled}
            onClick=${() => run('rebuild')}
          >
            ${t('重新检查索引')}
          </button>
        </div>`
    }
    ${error && html`<p role="alert">${error}</p>`}
  </section>`;
}
