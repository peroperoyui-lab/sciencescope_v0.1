// Settings → 关于 (design system PageSettingsAbout): mark, name, version and
// one sentence; checking for updates (a new version shows one line and
// 更新并重启); then credits and licence.
import { useEffect, useState } from 'preact/hooks';
import { useActions } from '../context.js';
import { html } from '../html.js';
import { formatTime, t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { LogoMark } from '../illustrations.js';
import { checkNow, installNow, supported, useUpdate } from '../update-state.js';
import { Row, Section, Switch, useSetting } from './settings-kit.js';

/** "10-24 发布" from the release date. @param {string | null} date */
const released = (date) => (date ? t('{date} 发布', { date: formatTime(date) }) : '');

function UpdateSection() {
  const update = useUpdate();
  const [settings, write] = useSetting((value) => value.updates);
  const native = supported();
  const last = update.checkedAt ?? settings?.lastCheckedAt ?? null;
  const notes = (update.release?.notes ?? '').trim();
  const busy = Boolean(update.phase);
  return html`<${Section} title=${t('更新')} attrs=${{ 'data-updates': '' }}>
    ${
      update.release &&
      html`<div class="ss-callout" role="status">
        <${Lucide} name="download" />
        <div class="ss-callout__body">
          <div class="ss-callout__title">
            ${t('有新版本 {version}', { version: update.release.version ?? '' })}
          </div>
          ${[released(update.release.date), notes.split(/\r?\n/)[0]].filter(Boolean).join(' · ')}
          ${
            notes.includes('\n') &&
            html`<details class="ss-callout__details">
              <summary>${t('查看全部说明')}</summary>
              <pre class="ss-prose">${notes}</pre>
            </details>`
          }
        </div>
        <div class="ss-callout__actions">
          <button
            type="button"
            class="ss-btn ss-btn--primary ss-btn--sm"
            disabled=${busy}
            onClick=${installNow}
          >
            <${Lucide} name="refresh-cw" />${busy ? t('正在更新…') : t('更新并重启')}
          </button>
        </div>
      </div>`
    }
    ${
      update.error &&
      html`<div class="ss-callout ss-callout--danger" role="alert">
        <${Lucide} name="circle-alert" />
        <div class="ss-callout__body">
          <div class="ss-callout__title">${t('检查更新没有成功')}</div>
          ${update.error} ${t('请检查网络后再试。')}
        </div>
      </div>`
    }
    <${Row}
      label=${t('自动检查更新')}
      desc=${t('每天最多检查一次，有新版本时提示你，不会自己安装')}
    >
      <${Switch}
        label=${t('自动检查更新')}
        checked=${settings?.autoCheck !== false}
        onChange=${(on) => write({ updates: { autoCheck: on } })}
      />
    <//>
    <${Row}
      label=${update.upToDate ? t('已是最新版本') : t('上次检查')}
      desc=${
        native
          ? last
            ? formatTime(new Date(last).toISOString())
            : t('还没有检查过')
          : t('只有安装版能检查更新')
      }
    >
      ${
        native &&
        html`<button
          type="button"
          class="ss-btn ss-btn--ghost ss-btn--sm"
          disabled=${update.checking || busy}
          onClick=${checkNow}
        >
          ${update.checking ? html`<span class="ss-spin"></span>` : html`<${Lucide} name="refresh-cw" />`}
          ${update.checking ? t('正在检查…') : t('立即检查')}
        </button>`
      }
    <//>
  <//>`;
}

export function AboutPage() {
  const actions = useActions();
  const [info, setInfo] = useState(/** @type {any} */ (null));
  useEffect(() => {
    void actions.attempt(async () => setInfo(await actions.systemInfo()));
  }, []);
  return html`<div class="ss-settings__inner about-page" data-about>
    <div class="ss-about__head">
      <${LogoMark} className="ss-about__mark" />
      <div class="ss-about__name">ScienceScope</div>
      ${info && html`<div class="ss-about__version">${info.version}</div>`}
      <div class="ss-about__text">
        ${t('本地学术研究助手：几位 AI 专家和你一起读文献、做分析、写论文。')}
      </div>
    </div>
    <${UpdateSection} />
    <${Section} title=${t('关于')}>
      <${Row} label=${t('发布者')} desc="peroperoyui" />
      <${Row}
        label=${t('参与开发')}
        desc=${t('Codex（AI 辅助开发）、Claude（Anthropic，AI 辅助审阅与开发）')}
      />
      <${Row} label=${t('许可证')} desc=${t('MIT；随附的第三方软件各有自己的许可证')}>
        ${
          info?.files.notices &&
          html`<button
            class="ss-btn ss-btn--sm"
            type="button"
            onClick=${() => actions.attempt(() => actions.openSystemFile('notices'))}
          >
            ${t('第三方声明')}
          </button>`
        }
      <//>
    <//>
  </div>`;
}
