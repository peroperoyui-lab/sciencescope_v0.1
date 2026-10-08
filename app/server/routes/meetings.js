import { LOCAL_USER_ID } from '../../core/defaults.js';
import { attachment } from '../attachment.js';
import { meetingMarkdown } from '../../services/export.js';
import { registerOutboxRoutes } from './outbox.js';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../core/errors.js';

const user = { actorId: LOCAL_USER_ID };

/** @param {string | null} value */
function optionalNumber(value) {
  return value == null || value === '' ? undefined : Number(value);
}

/**
 * Posting a message stores it; the conductor reacts to the stored event and
 * starts the answers, so this route does not wait for them.
 * @param {import('../router.js').Router} router
 * @param {import('../../core/index.js').Core} core
 * @param {{ interrupt: (meetingId: string) => Promise<void>,
 *   retry: (messageId: string) => Promise<unknown>, continue?: (messageId: string) => Promise<unknown>,
 *   submit?: (input:any)=>any }} [conductor]
 * @param {ReturnType<typeof import('../../services/research-input/index.js').createResearchInput>} [researchInput]
 * @param {ReturnType<typeof import('../../services/python/index.js').createPython>} [python]
 */
export function registerMeetingRoutes(router, core, conductor, researchInput, python) {
  registerOutboxRoutes(router, core);
  router.get('/api/meetings', ({ query }) => {
    const projectId = query.get('projectId');
    return core.meetings.list({
      projectId: query.get('global') === '1' ? null : (projectId ?? undefined),
      attachedTo: query.get('attachedTo') ?? undefined,
      includeArchived: query.get('archived') === '1',
    });
  });
  router.post('/api/meetings', async ({ body }) => {
    const details = body.creation;
    let workFolder = body.workFolder;
    if (details && !body.projectId) {
      if (details.folderMode === 'existing') {
        workFolder = details.workFolder;
        if (
          !path.isAbsolute(workFolder) ||
          !(await stat(workFolder).catch(() => null))?.isDirectory()
        )
          throw new AppError('INVALID_FOLDER', '请选择现有工作文件夹。');
      } else {
        workFolder = path.join(
          core.paths.root,
          'workspaces',
          details.folderMode === 'shared' ? 'shared' : randomUUID(),
        );
        await mkdir(workFolder, { recursive: true });
      }
    }
    return core.db.transaction(() => {
      const meeting = core.meetings.create({ ...body, workFolder }, user);
      if (details?.environment && !body.projectId)
        python?.bind('meeting', meeting.id, details.environment);
      return meeting;
    });
  });
  router.get('/api/meetings/:id/contexts', ({ params }) => core.meetings.contexts(params.id));
  router.get('/api/meetings/:id', ({ params }) => core.meetings.get(params.id));
  router.patch('/api/meetings/:id', ({ params, body }) =>
    core.meetings.update(params.id, body, user),
  );
  router.post('/api/meetings/:id/fork', ({ params, body }) =>
    core.meetings.fork(params.id, body, user),
  );

  router.get('/api/meetings/:id/messages', ({ params, query }) =>
    core.messages.list(params.id, {
      before: optionalNumber(query.get('before')),
      after: optionalNumber(query.get('after')),
      limit: optionalNumber(query.get('limit')),
    }),
  );
  router.post('/api/meetings/:id/messages', ({ params, body }) =>
    core.db.transaction(() => {
      const result = (conductor?.submit ?? core.messages.post)({
        meetingId: params.id,
        authorId: body.authorId ?? LOCAL_USER_ID,
        text: body.text,
        refs: body.refs,
        researchInput: body.researchInput && researchInput?.capture(body.researchInput),
        replyTo: body.replyTo,
      });
      if (body.researchInput)
        researchInput?.change(params.id, { op: 'consume', input: body.researchInput });
      return result;
    }),
  );
  router.post('/api/meetings/:id/interrupt', async ({ params }) => {
    await conductor?.interrupt(params.id);
    return { interrupted: true };
  });
  router.get('/api/meetings/:id/export', async ({ params, response }) => {
    const meeting = core.meetings.get(params.id);
    response.writeHead(200, {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': attachment(`${meeting.title}.md`),
    });
    response.end(await meetingMarkdown(core, params.id));
    return undefined;
  });
  router.get('/api/search', ({ query }) => ({
    messages: core.messages.search(query.get('q') ?? ''),
  }));
  router.get('/api/turns/:id', ({ params }) => ({
    turn: core.turns.get(params.id),
    toolCalls: core.turns.toolCalls(params.id),
  }));
  router.post('/api/messages/:id/retry', ({ params }) => {
    // The new answer arrives through the event stream.
    conductor?.retry(params.id).catch(() => {});
    return { retrying: true };
  });
  router.post('/api/messages/:id/continue', ({ params }) => {
    conductor?.continue?.(params.id).catch(() => {});
    return { continuing: true };
  });
  router.patch('/api/messages/:id', ({ params, body }) =>
    core.messages.update(params.id, { adopted: body.adopted }),
  );
}
