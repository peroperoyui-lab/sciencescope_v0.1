// Settings → 编辑台 (design system PageSettingsDesk): whether TeX was found
// and which engine compiles, and the names of the manuscript tiers. The page
// appears while the editing desk is turned on in 通用.
import { useEffect, useState } from 'preact/hooks';
import { useActions } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { Head, Row, Section, Select, useSetting } from './settings-kit.js';

const DISTRIBUTIONS = { miktex: 'MiKTeX', texlive: 'TeX Live', other: 'TeX' };
const NAMES = { xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX', pdflatex: 'pdfLaTeX' };

function TexSection() {
  const actions = useActions();
  const [engine, write] = useSetting((settings) => settings.desk?.tex?.engine ?? 'auto');
  const [found, setFound] = useState(/** @type {any} */ (null));
  const [checking, setChecking] = useState(false);
  const check = async (refresh = false) => {
    setChecking(true);
    await actions.attempt(async () => setFound(await actions.texEngines(refresh)));
    setChecking(false);
  };
  useEffect(() => {
    void check();
  }, []);
  const engines = found?.engines ?? [];
  const distribution = DISTRIBUTIONS[engines[0]?.distribution] ?? 'TeX';
  const recheck = html`<button
    type="button"
    class=${`ss-btn ss-btn--sm ${engines.length ? 'ss-btn--ghost' : ''}`}
    disabled=${checking}
    onClick=${() => check(true)}
  >
    <${Lucide} name="refresh-cw" />${t('重新检查')}
  </button>`;
  return html`<${Section}
    title=${t('TeX 编译')}
    tip=${t('ScienceScope 不自带 TeX。没装时，tex 文稿照样能编辑，只是不能生成 PDF。')}
    attrs=${{ 'data-tex-settings': '' }}
  >
    ${
      !found
        ? html`<p class="ss-settings__desc" role="status">${t('正在查找 TeX…')}</p>`
        : engines.length
          ? html`<div class="ss-callout ss-callout--ok" role="status">
              <${Lucide} name="circle-check" />
              <div class="ss-callout__body">
                ${t('找到 {name}：{engines} 都能用', {
                  name: distribution,
                  engines: engines.map((item) => NAMES[item.id] ?? item.id).join('、'),
                })}
              </div>
            </div>`
          : html`<div class="ss-callout ss-callout--warn" role="status">
              <${Lucide} name="triangle-alert" />
              <div class="ss-callout__body">
                <div class="ss-callout__title">${t('没有找到 TeX')}</div>
                ${t('tex 文稿可以照常编辑，但不能生成 PDF。安装 MiKTeX 或 TeX Live 后点「重新检查」。')}
              </div>
              <div class="ss-callout__actions">${recheck}</div>
            </div>`
    }
    <${Row}
      label=${t('编译引擎')}
      desc=${t('文稿里写了 ctex 或 fontspec 时用 XeLaTeX，否则用 pdfLaTeX')}
    >
      <${Select}
        label=${t('编译引擎')}
        width=${220}
        value=${engine}
        options=${[
          { value: 'auto', text: t('自动（按文稿选择）') },
          ...['xelatex', 'lualatex', 'pdflatex'].map((id) => ({
            value: id,
            text: NAMES[id],
            description:
              found && !engines.some((item) => item.id === id) ? t('这台电脑上没找到') : undefined,
          })),
        ]}
        onChange=${(next) => write({ desk: { tex: { engine: next } } })}
      />
    <//>
    ${
      engines.length > 0 &&
      html`<${Row} label=${t('重新检查')} desc=${t('装好或升级 TeX 以后点一下')}>${recheck}<//>`
    }
  <//>`;
}

/** One tier: its name, renamed in place (F2 or the pencil). */
function TierRow({ name, onRename }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);
  const finish = async (save) => {
    setEditing(false);
    if (save && text.trim() && text.trim() !== name) await onRename(text.trim());
    else setText(name);
  };
  return html`<div class="ss-list-row" data-tier=${name}>
    <div class="ss-list-row__main">
      ${
        editing
          ? html`<span class="ss-input ss-input--sm"
              ><input
                aria-label=${t('稿件分级名称')}
                value=${text}
                ref=${(element) => element?.focus()}
                onInput=${(event) => setText(event.currentTarget.value)}
                onKeyDown=${(event) => {
                  if (event.key === 'Enter') finish(true);
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    finish(false);
                  }
                }}
                onBlur=${() => finish(true)}
            /></span>`
          : html`<span class="ss-list-row__title">${name}</span>`
      }
    </div>
    <button
      type="button"
      class="ss-icon-btn ss-icon-btn--sm"
      aria-label=${t('重命名「{name}」', { name })}
      data-tip=${t('重命名')}
      onClick=${() => setEditing(true)}
    >
      <${Lucide} name="pencil" />
    </button>
  </div>`;
}

export function DeskPage() {
  const actions = useActions();
  const [tiers] = useSetting((settings) => settings.desk?.tiers ?? []);
  return html`<div class="ss-settings__inner" data-settings="desk">
    <${Head} title=${t('编辑台')} desc=${t('编辑台还在试用，在「通用」里打开后这一页才出现。')} />
    <${TexSection} />
    <${Section}
      title=${t('稿件分级')}
      tip=${t('版本树里给版本标的级别。改名后，已经标了这个级别的版本跟着改。')}
    >
      <div class="ss-list">
        ${tiers.map(
          (name) =>
            html`<${TierRow}
              key=${name}
              name=${name}
              onRename=${(to) => actions.attempt(() => actions.renameTier(name, to))}
            />`,
        )}
      </div>
    <//>
  </div>`;
}
