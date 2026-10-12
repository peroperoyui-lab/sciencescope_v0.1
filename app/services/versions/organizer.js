// Version notes use the secretary's disposable background turn, not the Main
// session. A per-project queue preserves import order and optimistic revision
// checks keep a user's concurrent edits authoritative.
import { AppError } from '../../core/errors.js';
import { nowIso } from '../../core/ids.js';
import { createBackgroundRunner } from '../secretary/background.js';
import { compareText } from './comparison.js';
import { DEFAULT_VERSION_TEMPLATE, VERSION_INSTRUCTIONS } from './template.js';

/**
 * @param {{core:import('../../core/index.js').Core,versions:any,runtime:import('../../runtime/port.js').Runtime,
 * tools:any,defaultModel:()=>Promise<any>}} dependencies
 */
export function createVersionOrganizer({ core, versions, runtime, tools, defaultModel }) {
  const runner = createBackgroundRunner({ core, runtime, tools, defaultModel });
  const projects = new Map();
  const active = new Map();
  let unsubscribe;
  let closed = false;
  let pending = Promise.resolve();

  function autoOrganize(projectId) {
    return Boolean(
      core.db.prepare('SELECT auto_version_notes FROM projects WHERE id=?').get(projectId)
        ?.auto_version_notes,
    );
  }
  function configure(projectId, enabled) {
    core.projects.get(projectId);
    core.db.transaction(() => {
      core.db
        .prepare('UPDATE projects SET auto_version_notes=? WHERE id=?')
        .run(enabled ? 1 : 0, projectId);
      core.versionCatalog.changed(projectId, 'preferences', projectId, 'person_user');
    });
    return { autoOrganize: autoOrganize(projectId) };
  }
  function meetingFor(projectId) {
    const stored = core.db
      .prepare('SELECT meeting_id FROM version_note_meetings WHERE project_id=?')
      .get(projectId);
    if (stored) return String(stored.meeting_id);
    return core.db.transaction(() => {
      const meeting = core.meetings.create(
        {
          projectId,
          title: '文献版本整理',
          temporary: true,
          policy: { mode: 'direct', respondent: 'agent_secretary' },
          members: [{ participantId: 'agent_secretary' }],
        },
        { actorId: 'agent_secretary' },
      );
      core.db
        .prepare('INSERT INTO version_note_meetings (project_id,meeting_id) VALUES (?,?)')
        .run(projectId, meeting.id);
      return meeting.id;
    });
  }
  function status(id, state, error = '', extra = {}) {
    const version = versions.get(id);
    core.db.transaction(() => {
      core.db
        .prepare('UPDATE manuscript_versions SET notes_status=?,notes_error=? WHERE id=?')
        .run(state, error, id);
      if (extra.turnId)
        core.db
          .prepare(
            'UPDATE manuscript_versions SET generated_at=?,notes_turn_id=?,notes_references_json=? WHERE id=?',
          )
          .run(nowIso(), extra.turnId, JSON.stringify(extra.references ?? []), id);
      core.versionCatalog.changed(version.projectId, 'notes', id, 'agent_secretary');
    });
  }
  function baseline(id, baselineId) {
    const current = versions.get(id);
    if (baselineId) {
      const previous = versions.get(baselineId);
      if (previous.groupId !== current.groupId || previous.id === id)
        throw new AppError('INVALID_BASELINE', '请选择同一版本组的其他版本作为比较基线。');
    }
    core.db.transaction(() => {
      core.db
        .prepare('UPDATE manuscript_versions SET baseline_id=? WHERE id=?')
        .run(baselineId || null, id);
      core.versionCatalog.changed(current.projectId, 'baseline', id, 'person_user');
    });
    return versions.get(id);
  }
  async function comparison(id, baselineId = versions.get(id).baselineId) {
    const current = await versions.read(id, { limit: Infinity });
    const previous = baselineId ? await versions.read(baselineId, { limit: Infinity }) : null;
    const text = (entry) => entry?.blocks.map((block) => block.text).join('\n\n') ?? '';
    return { current, previous, changes: compareText(text(previous), text(current)) };
  }
  async function organize(id) {
    const version = versions.get(id);
    status(id, 'running');
    let response;
    try {
      const key = `${version.projectId}/${id}`;
      const before = await core.workspace.read({ resource: 'versions', key });
      const compared = await comparison(id);
      if (
        compared.current.parseStatus !== 'ready' ||
        (compared.previous && compared.previous.parseStatus !== 'ready')
      )
        throw new AppError('VERSION_PARSE_FAILED', '无法提取比较文字，请打开原件检查后重试。');
      const settings = (await core.workspace.read({ resource: 'settings', key: 'app' })).value;
      const context = {
        project: core.projects.get(version.projectId),
        plans: (await core.workspace.read({ resource: 'plans', key: version.projectId })).value,
        map: (await core.workspace.read({ resource: 'map', key: version.projectId })).value,
        minutes: [],
      };
      for (const meeting of core.meetings.list({ projectId: version.projectId })) {
        if (
          meeting.temporary ||
          meeting.attachedToMeetingId ||
          meeting.policy.respondent === 'agent_assistant'
        )
          continue;
        const minutes = await core.workspace.read({ resource: 'minutes', key: meeting.id });
        if (minutes.text) context.minutes.push({ meetingId: meeting.id, text: minutes.text });
      }
      response = await runner.run(
        meetingFor(version.projectId),
        VERSION_INSTRUCTIONS,
        JSON.stringify({
          current: version,
          baseline: compared.previous?.version ?? null,
          changes: compared.changes,
          context,
          template: settings.versionNotes?.template || DEFAULT_VERSION_TEMPLATE,
          existingNotes: before.text,
        }),
      );
      const result = JSON.parse(
        response.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''),
      );
      if (!result.markdown?.trim())
        throw new AppError('INVALID_VERSION_NOTES', '秘书没有返回版本说明，请重新整理。');
      if (closed || versions.get(id).baselineId !== version.baselineId)
        throw new AppError('VERSION_NOTES_CHANGED', '比较基线已改变，请重新整理。');
      await core.workspace.edit(
        {
          resource: 'versions',
          key,
          op: 'write',
          args: { text: result.markdown },
          expectedRevisionId: before.revisionId,
        },
        {
          actorId: 'agent_secretary',
          meetingId: meetingFor(version.projectId),
          turnId: response.turnId,
        },
      );
      status(id, 'completed', '', { turnId: response.turnId, references: result.references ?? [] });
      return versions.get(id);
    } catch (error) {
      status(id, 'failed', error.message);
      throw error;
    } finally {
      if (response) core.workspace.captureTurnSnapshots(response.turnId);
    }
  }
  function refresh(id) {
    if (active.has(id)) return active.get(id);
    const version = versions.get(id);
    const next = (projects.get(version.projectId) ?? Promise.resolve()).then(() => organize(id));
    active.set(id, next);
    projects.set(
      version.projectId,
      next.catch(() => {}),
    );
    void next.finally(() => active.delete(id)).catch(() => {});
    return next;
  }
  async function imported(projectId, groupId) {
    if (closed || !autoOrganize(projectId)) return;
    // An unconfigured installation keeps readable originals pending; manual
    // organization reports which model must be configured.
    const model = await defaultModel();
    const secretary = await core.participants.get('agent_secretary');
    if (!model?.model && !secretary.definition?.model?.model) return;
    const group = versions.list(projectId).find((entry) => entry.id === groupId);
    for (const version of [...(group?.versions ?? [])].reverse())
      if (version.notesStatus === 'pending') void refresh(version.id).catch(() => {});
  }
  function start() {
    core.db
      .prepare(
        "UPDATE manuscript_versions SET notes_status='failed',notes_error=? WHERE notes_status='running'",
      )
      .run('上次整理未完成，请重新整理。');
    unsubscribe = core.events.subscribe((event) => {
      if (event.type === 'versions.changed' && event.payload.action === 'imported')
        pending = pending.then(() => imported(event.projectId, event.payload.id)).catch(() => {});
    });
  }
  async function idle() {
    await pending;
    await Promise.allSettled([...projects.values()]);
  }
  async function close() {
    closed = true;
    unsubscribe?.();
    await runner.close();
    await idle();
  }
  return { start, close, idle, refresh, baseline, comparison, autoOrganize, configure };
}
