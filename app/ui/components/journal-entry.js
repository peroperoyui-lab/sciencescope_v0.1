// P12 retains the brief/files/details tabs and the original two-column layout.
import { useEffect, useState } from 'preact/hooks';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { useActions, useAppState } from '../context.js';
import { renderMarkdown } from '../markdown.js';
import { navigate } from '../route.js';
import { MainHead } from './mainhead.js';
import { useSnapshotCapture } from '../resource-snapshots.js';
import { logEntryText, parseLog } from '../workbench-text.js';
import { InfoTip } from './info-tip.js';

/**
 * @param {{projectId:string,entry:any,text:string,initial?:string,revisionId?:string}} props
 */
export function JournalEntry({ projectId, entry, text, initial = '日志详情', revisionId }) {
  const actions = useActions();
  useAppState((state) => state.settings?.appearance?.language);
  const project = useAppState((state) => state.projects.find((item) => item.id === projectId));
  const [tab, setTab] = useState(initial);
  const [body, setBody] = useState(entry.body);
  const [references, setReferences] = useState(entry.references);
  const [versions, setVersions] = useState([]);
  const [version, setVersion] = useState('');
  const [file, setFile] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    actions
      .versionGroups(projectId)
      .then((groups) => setVersions(groups.flatMap((group) => group.versions)))
      .catch((error) => actions.toast(error.message));
  }, [projectId]);
  async function save() {
    setBusy(true);
    const lines = text.split('\n');
    lines.splice(
      entry.start,
      entry.end - entry.start,
      logEntryText(entry.title, body, entry.date, references).trimStart(),
    );
    const result = await actions.attempt(() =>
      actions.editResource('log', projectId, 'write', { text: lines.join('\n') }, revisionId),
    );
    if (result) {
      await actions.captureSnapshot('log', projectId);
      navigate({ view: 'workbench', id: projectId });
    }
    setBusy(false);
  }
  const open = (reference) => actions.attempt(() => actions.openLogFile(projectId, reference));
  return html`<div data-journal-entry>
    <div class="tabs">
      ${['简述', '文件列表', '日志详情'].map((name) => html`<button class=${`tab ${tab === name ? 'active' : ''}`} onClick=${() => setTab(name)}>${t(name)}</button>`)}
    </div>
    <div class="grid2" style="grid-template-columns:minmax(0,1.6fr) minmax(240px,1fr)">
      <div class="card">
        ${tab === '文件列表' ? html`<div class="filetree">${references.map((reference, index) => html`<div class="row"><button class="linklike grow" onClick=${() => open(reference)}>${reference.label ?? reference.path ?? reference.id}</button><button class="btn tiny" aria-label=${t('移除关联')} onClick=${() => setReferences(references.filter((_, ordinal) => ordinal !== index))}>${t('移除')}</button></div>`)}${!references.length && html`<p>${t('暂无关联文件')}</p>`}</div>` : html`<div class="rendered-markdown" dangerouslySetInnerHTML=${{ __html: renderMarkdown(tab === '简述' ? body.split(/\n\s*\n/)[0] : body) }} />`}
      </div>
      <div class="stack">
        <div class="card">
          <h3>${t('节点信息')}</h3>
          <p>${entry.date}</p>
          <p>${t('所属项目')} · ${project?.name ?? ''}</p>
        </div>
        <div class="card">
          <h3>${t('关联文件')}</h3>
          <label class="field"
            ><span class="label">${t('稿件版本')}</span
            ><select
              aria-label=${t('关联稿件版本')}
              value=${version}
              onChange=${(event) => setVersion(event.currentTarget.value)}
            >
              <option value="">${t('选择版本')}</option>
              ${versions.map((item) => html`<option value=${item.id}>v${item.number} · ${item.name}</option>`)}
            </select></label
          ><button
            class="btn tiny"
            disabled=${!version}
            onClick=${() => {
              const item = versions.find((candidate) => candidate.id === version);
              setReferences([
                ...references,
                { schema: 1, kind: 'version', projectId, id: version, label: item.name },
              ]);
              setVersion('');
              setTab('文件列表');
            }}
          >
            ${t('关联版本')}
          </button>
          <label class="field"
            ><span class="label">${t('项目文件路径')}</span
            ><input
              aria-label=${t('项目文件路径')}
              value=${file}
              onInput=${(event) => setFile(event.currentTarget.value)} /></label
          ><button
            class="btn tiny"
            disabled=${!file.trim()}
            onClick=${() => {
              setReferences([
                ...references,
                {
                  schema: 1,
                  kind: 'project-file',
                  projectId,
                  path: file.trim(),
                  label: file.trim(),
                },
              ]);
              setFile('');
              setTab('文件列表');
            }}
          >
            ${t('关联项目文件')}</button
          ><${InfoTip}
            text=${t('填写项目文件夹中的相对路径；关联保存后随日志历史版本一起保留。')}
          />
        </div>
        <div class="card">
          <h3>${t('补充说明')}</h3>
          <textarea
            aria-label=${t('编辑日志详情')}
            value=${body}
            onInput=${(event) => setBody(event.currentTarget.value)}
          /><button class="btn primary" disabled=${busy} onClick=${save}>${t('保存')}</button>
        </div>
      </div>
    </div>
  </div>`;
}

/**
 * @param {{projectId:string,line:number,initial:string}} props
 */
export function JournalEntryPage({ projectId, line, initial }) {
  const actions = useActions();
  const project = useAppState((state) => state.projects.find((item) => item.id === projectId));
  const [document, setDocument] = useState(null);
  useSnapshotCapture([['log', projectId]]);
  useEffect(() => {
    let active = true;
    actions
      .readResource('log', projectId)
      .then((value) => active && setDocument(value))
      .catch((error) => actions.toast(error.message));
    return () => {
      active = false;
    };
  }, [projectId, line]);
  const entry = document && parseLog(document.text).find((item) => item.start === line);
  return html`<main class="main">
    <${MainHead} crumb=${project?.name ?? ''} title=${t('项目日志')} />
    <div class="mainbody">
      <div class="content">
        <div class="pageintro between">
          <h1>${entry?.title ?? ''}</h1>
          <button class="btn" onClick=${() => navigate({ view: 'workbench', id: projectId })}>
            ${t('返回工作站')}
          </button>
        </div>
        ${entry && html`<${JournalEntry} projectId=${projectId} entry=${entry} text=${document.text} revisionId=${document.revisionId} initial=${initial} />`}
      </div>
    </div>
  </main>`;
}
