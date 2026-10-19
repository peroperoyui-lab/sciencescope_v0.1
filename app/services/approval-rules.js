// Saved rules use the same canonical file paths as the tools. Matching does not
// evaluate shell syntax: compound commands offer only an exact-command choice.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { filePath } from './builtin-tools/files.js';
import { toolWorkFolder } from './builtin-tools/index.js';
import { validatePackages } from './python/files.js';

const compound = /[;|`\r\n]|&&|\$\(/u;
const subcommands = new Set(['npm', 'npx', 'git', 'uv', 'pip', 'conda']);
const packageName = (spec) =>
  spec
    .match(/^[\w.-]+/u)[0]
    .toLowerCase()
    .replace(/[_.-]+/gu, '-');
const scope = (kind, value, label, values = {}) => ({ kind, value, label, values });
const inside = (folder, target) => {
  const relative = path.relative(folder, target);
  return (
    !relative ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
};

/**
 * @param {import('../core/index.js').Core} core
 */
export function createApprovalRules(core) {
  async function operation(tool, args, context) {
    if (tool === 'shell') return { command: String(args.command ?? '') };
    if (tool === 'python_env_install')
      return { packages: [...new Set(validatePackages(args.packages ?? []).map(packageName))] };
    if (['write_file', 'edit_file'].includes(tool))
      return {
        target: await filePath(toolWorkFolder(core, context), args.path, core.paths.secret),
      };
    return {};
  }

  async function scopes(tool, args, context) {
    const value = await operation(tool, args, context);
    if (tool === 'shell') {
      const result = [scope('exact', value.command, '这条命令（完全一致）')];
      const words = value.command.trim().match(/"[^"]*"|'[^']*'|\S+/gu) ?? [];
      const count = subcommands.has(words[0]) ? 2 : 1;
      if (!compound.test(value.command) && words.length >= count) {
        const prefix = words.slice(0, count).join(' ');
        result.push(scope('prefix', prefix, '以 {prefix} 开头的命令', { prefix }));
      }
      return result;
    }
    if (value.target)
      return [
        scope('exact', value.target, '这个文件'),
        scope('folder', path.dirname(value.target), '这个文件夹里的文件（含子文件夹）'),
      ];
    if (value.packages)
      return [
        ...value.packages.map((name) =>
          scope('package', name, '安装 {package}', { package: name }),
        ),
        scope('any', '', '所有安装包'),
      ];
    return [];
  }

  async function matching(tool, args, context) {
    const meeting = core.meetings.get(context.meetingId);
    const settings = await core.workspace.read({ resource: 'settings', key: 'app' });
    const rules = settings.value.approvals.rules.filter(
      (rule) =>
        rule.tool === tool &&
        (meeting.projectId
          ? rule.projectId === meeting.projectId && rule.meetingId == null
          : rule.projectId == null && rule.meetingId === meeting.id),
    );
    if (!rules.length) return [];
    const value = await operation(tool, args, context);
    if (value.packages) {
      const all = rules.find((rule) => rule.kind === 'any');
      if (all) return [all];
      const matches = value.packages.map((name) =>
        rules.find((rule) => rule.kind === 'package' && rule.value === name),
      );
      return matches.length && matches.every(Boolean) ? [...new Set(matches)] : [];
    }
    for (const rule of rules) {
      if (tool === 'shell') {
        if (rule.kind === 'exact' && value.command === rule.value) return [rule];
        if (
          rule.kind === 'prefix' &&
          !compound.test(value.command) &&
          (value.command.trim() === rule.value || value.command.trim().startsWith(`${rule.value} `))
        )
          return [rule];
      } else if (value.target && ['exact', 'folder'].includes(rule.kind)) {
        const target = await filePath(toolWorkFolder(core, context), rule.value, core.paths.secret);
        if (
          rule.kind === 'exact'
            ? !path.relative(target, value.target)
            : inside(target, value.target)
        )
          return [rule];
      }
    }
    return [];
  }

  async function remember(tool, selected, meetingId) {
    const meeting = core.meetings.get(meetingId);
    const rule = {
      id: `approval_rule_${randomUUID()}`,
      projectId: meeting.projectId,
      meetingId: meeting.projectId ? null : meeting.id,
      tool,
      kind: selected.kind,
      value: selected.value,
      createdAt: new Date().toISOString(),
    };
    // Append inside the workspace file queue, so simultaneous approvals cannot
    // replace each other's rules or a concurrent settings edit.
    const result = await core.workspace.edit(
      { resource: 'settings', key: 'app', op: 'add-approval-rule', args: { rule } },
      { actorId: 'person_user', meetingId },
    );
    return result.value.approvals.rules.find(
      (saved) =>
        saved.projectId === rule.projectId &&
        saved.meetingId === rule.meetingId &&
        saved.tool === rule.tool &&
        saved.kind === rule.kind &&
        saved.value === rule.value,
    );
  }

  function mark(context, rules) {
    const call = core.turns.toolCalls(context.turnId).find((row) => row.callId === context.callId);
    if (!call) return;
    const approvedBy = {
      ruleId: rules[0].id,
      ...(rules.length > 1 ? { ruleIds: rules.map((rule) => rule.id) } : {}),
    };
    core.turns.updateActivity(context.turnId, context.callId, { ...call.result, approvedBy });
  }

  return { scopes, matching, remember, mark };
}
