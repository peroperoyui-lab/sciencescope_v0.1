// Built-in ScienceScope tools. Every AI participant gets the same set; how it
// uses them is guided by its instructions, not by permissions.
import { createResearch } from './research/index.js';

/** @typedef {{ participantId: string, meetingId: string, turnId: string }} ToolContext */

const RESOURCES = ['map', 'plans', 'log', 'minutes', 'notes', 'agent', 'settings'];

/** @type {import('../runtime/port.js').ToolSpec[]} */
export const TOOL_SPECS = [
  {
    name: 'research_search',
    description:
      'Search imported research passages and active shared research items by keywords. ' +
      'Use the current project unless projectId is given; personal sources are included. ' +
      'Results include citation labels such as [S3 p.4]. Read the passage before citing. ' +
      'Private items never participate. Returned remaining counts can be paged with offset.',
    parameters: {
      query: { type: 'string', required: true },
      projectId: { type: 'string', description: 'Project id; omit for current meeting project.' },
      includePersonal: { type: 'boolean' },
      includeSuperseded: {
        type: 'boolean',
        description: 'Explicitly include retained historical items.',
      },
      limit: { type: 'integer' },
      offset: { type: 'integer' },
    },
  },
  {
    name: 'research_read',
    description:
      'Read a research source, chunk or shared item, preserving full text and page/section anchors. ' +
      'For sources use id or a citation label such as [S3 p.4] with projectId. ' +
      'Pass offset/limit to page passages; remaining states how many passages are left. ' +
      'An unknown page is null and must not be invented. Private items are unavailable.',
    parameters: {
      type: { type: 'string', enum: ['source', 'chunk', 'item'] },
      id: { type: 'string' },
      label: { type: 'string' },
      projectId: { type: 'string' },
      includeSuperseded: { type: 'boolean' },
      offset: { type: 'integer' },
      limit: { type: 'integer' },
    },
  },
  {
    name: 'workspace_read',
    description:
      'Read ScienceScope data. target "overview": all projects and meetings. "project": one project ' +
      '(key = project id) with its meetings and notes. "meeting": a meeting record (key = meeting id; ' +
      'page backwards with before = a message seq). "changes": recent edits (optional key = meeting id). ' +
      'Resources: "map", "log" (key = project id), "plans" (project id or "global"), "minutes" ' +
      '(meeting id), "notes" (project id/name; give scope = project id without key to list), "agent" ' +
      '(participant id), "settings".',
    parameters: {
      target: {
        type: 'string',
        required: true,
        enum: ['overview', 'project', 'meeting', 'changes', ...RESOURCES],
      },
      key: { type: 'string', description: 'Which item; see target.' },
      scope: { type: 'string', description: 'For listing notes: the project id.' },
      before: { type: 'integer', description: 'For meetings: read messages before this seq.' },
      limit: { type: 'integer', description: 'For meetings and changes: how many to return.' },
    },
  },
  {
    name: 'workspace_edit',
    description:
      'Change ScienceScope data. The change applies immediately, appears in the change log and can be ' +
      'undone. Text resources (plans, log, minutes, notes, agent) support op "write" {text}, "append" ' +
      '{text}, "replace" {find, with}, "delete". map supports "addNode" {node: {id?, parent, text}}, ' +
      '"updateNode" {id, changes}, "removeNode" {id}, "addEdge" {edge: {from, to, label?}}, "removeEdge" ' +
      '{id}, "write" {map}. settings supports "patch" {changes}. Keys are as in workspace_read.',
    parameters: {
      resource: { type: 'string', required: true, enum: RESOURCES },
      key: { type: 'string', required: true },
      op: { type: 'string', required: true },
      args: { type: 'object', additionalProperties: true, description: 'Arguments of the op.' },
    },
  },
  {
    name: 'workspace_undo',
    description:
      'Undo one change by its revision id (from workspace_edit or workspace_read "changes").',
    parameters: { revisionId: { type: 'string', required: true } },
  },
];

/**
 * @param {import('../core/index.js').Core} core
 */
export function createTools(core, research = createResearch(core)) {
  async function nameOf(id) {
    try {
      return (await core.participants.get(id)).name;
    } catch {
      return id;
    }
  }

  async function readOverview() {
    const projects = core.projects.list().map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      meetings: core.meetings
        .list({ projectId: project.id })
        .map((meeting) => ({ id: meeting.id, title: meeting.title, updatedAt: meeting.updatedAt })),
    }));
    const globalMeetings = core.meetings
      .list({ projectId: null })
      .map((meeting) => ({ id: meeting.id, title: meeting.title, updatedAt: meeting.updatedAt }));
    return { projects, meetingsOutsideProjects: globalMeetings };
  }

  async function readProject(key) {
    return {
      project: core.projects.get(key),
      meetings: core.meetings.list({ projectId: key }).map((item) => ({
        id: item.id,
        title: item.title,
        policy: item.policy,
        updatedAt: item.updatedAt,
      })),
      notes: await core.workspace.list({ resource: 'notes', scope: key }),
    };
  }

  async function readMeeting(key, before, limit) {
    const page = core.messages.list(key, { before, limit: limit ?? 40 });
    const messages = [];
    for (const message of page.messages) {
      messages.push({
        seq: message.seq,
        author: await nameOf(message.authorId),
        text: message.text,
        status: message.status,
        createdAt: message.createdAt,
      });
    }
    return { meeting: core.meetings.get(key), messages, hasEarlier: page.hasBefore };
  }

  /**
   * @param {string} name
   * @param {any} args
   * @param {ToolContext} context
   */
  async function run(name, args, context) {
    const actor = {
      actorId: context.participantId,
      meetingId: context.meetingId,
      turnId: context.turnId,
    };
    if (name === 'research_search' || name === 'research_read') {
      const projectId = args?.projectId ?? core.meetings.get(context.meetingId).projectId;
      const options = { ...args, projectId, audience: 'agent' };
      return name === 'research_search'
        ? research.search(args?.query ?? '', options)
        : research.read(options);
    }
    if (name === 'workspace_read') {
      const { target, key, scope, before, limit } = args ?? {};
      if (target === 'overview') return readOverview();
      if (target === 'project') return readProject(key);
      if (target === 'meeting') return readMeeting(key, before, limit);
      if (target === 'changes') return core.workspace.history({ meetingId: key, limit });
      if (!key && scope) return { keys: await core.workspace.list({ resource: target, scope }) };
      const result = await core.workspace.read({ resource: target, key: key ?? 'app' });
      return { exists: result.exists, value: result.value };
    }
    if (name === 'workspace_edit') {
      const { resource, key, op } = args ?? {};
      const result = await core.workspace.edit(
        { resource, key, op, args: args?.args ?? {} },
        actor,
      );
      return { revisionId: result.revisionId, value: result.value };
    }
    if (name === 'workspace_undo') return core.workspace.undo(args?.revisionId, actor);
    throw new Error(`Unknown tool: ${name}`);
  }

  return { specs: TOOL_SPECS, run };
}
