// Built-in ScienceScope tools. Every AI participant gets the same set; how it
// uses them is guided by its instructions, not by permissions.
import { createResearch } from './research/index.js';
import { AppError } from '../core/errors.js';
import { createDeliverables } from './deliverables.js';
import { BUILTIN_SPECS, createBuiltinTools } from './builtin-tools/index.js';
import { createApprovals } from './approvals.js';
import { createViewImage, VIEW_IMAGE_SPEC } from './builtin-tools/view-image.js';
import { createSkills, USE_SKILL_SPEC } from './skills/index.js';
import { KNOWLEDGE_TOOL_SPECS } from './knowledge/tool-specs.js';
import { createKnowledgeTools } from './knowledge/tools.js';
import { createManuscriptTools } from './desk/manuscript-tools.js';

/** @typedef {{ participantId: string, meetingId: string, turnId: string, callId?: string, environmentId?:string, signal?:AbortSignal, workFolder?:string, env?:{PATH?:string,VIRTUAL_ENV?:string}, mcp?:{id:string,name:string,tool:string}, manuscript?:{path:string,version:number} }} ToolContext */

const RESOURCES = ['map', 'plans', 'log', 'minutes', 'notes', 'agent', 'settings', 'versions'];

/** @type {import('../runtime/port.js').ToolSpec[]} */
export const TOOL_SPECS = [
  ...BUILTIN_SPECS,
  VIEW_IMAGE_SPEC,
  USE_SKILL_SPEC,
  ...KNOWLEDGE_TOOL_SPECS,
  {
    name: 'python_env_install',
    description:
      'Install named Python packages into the current meeting managed environment. Supply the reason. Use this instead of terminal pip install; system Python is never modified. Optional environment is a managed environment id.',
    parameters: {
      packages: { type: 'array', required: true, items: { type: 'string' } },
      reason: { type: 'string', required: true },
      environment: { type: 'string' },
    },
  },
  {
    name: 'workspace_present',
    description:
      'Present generated files under your answer as image thumbnails or document cards. Files are copied into durable ScienceScope data. Relative paths resolve against the current meeting work folder. Provide a description for each file. To also show a presented file inside your answer text, write Markdown with the same path: ![description](path) for an image, [name](path) for a document. Other participants receive the saved paths and descriptions, never file bytes.',
    parameters: {
      files: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { path: { type: 'string', required: true }, description: { type: 'string' } },
        },
      },
    },
  },
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
      'Read a research source, chunk, shared item or entity, preserving full text and page/section anchors. ' +
      'Entities return fields, aliases, labels and paged lightweight edges; full:true reads the complete description. ' +
      'For sources use id or a citation label such as [S3 p.4] with projectId. ' +
      'Pass offset/limit to page passages; remaining states how many passages are left. ' +
      'An unknown page is null and must not be invented. Private items are unavailable.',
    parameters: {
      type: { type: 'string', enum: ['source', 'chunk', 'item', 'entity'] },
      full: { type: 'boolean' },
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
      'Resources: "map", "log" (key = project id; Markdown entries may carry <!-- sciencescope:references [schema-1 reference objects] -->), "plans" (project id or "global"), "minutes" ' +
      '(meeting id), "notes" (project id/name; give scope = project id without key to list), "agent" ' +
      '(participant id), "settings", "versions" (scope = project id lists groups; key = project id/version id reads extracted paragraphs and notes; offset/limit pages original text). ' +
      '"manuscript": scope=project id lists keys; key=project id/group id or project id/path:relative/path reads current editing blocks. offset/limit page blocks (default 40, maximum 200); remaining reports unread blocks. Optional version reads a historical version. Atoms appear as ⟦type:ref display⟧ and must be kept exactly.',
    parameters: {
      target: {
        type: 'string',
        required: true,
        enum: ['overview', 'project', 'meeting', 'changes', ...RESOURCES, 'manuscript'],
      },
      key: { type: 'string', description: 'Which item; see target.' },
      scope: { type: 'string', description: 'For listing notes: the project id.' },
      version: { type: 'string', description: 'For manuscript: read-only historical version id.' },
      before: { type: 'integer', description: 'For meetings: read messages before this seq.' },
      limit: { type: 'integer', description: 'For meetings and changes: how many to return.' },
      offset: {
        type: 'integer',
        description: 'For versions: paragraph offset in the extracted original.',
      },
    },
  },
  {
    name: 'workspace_edit',
    description:
      'Change ScienceScope data. The change applies immediately and a history version is saved when the turn ends. It can be ' +
      'undone. Text resources (plans, log, minutes, notes, agent) support op "write" {text}, "append" ' +
      '{text}, "replace" {find, with}, "delete". Log entries may include <!-- sciencescope:references [{"schema":1,"kind":"version","id":"version id","projectId":"project id","label":"file name"}] --> or kind "project-file" with path instead of id. map supports "addNode" {node: {id?, parent, text}}, ' +
      '"updateNode" {id, changes}, "removeNode" {id}, "addEdge" {edge: {from, to, label?}}, "removeEdge" ' +
      '{id}, "write" {map}. settings supports "patch" {changes}. versions edits only the paired notes Markdown (project id/version id), never original bytes. Keys are as in workspace_read. ' +
      'manuscript edits the working copy: replace {block,find,with} needs a unique exact find; preserve every atom marker and its order. insertBlock {after,text} uses a block id or ^ for the beginning; removeBlock {block}; save {to:"version"|"project",label?,tier?}. comment {block,quote,text} adds a Word/app comment; bind {block,quote,kind,value?,sources,note?} records provenance with at least one schema-1 source. Quotes must match uniquely and include complete atom markers. unbind {id} or uncomment {id} removes only your own annotation. Read annotations summaries with workspace_read manuscript. Only saving to project writes the project file and may ask approval. Report DESK_EXTERNAL_CHANGE or DESK_SAVE_CONFIRM to the user; never automatically confirm. Edits return revisionIds (chg_) for individual undo. Read current blocks before editing, and change only the requested scope.',
    parameters: {
      resource: { type: 'string', required: true, enum: [...RESOURCES, 'manuscript'] },
      key: { type: 'string', required: true },
      op: { type: 'string', required: true },
      args: { type: 'object', additionalProperties: true, description: 'Arguments of the op.' },
    },
  },
  {
    name: 'workspace_undo',
    description:
      'Undo one change by its revision id (from workspace_edit or workspace_read "changes"). Manuscript chg_ ids undo one editing change; if that block changed later, undo the later change first.',
    parameters: { revisionId: { type: 'string', required: true } },
  },
  {
    name: 'workspace_versions',
    description:
      'List, read or restore saved workspace history versions. List defaults to the current project; ' +
      'use projectId, resource or key to select other data. Read and restore use a snapshot id from list. ' +
      'Restore preserves the current content as a history version before applying the selected version. ' +
      'For resource knowledge, list returns knowledge versions; read returns their changes; restore withdraws that group of edits and lists records skipped because they were modified later. ' +
      'For corrections within the current turn, use workspace_undo.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'read', 'restore'] },
      id: { type: 'string', description: 'History snapshot id for read or restore.' },
      resource: { type: 'string', enum: [...RESOURCES, 'knowledge'] },
      key: { type: 'string' },
      projectId: { type: 'string' },
      meetingId: { type: 'string' },
      limit: { type: 'integer' },
      offset: { type: 'integer' },
    },
  },
  {
    name: 'desk_suggest',
    description:
      'Suggest entering the editing desk when a manuscript is ready for focused editing. Provide a reason and optionally a manuscript key from workspace_read. This records a suggestion; the user chooses whether to enter.',
    parameters: { reason: { type: 'string', required: true }, document: { type: 'string' } },
  },
  {
    name: 'propose_main_draft',
    description:
      'Prepare a draft instruction for the main meeting. The editable proposal is saved in its secretary conversation; the user fills the main input and sends it explicitly. This does not post a main meeting message.',
    parameters: {
      text: { type: 'string', required: true },
      mainMeetingId: {
        type: 'string',
        description: 'Omit when speaking in an attached secretary meeting.',
      },
    },
  },
];

/**
 * @param {import('../core/index.js').Core} core
 * @param {ReturnType<typeof createResearch>} [research]
 * @param {{desk?:ReturnType<typeof import('./desk/index.js').createDesk>,mcp?:ReturnType<typeof import('./mcp/index.js').createMcp>,skills?:ReturnType<typeof createSkills>,secretary?: ReturnType<typeof import('./secretary/chat.js').createSecretaryChat>,python?:ReturnType<typeof import('./python/index.js').createPython>,versions?:ReturnType<typeof import('./versions/index.js').createVersions>}} [services]
 */
export function createTools(
  core,
  research = createResearch(core),
  { secretary, python, versions, skills = createSkills(core), mcp, desk } = {},
) {
  const deliverables = createDeliverables(core);
  const builtins = createBuiltinTools(core, python);
  const viewImage = createViewImage(core, research);
  const approvals = createApprovals(core);
  const manuscript = desk && createManuscriptTools(core, desk, approvals);
  const knowledge = createKnowledgeTools(core, research);
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
        deliverables: message.deliverables?.map(({ path: filePath, description }) => ({
          path: filePath,
          description,
        })),
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
    if (name === 'use_skill') return skills.use(args?.name);
    if (name.startsWith('mcp__') && mcp) {
      await mcp.ready();
      const spec = mcp.catalog().find((item) => item.name === name && item.enabled);
      if (!spec) throw new AppError('MCP_TOOL_UNAVAILABLE', '这个 MCP 工具已停用或不可用。');
      const decision = await approvals.request(name, args, {
        ...context,
        mcp: { id: spec.server, name: spec.serverName, tool: spec.tool },
      });
      return decision ?? mcp.call(name, args, context.signal);
    }
    const decision = await approvals.request(name, args, context);
    if (decision) return decision;
    if (manuscript?.handles(name, args)) return manuscript.run(name, args, context);
    if (name === 'view_image') return viewImage(args ?? {}, context);
    if (BUILTIN_SPECS.some((spec) => spec.name === name)) return builtins(name, args, context);
    if (name === 'python_env_install') {
      if (!python) throw new Error('Python service unavailable');
      return python.install(context, args);
    }
    const actor = {
      actorId: context.participantId,
      meetingId: context.meetingId,
      turnId: context.turnId,
      projectId: core.meetings.get(context.meetingId).projectId,
    };
    if (name === 'kb_graph') return knowledge.graph({ projectId: actor.projectId, ...args });
    if (name === 'kb_write') return knowledge.write(args.ops, actor);
    if (name === 'research_write') return knowledge.writeResearch(args, actor);
    if (name === 'workspace_present') return deliverables.present(args?.files, context);
    if (name === 'propose_main_draft') {
      if (!secretary) throw new Error('Secretary draft service is unavailable.');
      return secretary.propose(context, args);
    }
    if (name === 'research_search' || name === 'research_read') {
      const projectId = args?.projectId ?? core.meetings.get(context.meetingId).projectId;
      const options = { ...args, projectId, audience: 'agent' };
      return name === 'research_search'
        ? research.search(args?.query ?? '', options)
        : research.read(options);
    }
    if (name === 'workspace_read') {
      const { target, key, scope, before, limit, offset } = args ?? {};
      if (target === 'versions' && versions) {
        if (!key)
          return { groups: versions.list(scope ?? core.meetings.get(context.meetingId).projectId) };
        const id = key.split('/').pop();
        return versions.read(id, { offset, limit });
      }
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
    if (name === 'workspace_versions') {
      if (args?.resource === 'knowledge') return knowledge.versions(args, actor);
      if (args?.action === 'read') return core.workspace.getSnapshot(args.id);
      if (args?.action === 'restore') return core.workspace.restoreSnapshot(args.id, actor);
      if (args?.action !== 'list') throw new AppError('UNKNOWN_OP', '历史版本操作无效。');
      const projectId =
        args.projectId ??
        (args.key || args.meetingId
          ? undefined
          : (core.meetings.get(context.meetingId).projectId ?? undefined));
      return core.workspace.snapshots({
        resource: args.resource,
        key: args.key,
        projectId,
        meetingId: args.meetingId,
        limit: args.limit,
      });
    }
    if (name === 'workspace_undo') return core.workspace.undo(args?.revisionId, actor);
    throw new Error(`Unknown tool: ${name}`);
  }

  async function list() {
    await mcp?.ready();
    const builtinNames = new Set([...BUILTIN_SPECS, VIEW_IMAGE_SPEC].map((spec) => spec.name));
    return [
      ...TOOL_SPECS.map((spec) => ({
        name: spec.name,
        source: builtinNames.has(spec.name) ? 'builtin' : 'sciencescope',
        description: spec.description,
        needsApproval: ['shell', 'write_file', 'edit_file', 'python_env_install'].includes(
          spec.name,
        ),
        enabled: true,
      })),
      ...(await skills.list()).map((skill) => ({
        name: skill.name,
        source: 'skill',
        description: skill.description,
        needsApproval: false,
        enabled: skill.enabled,
      })),
      ...(mcp?.catalog() ?? []).map(
        ({ name, source, server, serverName, tool, description, needsApproval, enabled }) => ({
          name,
          source,
          server,
          serverName,
          tool,
          description,
          needsApproval,
          enabled,
        }),
      ),
    ];
  }

  return {
    get specs() {
      return [...TOOL_SPECS, ...(mcp?.catalog() ?? []).filter((item) => item.enabled)];
    },
    ready: async () => {
      await mcp?.ready();
    },
    run,
    approvals,
    list,
  };
}
