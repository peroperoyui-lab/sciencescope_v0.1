// One project log entry: its details (Markdown, edited in place as plain
// text) and its linked files, beside the entry's facts and the link form.
import { useEffect, useRef, useState } from 'preact/hooks';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { useActions, useAppState } from '../context.js';
import { renderMarkdown } from '../markdown.js';
import { navigate } from '../route.js';
import { MainHead } from './mainhead.js';
import { useSnapshotCapture } from '../resource-snapshots.js';
import { logEntryText, parseLog } from '../workbench-text.js';
import { InfoTip } from './info-tip.js';

export const JOURNAL_TABS = ['文件列表', '日志详情'];

/**
 * The entry's details: rendered Markdown that turns into its plain text when
 * clicked, and back when it loses focus.
 * @param {{ body: string, onChange: (body: string) => void, editing: boolean, setEditing: (editing: boolean) => void }} props
 */
function DetailsEditor({ body, onChange, editing, setEditing }) {
  const input = useRef(/** @type {HTMLTextAreaElement | null} */ (null));
  useEffect(() => {
    const field = input.current;
    if (!editing || !field) return;
    field.focus();
    field.style.height = `${field.scrollHeight + 2}px`;
  }, [editing]);
  if (editing)
    return html`<textarea
      ref=${input}
      class="journal-editor"
      aria-label=${t('编辑日志详情')}
      value=${body}
      onInput=${(event) => {
        const field = event.currentTarget;
        field.style.height = 'auto';
        field.style.height = `${field.scrollHeight + 2}px`;
        onChange(field.value);
      }}
      onBlur=${() => setEditing(false)}
    />`;
  return html`<div
    class="rendered-markdown journal-details"
    role="button"
    tabindex="0"
    title=${t('点击编辑')}
    aria-label=${t('编辑日志详情')}
    onClick=${(event) => !event.target.closest('a') && setEditing(true)}
    onKeyDown=${(event) => event.key === 'Enter' && setEditing(true)}
    dangerouslySetInnerHTML=${{ __html: renderMarkdown(body || t('没有详细内容，点击添加。')) }}
  />`;
}

/**
 * @param {{projectId:string,entry:any,text:string,initial?:string,revisionId?:string,onSaved:()=>void}} props
 */
export function JournalEntry({
  projectId,
  entry,
  text,
  initial = '日志详情',
  revisionId,
  onSaved,
}) {
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
  const [editing, setEditing] = useState(false);
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
      setEditing(false);
      onSaved();
    }
    setBusy(false);
  }
  const dirty =
    body !== entry.body || JSON.stringify(references) !== JSON.stringify(entry.references);
  const discard = () => {
    setEditing(false);
    setBody(entry.body);
    setReferences(entry.references);
  };
  const open = (reference) => actions.attempt(() => actions.openLogFile(projectId, reference));
  return html`<div data-journal-entry>
    <div class="tabs">
      ${JOURNAL_TABS.map((name) => html`<button class=${`tab ${tab === name ? 'active' : ''}`} onClick=${() => setTab(name)}>${t(name)}</button>`)}
    </div>
    <div class="grid2" style="grid-template-columns:minmax(0,1.6fr) minmax(240px,1fr)">
      <div class="card">
        ${
          tab === '文件列表'
            ? html`<div class="filetree">
                ${references.map((reference, index) => html`<div class="row"><button class="linklike grow" onClick=${() => open(reference)}>${reference.label ?? reference.path ?? reference.id}</button><button class="btn tiny" aria-label=${t('移除关联')} onClick=${() => setReferences(references.filter((_, ordinal) => ordinal !== index))}>${t('移除')}</button></div>`)}${!references.length && html`<p>${t('暂无关联文件')}</p>`}
              </div>`
            : html`<${DetailsEditor}
                body=${body}
                onChange=${setBody}
                editing=${editing}
                setEditing=${setEditing}
              />`
        }
        ${
          // Pressing a button keeps the editor focused, so the layout does not
          // shift under the pointer before the click lands.
          dirty &&
          html`<div
            class="journal-savebar"
            role="status"
            onMouseDown=${(event) => event.target.closest('button') && event.preventDefault()}
          >
            <span>${t('有未保存的修改')}</span>
            <button class="btn tiny" disabled=${busy} onClick=${discard}>${t('放弃修改')}</button>
            <button class="btn primary tiny" disabled=${busy} onClick=${save}>${t('保存')}</button>
          </div>`
        }
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
  const [loads, setLoads] = useState(0);
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
  }, [projectId, line, loads]);
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
        ${entry && html`<${JournalEntry} projectId=${projectId} entry=${entry} text=${document.text} revisionId=${document.revisionId} initial=${initial} onSaved=${() => setLoads(loads + 1)} />`}
      </div>
    </div>
  </main>`;
}
