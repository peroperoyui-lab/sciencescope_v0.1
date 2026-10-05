// Participants: humans and AIs. Humans are a row; an AI is a row plus its
// definition file `agents/<id>.md`, edited through the workspace like any file.
import { AppError } from './errors.js';
import { formatAgentFile, parseAgentFile } from './agent-file.js';

/** @typedef {{ id: string, kind: 'human' | 'ai', name: string, createdAt: string,
 *   definition?: import('./agent-file.js').AgentDefinition }} Participant */

function toParticipant(row) {
  return {
    id: String(row.id),
    kind: /** @type {'human' | 'ai'} */ (String(row.kind)),
    name: String(row.name),
    createdAt: String(row.created_at),
  };
}

/**
 * @param {{ db: import('./db/database.js').Db, events: any, workspace: any,
 *   now: () => string, newId: (prefix: string) => string }} deps
 */
export function createParticipants({ db, events, workspace, now, newId }) {
  function row(id) {
    const found = db.prepare('SELECT * FROM participants WHERE id = ?').get(id);
    if (!found) throw new AppError('PARTICIPANT_NOT_FOUND', '找不到这位参与者。', 404);
    return found;
  }

  /**
   * @param {{ id?: string, kind: 'human' | 'ai', name: string,
   *   definition?: Partial<import('./agent-file.js').AgentDefinition> }} input
   * @param {import('./workspace/workspace.js').Actor} [actor]
   * @returns {Promise<Participant>}
   */
  async function create({ id, kind, name, definition = {} }, actor = {}) {
    const participantId = id ?? newId(kind === 'ai' ? 'agent' : 'person');
    if (kind === 'ai') {
      const text = formatAgentFile({ name, prompt: '', ...definition });
      await workspace.edit(
        { resource: 'agent', key: participantId, op: 'write', args: { text } },
        actor,
      );
    }
    db.transaction(() => {
      db.prepare('INSERT INTO participants (id, kind, name, created_at) VALUES (?, ?, ?, ?)').run(
        participantId,
        kind,
        name,
        now(),
      );
      events.record('participant.created', { id: participantId, kind, name }, actor);
    });
    return get(participantId);
  }

  /**
   * A participant, with its definition for AIs. The definition file is the
   * truth; the row's display name follows it.
   * @param {string} id
   * @returns {Promise<Participant>}
   */
  async function get(id) {
    const participant = toParticipant(row(id));
    if (participant.kind !== 'ai') return participant;
    const file = await workspace.read({ resource: 'agent', key: id });
    const definition = parseAgentFile(file.text ?? '');
    if (definition.name && definition.name !== participant.name) {
      db.prepare('UPDATE participants SET name = ? WHERE id = ?').run(definition.name, id);
      participant.name = definition.name;
    }
    return { ...participant, definition };
  }

  /** @returns {Participant[]} Without definitions; use `get` for one AI's definition. */
  function list() {
    return db.prepare('SELECT * FROM participants ORDER BY created_at').all().map(toParticipant);
  }

  /**
   * Change an AI's definition fields (name, model, skills, tools, prompt).
   * @param {string} id
   * @param {Partial<import('./agent-file.js').AgentDefinition>} changes
   * @param {import('./workspace/workspace.js').Actor} [actor]
   */
  async function updateDefinition(id, changes, actor = {}) {
    const current = await get(id);
    if (current.kind !== 'ai') throw new AppError('NOT_AN_AI', '只有 AI 参与者有定义文件。');
    const text = formatAgentFile({ ...current.definition, ...changes });
    await workspace.edit({ resource: 'agent', key: id, op: 'write', args: { text } }, actor);
    return get(id);
  }

  /** @param {string} id @param {string} name */
  function rename(id, name) {
    row(id);
    db.transaction(() => {
      db.prepare('UPDATE participants SET name = ? WHERE id = ?').run(name, id);
      events.record('participant.updated', { id, name });
    });
  }

  return { create, get, list, updateDefinition, rename };
}
