// Settings → 知识库与检索 (design system PageSettingsKnowledge): local hybrid
// search (its state as a result plus the next step, the switch, where the
// model downloads from), expansion along knowledge links, and paper cards.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import {
  AutoText,
  Head,
  ModelSelect,
  Row,
  Section,
  Select,
  Switch,
  useSetting,
} from './settings-kit.js';

/** Each state as a title, a tone and the next step. */
const STATES = {
  disabled: { title: '语义检索已关闭', tone: '', next: '现在只按关键词找资料。' },
  warming: { title: '正在预热模型', tone: 'busy', next: '好了以后自动改用混合检索。' },
  downloading: { title: '正在下载模型', tone: 'busy', next: '下载期间照常可以用关键词检索。' },
  indexing: { title: '正在建立索引', tone: 'busy', next: '没建完的资料先按关键词找。' },
  paused: { title: '对话进行中，索引暂停', tone: 'busy', next: '对话结束后接着建。' },
  ready: { title: '混合检索就绪', tone: 'ok', next: '' },
  'model-missing': {
    title: '还没有下载模型',
    tone: 'warn',
    next: '点「下载或修复模型」，约 120 MB。',
  },
  unsupported: {
    title: '这台电脑不满足本地模型的要求',
    tone: 'warn',
    next: '需要 AVX2、8 GB 内存和 5 GB 可用空间；现在只用关键词检索。',
  },
  error: { title: '本地检索没有准备好', tone: 'danger', next: '点「下载或修复模型」再试一次。' },
};

const SOURCES = [
  { value: 'official', text: '官方（Hugging Face）', description: '连不上时自动试 HF 镜像' },
  { value: 'modelscope', text: 'ModelScope（国内）' },
  { value: 'hf-mirror', text: 'HF 镜像' },
  { value: 'custom', text: '自定义地址' },
];

/** The state, pushed by events or read on open. */
function useSemanticStatus(enabled) {
  const actions = useActions();
  const pushed = useAppState((state) => state.semanticStatus);
  const [status, setStatus] = useState(/** @type {any} */ (null));
  const [error, setError] = useState('');
  // A request samples state at its start. A later pushed state wins over that
  // sample, even when the HTTP response arrives after the event.
  const latest = useRef(pushed);
  latest.current = pushed;
  useEffect(() => {
    let current = true;
    const startedWith = latest.current;
    actions
      .semanticStatus()
      .then((value) => current && latest.current === startedWith && setStatus(value))
      .catch((caught) => current && setError(caught.message));
    return () => {
      current = false;
    };
  }, [enabled]);
  useEffect(() => {
    if (pushed) setStatus(pushed);
  }, [pushed]);
  return { status, setStatus, error, setError, latest };
}

function StatusCallout({ status, error }) {
  if (error)
    return html`<div class="ss-callout ss-callout--danger" role="alert">
      <${Lucide} name="circle-alert" />
      <div class="ss-callout__body">${error}</div>
    </div>`;
  if (!status)
    return html`<p class="ss-settings__desc" role="status">${t('正在读取检索状态…')}</p>`;
  const shown = STATES[status.state] ?? { title: status.state, tone: '', next: '' };
  const model =
    typeof status.model === 'string'
      ? status.model
      : (status.model?.name ?? 'multilingual-e5-small');
  const details = [
    t('模型 {model}', { model }),
    status.total
      ? t('已建索引 {indexed} / {total} 份资料', { indexed: status.indexed, total: status.total })
      : '',
    status.download
      ? t('已下载 {done} / {files} 个文件', {
          done: status.download.completed,
          files: status.download.files,
        }) + (status.download.bytes ? ` · ${(status.download.bytes / 1048576).toFixed(1)} MB` : '')
      : '',
  ].filter(Boolean);
  const icon = { ok: 'circle-check', warn: 'triangle-alert', danger: 'circle-alert' }[shown.tone];
  return html`<div
    class=${`ss-callout ${shown.tone && shown.tone !== 'busy' ? `ss-callout--${shown.tone}` : ''}`}
    role="status"
    data-semantic-state=${status.state}
  >
    ${shown.tone === 'busy' ? html`<span class="ss-spin"></span>` : html`<${Lucide} name=${icon ?? 'info'} />`}
    <div class="ss-callout__body">
      <div class="ss-callout__title">${t(shown.title)}</div>
      ${[...details, shown.next && t(shown.next), status.error].filter(Boolean).join(' · ')}
    </div>
  </div>`;
}

export function KnowledgePage() {
  const actions = useActions();
  const [semantic, writeSemantic] = useSetting((settings) => settings.semantic);
  const [knowledge, writeKnowledge] = useSetting((settings) => settings.knowledge);
  const { status, setStatus, error, setError, latest } = useSemanticStatus(semantic?.enabled);
  const [pending, setPending] = useState(false);
  if (!semantic || !knowledge) return null;
  /** @param {'download' | 'rebuild'} action */
  async function run(action) {
    setPending(true);
    setError('');
    const startedWith = latest.current;
    try {
      const value = await (action === 'download'
        ? actions.semanticDownload()
        : actions.semanticRebuild());
      if (latest.current === startedWith) setStatus(value);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setPending(false);
    }
  }
  // The switch follows the setting at once; the status catches up when it is pushed.
  const enabled = semantic.enabled;
  return html`<div class="ss-settings__inner" data-settings="knowledge">
    <${Head} title=${t('知识库与检索')} />
    <${Section}
      title=${t('本地混合检索')}
      tip=${t('第一次使用要先下载模型（约 120 MB）。对话进行时索引会暂停。模型或索引没准备好时，自动改用关键词检索。')}
      attrs=${{ 'data-semantic-settings': '' }}
    >
      <${StatusCallout} status=${status} error=${error} />
      <${Row} label=${t('语义检索')} desc=${t('按意思找资料，不只看字面；模型只在这台电脑上运行')}>
        <${Switch}
          label=${t('语义检索')}
          checked=${enabled}
          disabled=${pending}
          onChange=${(on) => writeSemantic({ semantic: { enabled: on } })}
        />
      <//>
      <${Row} label=${t('模型下载源')} desc=${t('文件校验失败会报错，不会自己换源')}>
        <${Select}
          label=${t('模型下载源')}
          value=${semantic.downloadSource ?? 'official'}
          options=${SOURCES.map((source) => ({
            ...source,
            text: t(source.text),
            description: source.description && t(source.description),
          }))}
          onChange=${(downloadSource) => writeSemantic({ semantic: { downloadSource } })}
        />
      <//>
      ${
        semantic.downloadSource === 'custom' &&
        html`<${Row}
          label=${t('模型源地址')}
          desc=${t('和 Hugging Face 的 resolve 路径兼容的根地址')}
        >
          <${AutoText}
            label=${t('模型源地址')}
            width=${280}
            placeholder="https://"
            value=${semantic.customDownloadUrl ?? ''}
            onSave=${(url) => writeSemantic({ semantic: { customDownloadUrl: url.trim() } })}
          />
        <//>`
      }
      <${Row} label=${t('模型和索引')} desc=${t('重建索引不会改动资料原件')}>
        <button
          type="button"
          class="ss-btn ss-btn--sm"
          disabled=${pending || status?.state === 'downloading'}
          onClick=${() => run('download')}
        >
          <${Lucide} name="download" />${t('下载或修复模型')}
        </button>
        <button
          type="button"
          class="ss-btn ss-btn--ghost ss-btn--sm"
          disabled=${pending || !enabled}
          onClick=${() => run('rebuild')}
        >
          <${Lucide} name="refresh-cw" />${t('重新建立索引')}
        </button>
      <//>
    <//>
    <${Section} title=${t('检索方式')}>
      <${Row}
        label=${t('沿关系扩展')}
        desc=${t('顺着知识库里的关系多找几条：用词不同但讲同一件事的资料也能找到')}
      >
        <${Switch}
          label=${t('沿关系扩展')}
          checked=${knowledge.retrievalExpansion}
          onChange=${(on) => writeKnowledge({ knowledge: { retrievalExpansion: on } })}
        />
      <//>
    <//>
    <${Section} title=${t('论文卡片')}>
      <${Row}
        label=${t('自动整理论文卡片')}
        desc=${t('新导入的文献各整理一张卡片：问题、方法、发现、局限')}
      >
        <${Switch}
          label=${t('自动整理论文卡片')}
          checked=${knowledge.cards?.enabled !== false}
          onChange=${(on) => writeKnowledge({ knowledge: { cards: { enabled: on } } })}
        />
      <//>
      <${Row} label=${t('整理用的模型')} desc=${t('每篇用一次，会产生用量')}>
        <${ModelSelect}
          label=${t('论文卡片用的模型')}
          width=${200}
          value=${knowledge.cards?.model}
          emptyText=${t('跟随任务秘书')}
          onChange=${(model) => writeKnowledge({ knowledge: { cards: { model } } })}
        />
      <//>
    <//>
  </div>`;
}
