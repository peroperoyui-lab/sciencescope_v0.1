// Version notes use the secretary's disposable background turn, not the Main
// session. A per-project queue preserves import order and optimistic revision
// checks keep a user's concurrent edits authoritative.
import { closeKnowledgeTurn } from '../knowledge/versions.js';
import { AppError } from '../../core/errors.js';
import { nowIso } from '../../core/ids.js';
import { createBackgroundRunner } from '../secretary/background.js';
import { DEFAULT_VERSION_TEMPLATE, VERSION_INSTRUCTIONS } from './template.js';
import { changeSummary } from './comparison.js';
import { minutesGoals } from '../assistant/overview.js';

/**
 * @param {{core:import('../../core/index.js').Core,versions:any,runtime:import('../../runtime/port.js').Runtime,
 * tools:any,defaultModel:()=>Promise<any>,modelCatalog?:any}} dependencies
 */
export function createVersionOrganizer({
  core,
  versions,
  runtime,
  tools,
  defaultModel,
  modelCatalog,
}) {
  const runner = createBackgroundRunner({ core, runtime, tools, defaultModel, modelCatalog });
  const projects = new Map();
  const active = new Map();
  /** @type {Set<() => void>} */
  const waiting = new Set();
  let unsubscribe;
  let closed = false;
  let pending = Promise.resolve();

  function foregroundActive() {
    const meetings = new Set(
      core.db
        .prepare('SELECT meeting_id FROM version_note_meetings')
        .all()
        .map((row) => row.meeting_id),
    );
    return core.turns.running().some((turn) => !meetings.has(turn.meetingId));
  }
  function wake() {
    for (const resolve of waiting) resolve();
    waiting.clear();
  }
  async function waitForForeground() {
    while (!closed && foregroundActive())
      await new Promise((resolve) => waiting.add(() => resolve(undefined)));
    return !closed;
  }

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
    return versions.compare(id, baselineId);
  }
  async function organize(id) {
    const version = versions.get(id);
    let response;
    try {
      if (!(await waitForForeground())) return versions.get(id);
      const key = `${version.projectId}/${id}`;
      const before = await core.workspace.read({ resource: 'versions', key });
      const compared = await comparison(id);
      if (
        compared.current.parseStatus !== 'ready' ||
        (compared.previous && compared.previous.parseStatus !== 'ready')
      )
        throw new AppError('VERSION_PARSE_FAILED', '无法提取比较文字，请打开原件检查后重试。');
      const settings = (await core.workspace.read({ resource: 'settings', key: 'app' })).value;
      const plans =
        (await core.workspace.read({ resource: 'plans', key: version.projectId })).text ?? '';
      const map = (await core.workspace.read({ resource: 'map', key: version.projectId })).value;
      const nodes = map?.nodes ?? [];
      const titlePath = (node) => {
        const titles = [node.text];
        const seen = new Set([node.id]);
        let parent = nodes.find((candidate) => candidate.id === node.parent);
        while (parent && !seen.has(parent.id)) {
          titles.unshift(parent.text);
          seen.add(parent.id);
          parent = nodes.find((candidate) => candidate.id === parent.parent);
        }
        return `${node.id}: ${titles.join(' > ')}`;
      };
      const project = core.projects.get(version.projectId);
      const context = {
        project: { name: project.name, description: project.description },
        plans: plans
          .split('\n')
          .filter((line) => line.trim() && !/^#/.test(line))
          .join('\n'),
        map: nodes.map(titlePath).join('\n'),
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
        const points = minutesGoals(minutes.text ?? '', false);
        if (points)
          context.minutes.push({
            meetingId: meeting.id,
            text: points,
            updatedAt:
              core.workspace.history({ resource: 'minutes', key: meeting.id, limit: 1 })[0]
                ?.createdAt ?? meeting.updatedAt,
          });
      }
      context.minutes.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      const summary = changeSummary(compared);
      const metadata = (entry) =>
        entry
          ? {
              id: entry.id,
              projectId: entry.projectId,
              number: entry.number,
              name: entry.name,
              originalPath: entry.originalPath,
            }
          : null;
      const meetingId = meetingFor(version.projectId);
      const prepared = await runner.prepare(meetingId);
      while (!closed && foregroundActive()) await waitForForeground();
      // No asynchronous preparation remains between this check and turn.start.
      // A new foreground turn leaves this job queued, without cancelling an
      // already dispatched request or changing its per-project order.
      if (closed) return versions.get(id);
      status(id, 'running');
      response = await runner.run(
        meetingId,
        VERSION_INSTRUCTIONS,
        JSON.stringify({
          current: metadata(version),
          baseline: metadata(compared.previous?.version),
          changeCount: summary.count,
          changedParagraphs: summary.locations,
          changes: summary.text,
          context,
          template: settings.versionNotes?.template || DEFAULT_VERSION_TEMPLATE,
          existingNotes: before.text,
        }),
        prepared,
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
      const references = (result.references ?? []).map((reference) => {
        if (reference.kind !== 'project-file') return reference;
        for (const group of versions.list(version.projectId)) {
          const file = group.versions.find((entry) =>
            [entry.originalPath, `${entry.originalPath}.notes.md`].includes(reference.path),
          );
          if (file)
            return {
              schema: 1,
              kind: 'version',
              id: file.id,
              projectId: file.projectId,
              label: reference.label,
              location: {
                ...reference.location,
                ...(reference.path.endsWith('.notes.md') ? { description: 'notes' } : {}),
              },
            };
        }
        return reference;
      });
      status(id, 'completed', '', { turnId: response.turnId, references });
      return versions.get(id);
    } catch (error) {
      status(id, 'failed', error.message);
      throw error;
    } finally {
      if (response) {
        core.workspace.captureTurnSnapshots(response.turnId);
        closeKnowledgeTurn(core, response.turnId);
      }
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
      // Desk edits keep their own change instructions; a later import must
      // not accidentally enqueue those pending notes for paid organization.
      if (version.notesStatus === 'pending' && version.origin !== 'desk')
        void refresh(version.id).catch(() => {});
  }
  function start() {
    core.db
      .prepare(
        "UPDATE manuscript_versions SET notes_status='failed',notes_error=? WHERE notes_status='running'",
      )
      .run('上次整理未完成，请重新整理。');
    unsubscribe = core.events.subscribe((event) => {
      if (event.type === 'turn.ended') wake();
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
    wake();
    await runner.close();
    await idle();
  }
  return { start, close, idle, refresh, baseline, comparison, autoOrganize, configure };
}
