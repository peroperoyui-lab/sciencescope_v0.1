// Copy presented originals into application data; runtime tools return metadata only.
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../core/errors.js';
import { safeFileName } from '../core/paths.js';
import { openPath } from './system.js';

const TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
};

/** @param {import('../core/index.js').Core} core @param {{open?:typeof openPath}} [options] */
export function createDeliverables(core, { open = openPath } = {}) {
  async function present(files, context) {
    if (!Array.isArray(files) || !files.length)
      throw new AppError('INVALID_DELIVERABLE', '交付物列表无效。');
    const messageId = core.deliverables.answerFor(context.turnId);
    const callId = context.callId ?? '';
    const meeting = core.meetings.get(context.meetingId);
    const project = meeting.projectId ? core.projects.get(meeting.projectId) : null;
    const workFolder =
      meeting.workFolder ??
      project?.folder ??
      (project ? core.workspace.locate.projectDir(project.id) : core.paths.root);
    const ready = [];
    for (const file of files) {
      if (typeof file?.path !== 'string' || !file.path.trim())
        throw new AppError('INVALID_DELIVERABLE', '交付物文件无效。');
      const sourcePath = path.resolve(workFolder, file.path);
      const previous =
        ready.find((item) => item.sourcePath === sourcePath) ??
        core.deliverables.existing(context.turnId, callId, sourcePath);
      if (previous) {
        ready.push(previous);
        continue;
      }
      let info;
      try {
        info = await stat(sourcePath);
      } catch {
        throw new AppError('DELIVERABLE_MISSING', '文件已不存在或已被移动。', 404);
      }
      if (!info.isFile()) throw new AppError('INVALID_DELIVERABLE', '交付物文件无效。');
      const id = core.deliverables.newId();
      const name = path.basename(sourcePath);
      const target = path.join(core.paths.deliverables, id, safeFileName(name, name.length));
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(sourcePath, target);
      ready.push({
        id,
        messageId,
        turnId: context.turnId,
        toolCallId: callId,
        sourcePath,
        path: target,
        name,
        description: typeof file.description === 'string' ? file.description : '',
        mediaType: TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream',
        size: info.size,
      });
    }
    core.db.transaction(() => {
      for (const file of ready)
        if (!core.deliverables.existing(context.turnId, callId, file.sourcePath))
          core.deliverables.add(file);
      core.messages.update(messageId, {});
    });
    return { files: ready.map((file) => ({ path: file.path, description: file.description })) };
  }
  async function content(id) {
    const file = core.deliverables.get(id);
    try {
      return { bytes: await readFile(file.path), type: file.mediaType, name: file.name };
    } catch (error) {
      if (error.code === 'ENOENT')
        throw new AppError('DELIVERABLE_MISSING', '文件已不存在或已被移动。', 404);
      throw error;
    }
  }
  async function openFile(id) {
    const file = core.deliverables.get(id);
    try {
      await stat(file.path);
    } catch {
      throw new AppError('DELIVERABLE_MISSING', '文件已不存在或已被移动。', 404);
    }
    await open(file.path);
    return { opened: true };
  }
  return { present, content, open: openFile };
}
