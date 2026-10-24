// Settings → 数据与备份 (design system PageSettingsData): export everything
// to a folder (progress, cancel, the finished folder), where the data lives,
// and the runtime. An export runs in the background; chatting goes on.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { Head, Row, Section, Switch } from './settings-kit.js';

const FOLDERS = [
  ['root', '全部数据'],
  ['database', '数据库与设置'],
  ['projects', '项目'],
  ['library', '资料库原件'],
];

/** "81 MB". @param {number} bytes */
const size = (bytes) =>
  bytes >= 1073741824
    ? `${(bytes / 1073741824).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / 1048576))} MB`;
const count = (n) => Number(n ?? 0).toLocaleString('en-US');

/** A folder from the native picker, or null when there is none or the person cancelled. */
async function pickFolder() {
  const dialog = globalThis.__TAURI__?.dialog;
  if (!dialog?.open) return undefined;
  const chosen = await dialog.open({ directory: true, title: t('选择导出到哪个文件夹') });
  return typeof chosen === 'string' ? chosen : null;
}

function ExportSection() {
  const actions = useActions();
  const [copies, setCopies] = useState(false);
  const [target, setTarget] = useState('');
  const [job, setJob] = useState(/** @type {{ id: string, status: any } | null} */ (null));
  const timer = useRef(/** @type {any} */ (null));
  const native = Boolean(globalThis.__TAURI__?.dialog?.open);
  useEffect(() => () => clearTimeout(timer.current), []);

  /** @param {string} id */
  async function follow(id) {
    const status = await actions.attempt(() => actions.exportStatus(id));
    if (!status) return;
    setJob({ id, status });
    if (!['finished', 'failed', 'cancelled'].includes(status.phase))
      timer.current = setTimeout(() => follow(id), 800);
  }
  async function start(folder) {
    const started = await actions.attempt(() =>
      actions.startExport({ target: folder, includeProjectCopies: copies }),
    );
    if (started?.jobId) void follow(started.jobId);
  }
  async function choose() {
    const folder = native ? await pickFolder() : target.trim();
    if (folder) void start(folder);
  }
  const status = job?.status;
  const running = status && !['finished', 'failed', 'cancelled'].includes(status.phase);
  const percent = status?.total ? Math.min(100, Math.round((status.done / status.total) * 100)) : 0;

  return html`<${Section} title=${t('导出全部数据')} attrs=${{ 'data-export': '' }}>
    <p class="ss-settings__desc" style="margin:0 0 8px">
      ${t('对话、纪要、工作站、知识库、专家、技能和设置导成 Markdown 和 JSON，资料原件照原样复制，再附一份数据库副本。不含任何密钥。')}
    </p>
    <${Row}
      label=${t('同时复制项目文件夹里的文件')}
      desc=${t('这些文件本来就在你的项目文件夹里，默认不重复复制')}
    >
      <${Switch}
        label=${t('同时复制项目文件夹里的文件')}
        checked=${copies}
        disabled=${running}
        onChange=${setCopies}
      />
    <//>
    <${Row} label=${t('导出到')} desc=${native ? '' : t('填一个这台电脑上的文件夹')}>
      ${
        !native &&
        html`<span class="ss-input ss-input--sm" style="width:240px"
          ><input
            aria-label=${t('导出到哪个文件夹')}
            placeholder=${t('文件夹路径')}
            value=${target}
            onInput=${(event) => setTarget(event.currentTarget.value)}
        /></span>`
      }
      <button
        type="button"
        class="ss-btn ss-btn--primary ss-btn--sm"
        disabled=${running || (!native && !target.trim())}
        onClick=${choose}
      >
        <${Lucide} name="file-output" />${native ? t('选择文件夹并导出') : t('导出')}
      </button>
    <//>
    ${
      running &&
      html`<div class="ss-export" aria-live="polite">
        <div class="ss-export__head">
          <span class="ss-spin"></span>
          <span>
            ${
              status.total
                ? t('正在导出 · {done} / {total} 个文件', {
                    done: count(status.done),
                    total: count(status.total),
                  })
                : t('正在准备导出…')
            }
          </span>
          <span class="ss-toolbar__spacer"></span>
          <button
            type="button"
            class="ss-btn ss-btn--ghost ss-btn--sm"
            onClick=${() => actions.attempt(() => actions.cancelExport(job.id))}
          >
            ${t('取消')}
          </button>
        </div>
        <div
          class="ss-progress"
          role="progressbar"
          aria-label=${t('导出进度')}
          aria-valuenow=${percent}
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <span class="ss-progress__bar" style=${`width:${percent}%`}></span>
        </div>
        <span class="ss-field__hint">
          ${t('导出时可以照常对话。取消后留下的文件夹名字带「（未完成）」。')}
        </span>
      </div>`
    }
    ${
      status?.phase === 'finished' &&
      html`<div class="ss-callout ss-callout--ok" style="margin-top:8px" role="status">
        <${Lucide} name="circle-check" />
        <div class="ss-callout__body">
          <div class="ss-callout__title">
            ${t('已导出 {files} 个文件 · {size}', { files: count(status.done), size: size(status.bytes) })}
          </div>
          <span class="ss-mono">${status.folder}</span>
        </div>
        <div class="ss-callout__actions">
          <button
            type="button"
            class="ss-btn ss-btn--sm"
            onClick=${() => actions.attempt(() => actions.openExport(job.id))}
          >
            <${Lucide} name="folder-open" />${t('打开文件夹')}
          </button>
        </div>
      </div>`
    }
    ${
      status?.phase === 'failed' &&
      html`<div class="ss-callout ss-callout--danger" style="margin-top:8px" role="alert">
        <${Lucide} name="circle-alert" />
        <div class="ss-callout__body">
          <div class="ss-callout__title">${t('导出没有完成')}</div>
          ${status.error ?? ''}
          ${t('已导出的部分在名字带「（未完成）」的文件夹里，可以删掉后重试。')}
        </div>
      </div>`
    }
    ${
      status?.phase === 'cancelled' &&
      html`<p class="ss-settings__desc" role="status">
        ${t('已取消。留下的文件夹名字带「（未完成）」，可以删掉。')}
      </p>`
    }
  <//>`;
}

export function DataPage() {
  const actions = useActions();
  const [info, setInfo] = useState(/** @type {any} */ (null));
  useEffect(() => {
    void actions.attempt(async () => setInfo(await actions.systemInfo()));
  }, []);
  return html`<div class="ss-settings__inner" data-settings="data">
    <${Head}
      title=${t('数据与备份')}
      desc=${t('所有内容都在安装目录的 data 文件夹里，卸载时默认保留。')}
    />
    <${ExportSection} />
    <${Section}
      title=${t('数据位置')}
      tip=${t('数据库保存对话和设置，资料库保存导入的原件。这里不提供一键清空。')}
    >
      <div class="ss-list">
        ${
          info &&
          // A folder that is the data folder itself is listed once.
          FOLDERS.filter(
            ([name]) => name === 'root' || info.folders[name] !== info.folders.root,
          ).map(
            ([name, label]) =>
              html`<div class="ss-list-row ss-list-row--2" key=${name} data-folder=${name}>
                <${Lucide} name="folder" class="ss-list-row__icon" />
                <div class="ss-list-row__main">
                  <span class="ss-list-row__title">${t(label)}</span>
                  <span class="ss-list-row__sub ss-mono" title=${info.folders[name]}>
                    ${info.folders[name]}
                  </span>
                </div>
                <button
                  type="button"
                  class="ss-btn ss-btn--ghost ss-btn--sm"
                  aria-label=${t('打开{name}文件夹', { name: t(label) })}
                  onClick=${() => actions.attempt(() => actions.openFolder(name))}
                >
                  <${Lucide} name="folder-open" />${t('打开')}
                </button>
              </div>`,
          )
        }
      </div>
    <//>
    ${
      info &&
      html`<${Section} title=${t('运行时')}>
        <${Row}
          label=${t('程序')}
          desc=${`ScienceScope ${info.version} · Node ${info.runtime.node} · ${info.runtime.platform} · ${info.runtime.arch}`}
        />
      <//>`
    }
  </div>`;
}
