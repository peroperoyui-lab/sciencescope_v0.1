// Meetings: a shared thread, who is present, and the speaking policy.
// Main chats, ordered discussions, secretary chats and the global assistant are
// all meetings; they differ only in members, policy and attachment.
import { randomUUID } from 'node:crypto';
import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './errors.js';

/**
 * @typedef {{ mode: 'direct' | 'round', respondent?: string | null,
 *   order?: string[], reviewer?: string | null, approval?: 'ask' | 'auto',
 *   model?: import('../runtime/port.js').ModelChoice | null }} Policy
 * @typedef {{ participantId: string, roleNote: string, position: number }} Member
 * @typedef {{ id: string, projectId: string | null, title: string, policy: Policy,
 *   parentMeetingId: string | null, forkMessageId: string | null,
 *   attachedToMeetingId: string | null, workFolder: string | null, pinned: boolean,
 *   archived: boolean, temporary: boolean, createdAt: string, updatedAt: string,
 *   members: Member[] }} Meeting
 */

export const DEFAULT_POLICY = { mode: 'direct', respondent: null, approval: 'ask' };

function validateApproval(policy) {
  if (policy && Object.hasOwn(policy, 'approval') && !['ask', 'auto'].includes(policy.approval))
    throw new AppError('INVALID_APPROVAL', 'approval must be ask or auto.');
}

const nullable = (value) => (value == null ? null : String(value));

/**
 * @param {{ db: import('./db/database.js').Db, events: any,
 *   now: () => string, newId: (prefix: string) => string,
 *   paths?: ReturnType<typeof import('./paths.js').dataPaths> }} deps
 */
export function createMeetings({ db, events, now, newId, paths }) {
  /** @returns {Member[]} */
  function membersOf(meetingId) {
    return db
      .prepare('SELECT * FROM meeting_members WHERE meeting_id = ? ORDER BY position')
      .all(meetingId)
      .map((row) => ({
        participantId: String(row.participant_id),
        roleNote: String(row.role_note),
        position: Number(row.position),
      }));
  }

  /** @returns {Meeting} */
  function toMeeting(row) {
    return {
      id: String(row.id),
      projectId: nullable(row.project_id),
      title: String(row.title),
      policy: { approval: 'ask', ...JSON.parse(String(row.policy_json)) },
      parentMeetingId: nullable(row.parent_meeting_id),
      forkMessageId: nullable(row.fork_message_id),
      attachedToMeetingId: nullable(row.attached_to_meeting_id),
      workFolder: nullable(row.work_folder),
      pinned: Boolean(row.pinned),
      archived: Boolean(row.archived),
      temporary: Boolean(row.temporary),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      members: membersOf(String(row.id)),
    };
  }

  /** @param {string} id @returns {Meeting} */
  function get(id) {
    const row = db.prepare('SELECT * FROM meetings WHERE id = ?').get(id);
    if (!row) throw new AppError('MEETING_NOT_FOUND', '找不到这个会议。', 404);
    return toMeeting(row);
  }

  /**
   * @param {{ projectId?: string | null, attachedTo?: string, includeArchived?: boolean }} [filter]
   *   `projectId: null` lists meetings outside any project; omit it to list all.
   * @returns {Meeting[]}
   */
  function list({ projectId, attachedTo, includeArchived = false } = {}) {
    const clauses = [];
    const params = [];
    if (projectId === null) clauses.push('project_id IS NULL');
    else if (projectId !== undefined) {
      clauses.push('project_id = ?');
      params.push(projectId);
    }
    if (attachedTo) {
      clauses.push('attached_to_meeting_id = ?');
      params.push(attachedTo);
    }
    if (!includeArchived) clauses.push('archived = 0');
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return db
      .prepare(`SELECT * FROM meetings ${where} ORDER BY pinned DESC, updated_at DESC`)
      .all(...params)
      .map(toMeeting);
  }

  function writeMembers(meetingId, members) {
    db.prepare('DELETE FROM meeting_members WHERE meeting_id = ?').run(meetingId);
    members.forEach((member, position) => {
      db.prepare(
        `INSERT INTO meeting_members (meeting_id, participant_id, role_note, position)
         VALUES (?, ?, ?, ?)`,
      ).run(meetingId, member.participantId, member.roleNote ?? '', position);
    });
  }

  function insert(input, actor) {
    validateApproval(input.policy);
    const id = newId('mtg');
    const time = now();
    const project = input.projectId
      ? db.prepare('SELECT folder, dir_name FROM projects WHERE id = ?').get(input.projectId)
      : null;
    const workFolder =
      input.workFolder ??
      (project?.folder == null
        ? project && paths
          ? path.join(paths.projects, String(project.dir_name))
          : null
        : String(project.folder));
    db.prepare(
      `INSERT INTO meetings (id, project_id, title, policy_json, parent_meeting_id, fork_message_id,
         attached_to_meeting_id, work_folder, temporary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.projectId ?? null,
      String(input.title ?? '').trim() || '新会议',
      JSON.stringify({ ...DEFAULT_POLICY, ...input.policy }),
      input.parentMeetingId ?? null,
      input.forkMessageId ?? null,
      input.attachedTo ?? null,
      workFolder,
      Number(Boolean(input.temporary)),
      time,
      time,
    );
    writeMembers(id, input.members ?? []);
    const meeting = get(id);
    events.record('meeting.created', meeting, {
      projectId: meeting.projectId,
      meetingId: id,
      actorId: actor.actorId,
    });
    return meeting;
  }

  /**
   * @param {{ projectId?: string | null, title?: string, members?: Array<{ participantId: string, roleNote?: string }>,
   *   policy?: Partial<Policy>, attachedTo?: string | null, workFolder?: string | null,
   *   temporary?: boolean }} input
   * @param {import('./workspace/workspace.js').Actor} [actor]
   * @returns {Meeting}
   */
  function create(input, actor = {}) {
    return db.transaction(() => insert(input, actor));
  }

  /**
   * @param {string} id
   * @param {{ title?: string, policy?: Partial<Policy>, pinned?: boolean, archived?: boolean,
   *   workFolder?: string | null, members?: Array<{ participantId: string, roleNote?: string }> }} changes
   * @param {import('./workspace/workspace.js').Actor} [actor]
   * @returns {Meeting}
   */
  function update(id, changes, actor = {}) {
    validateApproval(changes.policy);
    const meeting = get(id);
    return db.transaction(() => {
      db.prepare(
        `UPDATE meetings SET title = ?, policy_json = ?, pinned = ?, archived = ?, work_folder = ?,
           updated_at = ? WHERE id = ?`,
      ).run(
        changes.title == null ? meeting.title : String(changes.title).trim() || meeting.title,
        JSON.stringify({ ...meeting.policy, ...changes.policy }),
        Number(changes.pinned ?? meeting.pinned),
        Number(changes.archived ?? meeting.archived),
        changes.workFolder === undefined ? meeting.workFolder : changes.workFolder,
        now(),
        id,
      );
      if (changes.members) writeMembers(id, changes.members);
      const updated = get(id);
      events.record('meeting.updated', updated, {
        projectId: updated.projectId,
        meetingId: id,
        actorId: actor.actorId,
      });
      return updated;
    });
  }

  /** Join an invited participant without replacing members added by concurrent invitations.
   * @param {string} id
   * @param {{participantId:string,roleNote?:string}} member
   * @param {import('./workspace/workspace.js').Actor} [actor]
   */
  function addMember(id, member, actor = {}) {
    const meeting = get(id);
    if (meeting.members.some((existing) => existing.participantId === member.participantId))
      return meeting;
    return update(id, { members: [...meeting.members, member] }, actor);
  }

  /** Latest recorded context usage per participant, including unavailable/failed turns.
   * @param {string} id
   */
  function contexts(id) {
    get(id);
    return db
      .prepare(
        // Background turns are accounted for, but their disposable sessions are
        // not participants' foreground working memories in the context ring.
        'SELECT turns.* FROM turns WHERE meeting_id = ? AND EXISTS ' +
          '(SELECT 1 FROM messages WHERE messages.turn_id = turns.id) ORDER BY turns.rowid DESC',
      )
      .all(id)
      .reduce((latest, row) => {
        if (latest.some((entry) => entry.participantId === row.participant_id)) return latest;
        latest.push({
          participantId: String(row.participant_id),
          turnId: String(row.id),
          context:
            row.usage_json == null ? null : (JSON.parse(String(row.usage_json)).context ?? null),
        });
        return latest;
      }, []);
  }

  /** Mark activity so recently used meetings sort first. */
  function touch(id) {
    db.prepare('UPDATE meetings SET updated_at = ? WHERE id = ?').run(now(), id);
  }

  /**
   * Copy a meeting up to and including one message. Runtime working memory is
   * not copied: participants rebuild it from the copied record.
   * @param {string} id
   * @param {{ atMessageId: string, title?: string }} options
   * @param {import('./workspace/workspace.js').Actor} [actor]
   * @returns {Meeting}
   */
  function fork(id, { atMessageId, title }, actor = {}) {
    const source = get(id);
    const cut = db
      .prepare('SELECT seq FROM messages WHERE id = ? AND meeting_id = ?')
      .get(atMessageId, id);
    if (!cut) throw new AppError('MESSAGE_NOT_FOUND', '找不到分支点所在的消息。', 404);
    return db.transaction(() => {
      const copy = insert(
        {
          projectId: source.projectId,
          title: title ?? `${source.title}（分支）`,
          members: source.members,
          policy: source.policy,
          parentMeetingId: id,
          forkMessageId: atMessageId,
          workFolder: source.workFolder,
        },
        actor,
      );
      const rows = db
        .prepare('SELECT * FROM messages WHERE meeting_id = ? AND seq <= ? ORDER BY seq')
        .all(id, cut.seq);
      for (const row of rows) {
        const messageId = newId('msg');
        db.prepare(
          `INSERT INTO messages (id, meeting_id, seq, author_id, text, status, turn_id, reply_to,
             refs_json, adopted, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
        ).run(
          messageId,
          copy.id,
          row.seq,
          row.author_id,
          row.text,
          row.status,
          JSON.stringify({ ...JSON.parse(String(row.refs_json)), contextReadBy: [] }),
          row.adopted,
          row.created_at,
          row.updated_at,
        );
        db.prepare(
          'INSERT INTO message_research_input(message_id,input_json) SELECT ?,input_json FROM message_research_input WHERE message_id=?',
        ).run(messageId, row.id);
        for (const file of db
          .prepare('SELECT * FROM message_deliverables WHERE message_id = ?')
          .all(row.id)) {
          db.prepare(
            `INSERT INTO message_deliverables (id, message_id, turn_id, tool_call_id, source_path, stored_path, name, description, media_type, byte_size, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            newId('file'),
            messageId,
            file.turn_id,
            file.tool_call_id,
            file.source_path,
            file.stored_path,
            file.name,
            file.description,
            file.media_type,
            file.byte_size,
            file.created_at,
          );
        }
      }
      return copy;
    });
  }

  /** A project's own folder under the data directory. @param {string} projectId */
  function projectDir(projectId) {
    const row = db.prepare('SELECT dir_name FROM projects WHERE id = ?').get(projectId);
    if (!row) throw new AppError('PROJECT_NOT_FOUND', '找不到这个项目。', 404);
    return path.join(paths.projects, String(row.dir_name));
  }

  /** The work folder a new chat gets in a project. @param {string} projectId */
  function projectFolder(projectId) {
    const row = db.prepare('SELECT folder FROM projects WHERE id = ?').get(projectId);
    return row?.folder == null ? projectDir(projectId) : String(row.folder);
  }

  /**
   * Move a chat, with the chats attached to it, into a project or out of one
   * (`projectId: null`). A default work folder follows the chat; a folder the
   * user chose stays. Minutes files move with their chats.
   * @param {string} id
   * @param {string | null} projectId
   * @param {import('./workspace/workspace.js').Actor} [actor]
   * @returns {Promise<Meeting>}
   */
  async function move(id, projectId, actor = {}) {
    const meeting = get(id);
    if (meeting.projectId === projectId) return meeting;
    if (meeting.attachedToMeetingId)
      throw new AppError('MEETING_ATTACHED', '附属对话跟随主对话移动。', 409);
    const oldDefault = meeting.projectId ? projectFolder(meeting.projectId) : null;
    const scratch = path.join(paths.root, 'workspaces') + path.sep;
    let workFolder = meeting.workFolder;
    if (projectId && (!workFolder || workFolder === oldDefault || workFolder.startsWith(scratch)))
      workFolder = projectFolder(projectId);
    else if (!projectId && workFolder === oldDefault) {
      workFolder = path.join(paths.root, 'workspaces', randomUUID());
      await mkdir(workFolder, { recursive: true });
    }
    const family = [
      id,
      ...db
        .prepare('SELECT id FROM meetings WHERE attached_to_meeting_id = ?')
        .all(id)
        .map((row) => String(row.id)),
    ];
    const minutes = (owner) => path.join(owner ? projectDir(owner) : paths.root, 'minutes');
    await mkdir(minutes(projectId), { recursive: true });
    for (const member of family)
      await rename(
        path.join(minutes(meeting.projectId), `${member}.md`),
        path.join(minutes(projectId), `${member}.md`),
      ).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    return db.transaction(() => {
      const write = db.prepare(
        'UPDATE meetings SET project_id = ?, work_folder = ?, updated_at = ? WHERE id = ?',
      );
      for (const member of family) write.run(projectId, workFolder, now(), member);
      const updated = get(id);
      events.record('meeting.updated', updated, {
        projectId: updated.projectId,
        meetingId: id,
        actorId: actor.actorId,
      });
      return updated;
    });
  }

  return { get, list, create, update, move, addMember, contexts, touch, fork };
}
