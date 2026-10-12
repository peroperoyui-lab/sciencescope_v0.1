// P14 follows the original two-column Markdown/relationship/notes layout.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { renderMarkdown } from '../markdown.js';
import { navigate } from '../route.js';
import { useSnapshotCapture } from '../resource-snapshots.js';
import { openResourceHistory } from './resource-history.js';
import { MainHead } from './mainhead.js';
import { InfoTip } from './info-tip.js';

/**
 * @param {{projectId:string,id:string}} props
 */
export function VersionNotes({ projectId, id }) {
  const actions = useActions();
  const changed = useAppState((state) => state.versionsVersion + state.workspaceVersion);
  const meetings = useAppState((state) => state.meetings);
  const projects = useAppState((state) => state.projects);
  const [document, setDocument] = useState(null);
  const [choices, setChoices] = useState([]);
  const [baseline, setBaseline] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState('');
  const [editing, setEditing] = useState(null);
  useSnapshotCapture([['versions', `${projectId}/${id}`]]);
  useEffect(() => {
    let current = true;
    actions
      .readVersion(id)
      .then((value) => {
        if (!current) return;
        setDocument(value);
        setBaseline(value.version.baselineId ?? '');
      })
      .catch((error) => actions.toast(error.message));
    actions
      .versionGroups(projectId)
      .then((groups) => {
        if (current)
          setChoices(
            groups.flatMap((group) => group.versions).filter((version) => version.id !== id),
          );
      })
      .catch((error) => actions.toast(error.message));
    return () => {
      current = false;
    };
  }, [id, changed]);
  async function organize() {
    setBusy(true);
    await actions.attempt(async () => {
      await actions.versionBaseline(id, baseline || null);
      await actions.organizeVersion(id);
    });
    setBusy(false);
  }
  async function save() {
    setBusy(true);
    const result = await actions.attempt(() =>
      actions.editResource('versions', `${projectId}/${id}`, 'append', { text: `\n${draft}\n` }),
    );
    if (result) {
      await actions.captureSnapshot('versions', `${projectId}/${id}`);
      setDraft('');
    }
    setBusy(false);
  }
  async function quote() {
    await actions.attempt(async () => {
      await actions.changeInput(target, {
        op: 'add',
        material: { type: 'version-notes', id, text: document.notes.text },
      });
      navigate({ view: 'meeting', id: target });
    });
  }
  const version = document?.version;
  const project = projects.find((entry) => entry.id === projectId);
  const eligible = meetings.filter(
    (meeting) =>
      meeting.projectId === projectId && !meeting.temporary && !meeting.attachedToMeetingId,
  );
  return html`<main class="main" data-version-notes>
    <${MainHead}
      crumb=${project?.name ?? ''}
      title=${t('版本说明')}
      children=${html`<button class="btn" onClick=${() => actions.attempt(() => actions.openVersion(id))}>${t('打开原件')}</button><button class="btn primary" disabled=${!document?.notes?.exists} onClick=${() => actions.attempt(() => actions.openVersionNotes(id))}>${t('打开说明 MD')}</button>`}
    />
    <div class="mainbody">
      <div class="content">
        <div class="grid2" style="grid-template-columns:minmax(0,1.7fr) minmax(270px,1fr)">
          ${
            editing
              ? html`<div class="card">
                  <textarea
                    aria-label=${t('编辑版本说明')}
                    value=${editing.text}
                    style="min-height:520px;width:100%"
                    onInput=${(event) => setEditing({ ...editing, text: event.currentTarget.value })}
                  />
                  <div class="row">
                    <button
                      class="btn primary"
                      disabled=${busy}
                      onClick=${async () => {
                        setBusy(true);
                        const result = await actions.attempt(() =>
                          actions.editVersionNotes(id, editing.text, editing.revisionId),
                        );
                        if (result) setEditing(null);
                        setBusy(false);
                      }}
                    >
                      ${t('保存说明')}</button
                    ><button class="btn" onClick=${() => setEditing(null)}>${t('取消')}</button>
                  </div>
                </div>`
              : html`<div
                  class="card markdown"
                  dangerouslySetInnerHTML=${{ __html: renderMarkdown(document?.notes?.text ?? '') }}
                ></div>`
          }
          <div class="stack">
            <div class="card">
              <h3>${t('版本关系')}</h3>
              <p>${version?.name ?? ''} · v${version?.number ?? ''}</p>
              <label class="field"
                ><span class="label">${t('比较基线')}</span
                ><select
                  aria-label=${t('比较基线')}
                  value=${baseline}
                  onChange=${(event) => setBaseline(event.currentTarget.value)}
                >
                  <option value="">${t('首版，无前序版本')}</option>
                  ${choices.filter((entry) => entry.groupId === version?.groupId).map((entry) => html`<option value=${entry.id}>v${entry.number} · ${entry.name}</option>`)}
                </select></label
              >
              <small
                >${t('生成时间')}：${version?.generatedAt ? new Date(version.generatedAt).toLocaleString() : '—'}</small
              >
              <p role="status">
                ${version?.notesError || (version?.notesStatus === 'running' ? t('整理中') : '')}
              </p>
              <div class="row">
                <button
                  class="btn tiny"
                  disabled=${busy || version?.notesStatus === 'running'}
                  onClick=${organize}
                >
                  ${t('重新整理')}</button
                ><button
                  class="btn tiny"
                  onClick=${() => openResourceHistory(actions, { projectId, resource: 'versions', key: `${projectId}/${id}` })}
                >
                  ${t('历史版本')}
                </button>
                <button
                  class="btn tiny"
                  disabled=${!document?.notes?.exists}
                  onClick=${() => setEditing({ text: document.notes.text, revisionId: document.notes.revisionId })}
                >
                  ${t('编辑说明')}
                </button>
              </div>
            </div>
            <div class="card version-notes-links">
              <h3>
                ${t('研究框架与进展')}<${InfoTip}
                  text=${t('说明分别记录实际文件变化、秘书解释和待用户决定的建议。')}
                />
              </h3>
              ${(version?.references ?? []).map(
                (reference) =>
                  html`<button
                    class="btn tiny"
                    onClick=${() => {
                      if (reference.kind === 'map-node')
                        navigate({
                          view: 'map',
                          id: `${reference.projectId ?? projectId}/${reference.id}`,
                        });
                      else if (reference.kind === 'version') {
                        if (reference.location?.description === 'notes')
                          navigate({
                            view: 'version-notes',
                            id: `${reference.projectId ?? projectId}/${reference.id}`,
                          });
                        else
                          actions.openPreview({
                            kind: 'version',
                            id: reference.id,
                            projectId,
                            page: reference.location?.page,
                          });
                      } else if (reference.kind === 'project-file' || reference.kind === 'script') {
                        const file = [version, ...choices].find((entry) =>
                          [entry?.originalPath, `${entry?.originalPath}.notes.md`].includes(
                            reference.path,
                          ),
                        );
                        if (file) {
                          if (reference.path.endsWith('.notes.md'))
                            navigate({ view: 'version-notes', id: `${file.projectId}/${file.id}` });
                          else
                            actions.openPreview({
                              kind: 'version',
                              id: file.id,
                              projectId: file.projectId,
                              page: reference.location?.page,
                            });
                        } else if (reference.path === 'workbench/plans.md')
                          navigate({ view: 'plans', id: reference.projectId ?? projectId });
                        else
                          actions.openPreview({ kind: 'project', path: reference.path, projectId });
                      } else if (reference.kind === 'message')
                        navigate({ view: 'meeting', id: `${reference.meetingId}/${reference.id}` });
                      else if (reference.kind === 'source' || reference.kind === 'chunk')
                        actions.openPreview({
                          kind: 'source',
                          id: reference.sourceId ?? reference.id,
                          projectId,
                        });
                      else navigate({ view: 'database', id: projectId });
                    }}
                  >
                    ${reference.label ?? reference.path ?? reference.id}
                  </button>`,
              )}
              <label class="field"
                ><select
                  aria-label=${t('引用到对话')}
                  value=${target}
                  onChange=${(event) => setTarget(event.currentTarget.value)}
                >
                  <option value="">${t('选择对话')}</option>
                  ${eligible.map((meeting) => html`<option value=${meeting.id}>${meeting.title}</option>`)}
                </select></label
              >
              <button
                class="btn tiny"
                disabled=${!target || !document?.notes?.exists}
                onClick=${quote}
              >
                ${t('引用说明到对话')}
              </button>
            </div>
            <div class="card">
              <h3>${t('补充说明')}</h3>
              <textarea
                aria-label=${t('补充说明')}
                value=${draft}
                onInput=${(event) => setDraft(event.currentTarget.value)}
                placeholder=${t('添加你对这个版本的说明…')}
              /><button class="btn tiny" disabled=${busy || !draft.trim()} onClick=${save}>
                ${t('保存补充')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </main>`;
}
