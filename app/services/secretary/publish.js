import { closeKnowledgeTurn } from '../knowledge/versions.js';
import path from 'node:path';
import { AppError } from '../../core/errors.js';
import { writeTextAtomic } from '../../core/workspace/files.js';
import { logEntryText, parseLog } from '../../shared/journal.js';

/**
 * @param {import('../../core/index.js').Core} core
 * @param {any} store
 * @param {string} meetingId
 * @param {{text:string,revision:string|null,throughSeq:number}} minutes
 * @param {any} settings
 * @returns {Promise<void>}
 */
export async function exportMinutes(core, store, meetingId, minutes, settings) {
  if (!settings.saveMarkdown) return;
  const meeting = core.meetings.get(meetingId);
  const project = meeting.projectId ? core.projects.get(meeting.projectId) : null;
  const folder = meeting.workFolder ?? project?.folder;
  if (!folder) return;
  const file = path.join(folder, 'minutes', `${meetingId}.md`);
  const canonicalFile = path.join(
    core.workspace.locate.meetingBase(meetingId),
    'minutes',
    `${meetingId}.md`,
  );
  // An internal work folder already contains the canonical minutes. Exporting
  // there would overwrite them with the export header and create a false edit.
  if (path.relative(canonicalFile, file) === '') return;
  try {
    const header = `<!-- ScienceScope minutes; revision ${minutes.revision}; covers through #${minutes.throughSeq}. -->\n\n`;
    await writeTextAtomic(file, `${header}${minutes.text}\n`);
    store.patchStatus(meetingId, { exportPath: file, exportError: null });
  } catch (error) {
    store.patchStatus(meetingId, { exportPath: file, exportError: String(error.message ?? error) });
  }
}

/**
 * @param {{core:import('../../core/index.js').Core,runner:any,store:any,meetingId:string,
 * minutesRevisionId:string,minutes:string,modes:any}} input
 * @returns {Promise<void>}
 */
export async function updateWorkbench({
  core,
  runner,
  store,
  meetingId,
  minutesRevisionId,
  minutes,
  modes,
}) {
  const projectId = core.meetings.get(meetingId).projectId;
  const enabled = ['map', 'plans', 'log', 'versions'].filter((target) => modes[target] === 'apply');
  if (!projectId || !enabled.length) return;
  const snapshot = {};
  for (const target of enabled) {
    if (target === 'versions') {
      snapshot.versions = [];
      for (const group of core.versionCatalog.list(projectId))
        for (const version of group.versions)
          snapshot.versions.push({
            version,
            notes: (
              await core.workspace.read({ resource: 'versions', key: `${projectId}/${version.id}` })
            ).value,
          });
    } else
      snapshot[target] = (await core.workspace.read({ resource: target, key: projectId })).value;
  }
  const instructions = `Update the enabled research workbench sections from the minutes.
Return JSON only: {"operations":[...]}; return an empty array when no changes are needed.
Enabled sections: ${enabled.join(', ')}.
Allowed operations:
map: {"target":"map","op":"add_child","parentId":null or an existing node id,"text":"..."}, or {"target":"map","op":"status","nodeId":"...","status":"..."}.
plans: {"target":"plans","op":"add","text":"..."}, or {"target":"plans","op":"complete","text":"the exact existing unchecked task line"}.
log: {"target":"log","op":"append","title":"...","note":"...","references":[{"schema":1,"kind":"version","id":"existing version id","projectId":"current project id","label":"file name"} or {"schema":1,"kind":"project-file","path":"relative file path","projectId":"current project id","label":"file name"}]}.
Only associate files identified in the minutes or workbench; do not invent file paths.
versions: {"target":"versions","op":"append","versionId":"existing version id","note":"context update from minutes; do not claim manuscript bytes changed"}.
Preserve user text: only add nodes/tasks/log entries or mark node status/tasks complete. Do not rewrite or delete user content. Do not repeat an existing task, node or log.`;
  const response = await runner.run(
    meetingId,
    instructions,
    `[Minutes revision ${minutesRevisionId}]\n${minutes}\n\n[Current workbench]\n${JSON.stringify(snapshot, null, 2)}`,
  );
  const raw = response.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError('INVALID_WORKBENCH_RESPONSE', '秘书返回的工作台更新不是有效 JSON。', 502);
  }
  if (!Array.isArray(parsed.operations))
    throw new AppError('INVALID_WORKBENCH_RESPONSE', '秘书没有返回工作台操作列表。', 502);
  const actor = { actorId: 'agent_secretary', meetingId, turnId: response.turnId };
  try {
    for (const operation of parsed.operations) {
      if (!enabled.includes(operation.target)) continue;
      const target = operation.target;
      const key = target === 'versions' ? `${projectId}/${operation.versionId}` : projectId;
      if (
        target === 'versions' &&
        !snapshot.versions.some((entry) => entry.version.id === operation.versionId)
      )
        continue;
      const current = await core.workspace.read({ resource: target, key });
      let change;
      if (target === 'map') {
        if (
          operation.op === 'add_child' &&
          typeof operation.text === 'string' &&
          operation.text.trim()
        ) {
          const parent = operation.parentId ?? null;
          if (parent && !current.value.nodes.some((node) => node.id === parent)) continue;
          if (
            current.value.nodes.some(
              (node) => node.text === operation.text && node.parent === parent,
            )
          )
            continue;
          change = {
            resource: target,
            key: projectId,
            op: 'addNode',
            args: {
              node: {
                parent,
                text: operation.text,
                addedBy: 'agent_secretary',
                origin: 'secretary',
                minutesRevisionId,
              },
            },
          };
        } else if (
          operation.op === 'status' &&
          typeof operation.status === 'string' &&
          current.value.nodes.some((node) => node.id === operation.nodeId)
        ) {
          change = {
            resource: target,
            key: projectId,
            op: 'updateNode',
            args: { id: operation.nodeId, changes: { status: operation.status } },
          };
        }
      } else if (target === 'plans') {
        const text = current.text ?? '';
        if (operation.op === 'add' && typeof operation.text === 'string' && operation.text.trim()) {
          const task = operation.text.replace(/^- \[[ xX]\]\s*/, '').trim();
          if (
            text.split(/\r?\n/).some((line) => line.replace(/^- \[[ xX]\]\s*/, '').trim() === task)
          )
            continue;
          change = {
            resource: target,
            key: projectId,
            op: 'append',
            args: { text: `- [ ] ${task}` },
          };
        } else if (
          operation.op === 'complete' &&
          typeof operation.text === 'string' &&
          operation.text.startsWith('- [ ] ') &&
          text.split(/\r?\n/).includes(operation.text)
        ) {
          change = {
            resource: target,
            key: projectId,
            op: 'write',
            args: {
              text: text.replace(/^.*$/gm, (line) =>
                line === operation.text ? line.replace('- [ ] ', '- [x] ') : line,
              ),
            },
            expectedRevisionId: current.revisionId,
          };
        }
      } else if (target === 'versions') {
        if (
          operation.op === 'append' &&
          typeof operation.note === 'string' &&
          operation.note.trim() &&
          !(current.text ?? '').includes(operation.note)
        )
          change = { resource: target, key, op: 'append', args: { text: `\n${operation.note}\n` } };
      } else if (
        operation.op === 'append' &&
        typeof operation.title === 'string' &&
        typeof operation.note === 'string'
      ) {
        if (
          parseLog(current.text).some(
            (entry) => entry.title === operation.title && entry.body === operation.note.trim(),
          )
        )
          continue;
        const entry = logEntryText(operation.title, operation.note, '', operation.references ?? []);
        change = { resource: target, key: projectId, op: 'append', args: { text: entry } };
      }
      if (!change) continue;
      const revision = await core.workspace.edit(change, actor);
      if (revision.revisionId)
        core.db
          .prepare(
            'INSERT INTO minutes_workbench_updates (revision_id, minutes_revision_id) VALUES (?, ?)',
          )
          .run(revision.revisionId, minutesRevisionId);
    }
  } finally {
    core.workspace.captureTurnSnapshots(response.turnId);
    closeKnowledgeTurn(core, response.turnId);
  }
  store.patchStatus(meetingId, { workbenchError: null });
}
