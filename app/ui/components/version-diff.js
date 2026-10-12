// P09 uses the original paper columns and word-change colors; parsing is a
// projection, and restoring copies original bytes into a new numbered version.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { renderMarkdown } from '../markdown.js';
import { navigate } from '../route.js';
import { MainHead } from './mainhead.js';
import { InfoTip } from './info-tip.js';

/**
 * @param {{projectId:string,id:string}} props
 */
export function VersionDiff({ projectId, id }) {
  const actions = useActions();
  const project = useAppState((state) => state.projects.find((entry) => entry.id === projectId));
  const changed = useAppState((state) => state.versionsVersion);
  const [versions, setVersions] = useState([]);
  const [current, setCurrent] = useState(id);
  const [baseline, setBaseline] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [result, setResult] = useState(null);
  const [mode, setMode] = useState('side');
  const [position, setPosition] = useState(-1);
  const [busy, setBusy] = useState(false);
  const host = useRef(null);
  useEffect(() => {
    let active = true;
    actions
      .versionGroups(projectId)
      .then((groups) => {
        if (!active) return;
        const group = groups.find((entry) => entry.versions.some((version) => version.id === id));
        setVersions(group?.versions ?? []);
        if (!loaded) {
          setBaseline(group?.versions.find((version) => version.id === id)?.baselineId ?? null);
          setLoaded(true);
        }
      })
      .catch((error) => actions.toast(error.message));
    return () => {
      active = false;
    };
  }, [projectId, id, changed]);
  useEffect(() => {
    if (!loaded) return;
    let active = true;
    setResult(null);
    setPosition(-1);
    actions
      .compareVersions(current, baseline)
      .then((value) => active && setResult(value))
      .catch((error) => actions.toast(error.message));
    return () => {
      active = false;
    };
  }, [current, baseline, loaded, changed]);
  const differences =
    result?.changes.flatMap((part, index) => (part.type === 'unchanged' ? [] : [index])) ?? [];
  function jump(direction) {
    let next = (position + direction + differences.length) % differences.length;
    if (position < 0) next = direction > 0 ? 0 : differences.length - 1;
    setPosition(next);
    host.current
      ?.querySelector(`[data-diff-part="${differences[next]}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function piece(part, index) {
    return part.type === 'added'
      ? html`<ins class="diffadd" data-diff-part=${index}>${part.text}</ins>`
      : part.type === 'removed'
        ? html`<del class="diffdel" data-diff-part=${index}>${part.text}</del>`
        : part.text;
  }
  const select = (label, value, save, exclude) =>
    html`<label class="field"
      ><span class="label">${t(label)}</span
      ><select
        aria-label=${t(label)}
        value=${value ?? ''}
        onChange=${(event) => save(event.currentTarget.value || null)}
      >
        ${label === '旧版本' && html`<option value="">${t('首版，无前序版本')}</option>`}${versions.filter((version) => version.id !== exclude).map((version) => html`<option value=${version.id}>v${version.number} · ${version.name}</option>`)}
      </select></label
    >`;
  function restore() {
    actions.openModal(
      t('另存为新版本'),
      html`<div>
        <p>${t('复制旧版原件成为新的版本；已有版本和说明保持可查看。')}</p>
        <div class="row">
          <button class="btn" onClick=${actions.closeModal}>${t('取消')}</button
          ><button
            class="btn primary"
            disabled=${busy}
            onClick=${async () => {
              setBusy(true);
              await actions.attempt(async () => {
                const saved = await actions.saveVersionAsNew(baseline);
                actions.closeModal();
                navigate({ view: 'version-diff', id: `${projectId}/${saved.versions[0].id}` });
              });
              setBusy(false);
            }}
          >
            ${t('确认另存')}
          </button>
        </div>
      </div>`,
    );
  }
  return html`<main class="main" data-version-diff data-diff-position=${position}>
    <${MainHead} crumb=${project?.name ?? ''} title=${t('版本比较')} />
    <div class="mainbody" ref=${host}>
      <div class="content">
        <div class="row">
          ${select('旧版本', baseline, setBaseline, current)}${select('新版本', current, setCurrent, baseline)}
        </div>
        <div class="row" style="margin-bottom:20px">
          <button
            class=${`btn tiny ${mode === 'side' ? 'primary' : ''}`}
            onClick=${() => setMode('side')}
          >
            ${t('并排视图')}</button
          ><button
            class=${`btn tiny ${mode === 'unified' ? 'primary' : ''}`}
            onClick=${() => setMode('unified')}
          >
            ${t('统一差异')}
          </button>
          <button class="btn tiny" disabled=${!differences.length} onClick=${() => jump(-1)}>
            ${t('上一处变化')}</button
          ><button class="btn tiny" disabled=${!differences.length} onClick=${() => jump(1)}>
            ${t('下一处变化')}
          </button>
          <button
            class="btn tiny"
            disabled=${!baseline}
            onClick=${() => actions.attempt(() => actions.openVersion(baseline))}
          >
            ${t('打开旧原件')}</button
          ><button
            class="btn tiny"
            onClick=${() => actions.attempt(() => actions.openVersion(current))}
          >
            ${t('打开新原件')}
          </button>
          <button class="btn tiny" disabled=${!baseline} onClick=${restore}>
            ${t('另存为新版本')}</button
          ><${InfoTip} text=${t('比较的是完整提取文字；PDF 排版和解析差异不一定代表正文修改。')} />
        </div>
        <p role="status">
          ${result ? t({ ready: '可比较', unchanged: '无变化', 'originals-only': '仅原件可打开' }[result.status]) : t('正在读取…')}
        </p>
        ${
          result &&
          result.status !== 'originals-only' &&
          (mode === 'unified'
            ? html`<div class="docpaper version-diff-text">${result.changes.map(piece)}</div>`
            : html`<div class="grid2">
                <div class="docpaper version-diff-text">
                  <small>${t('旧版本')}</small
                  >${result.changes.map((part, index) => (part.type !== 'added' ? piece(part, index) : ''))}
                </div>
                <div class="docpaper version-diff-text">
                  <small>${t('新版本')}</small
                  >${result.changes.map((part, index) => (part.type !== 'removed' ? piece(part, index) : ''))}
                </div>
              </div>`)
        }
        <div class="card markdown" style="margin-top:20px">
          <div class="between">
            <h3>${t('版本说明')}</h3>
            <button
              class="btn tiny"
              onClick=${() => navigate({ view: 'version-notes', id: `${projectId}/${current}` })}
            >
              ${t('查看说明')}
            </button>
          </div>
          <div
            dangerouslySetInnerHTML=${{ __html: renderMarkdown(result?.current.notes?.text ?? '') }}
          />
        </div>
      </div>
    </div>
  </main>`;
}
