// Reading is a projection of original bytes, independent of model input.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import { createProjectFiles } from '../project-files.js';
import { extractCitationLabels } from '../research/citations.js';
import { AppError } from '../../core/errors.js';

/**
 * @param {import('../../core/index.js').Core} core
 * @param {ReturnType<typeof import('../research/index.js').createResearch>} research
 */
export function createPreview(core, research) {
  const files = createProjectFiles(core);
  function locate(target) {
    if (target.kind === 'tool') {
      const preview = core.turns.toolCalls(target.turnId).find((call) => call.callId === target.id)
        ?.result?.preview;
      if (!preview) throw new AppError('PREVIEW_NOT_FOUND', 'Image preview is unavailable.', 404);
      return {
        path: preview.path,
        name: path.basename(preview.path),
        mimeType: preview.mimeType,
        projectId: core.meetings.get(core.turns.get(target.turnId).meetingId).projectId,
      };
    }
    if (target.kind === 'version') {
      const version = core.versionCatalog.get(target.id);
      return {
        path: core.versionCatalog.file(target.id),
        name: version.name,
        projectId: version.projectId,
      };
    }
    if (target.kind === 'project')
      return {
        path: files.locate(target.projectId, target.path),
        name: path.basename(target.path),
        projectId: target.projectId,
      };
    if (target.kind === 'deliverable') {
      const file = core.deliverables.get(target.id);
      return {
        path: file.path,
        name: file.name,
        projectId: core.messages.get(file.messageId).meetingId
          ? core.meetings.get(core.messages.get(file.messageId).meetingId).projectId
          : null,
      };
    }
    const source = research.store.getSource(target.id);
    return {
      path: path.join(core.paths.library, source.originalPath),
      name: source.name,
      projectId: source.projectId,
      source,
    };
  }
  async function content(target) {
    const file = locate(target);
    return { ...file, bytes: await readFile(file.path) };
  }
  async function document(target) {
    const file = await content(target);
    const extension = path.extname(file.name).slice(1).toLowerCase();
    const format =
      {
        pdf: 'pdf',
        docx: 'docx',
        csv: 'csv',
        md: 'markdown',
        markdown: 'markdown',
        tex: 'latex',
        png: 'image',
        jpg: 'image',
        jpeg: 'image',
        webp: 'image',
        gif: 'image',
      }[extension] ?? 'code';
    const result = {
      target,
      name: file.name,
      projectId: file.projectId,
      source: file.source,
      format,
      extension,
      text: null,
      html: null,
    };
    if (format === 'docx') {
      const converted = await mammoth.convertToHtml({ buffer: file.bytes });
      result.html = converted.value;
    } else if (!['pdf', 'image'].includes(format)) result.text = file.bytes.toString('utf8');
    return result;
  }
  function citations(messageId) {
    const message = core.messages.get(messageId);
    const projectId = core.meetings.get(message.meetingId).projectId;
    const selected = message.replyTo
      ? (core.messages.get(message.replyTo).researchInput?.materials ?? [])
      : [];
    return extractCitationLabels(message.text).map((label) => ({
      ...label,
      targets: label.citations
        .filter((citation) => citation.kind === 'source')
        .flatMap((citation) => {
          const chosen = selected.find((entry) => entry.label === citation.label);
          const source = chosen
            ? research.store.getSource(chosen.id)
            : (research.store.findSource(citation.label, projectId) ??
              research.store.findSource(citation.label, null));
          if (!source) return [];
          const chunk = research.store
            .chunks(source.id)
            .find((entry) => !citation.fromPage || entry.page === citation.fromPage);
          return [
            {
              kind: 'source',
              id: source.id,
              projectId: source.projectId,
              page: citation.fromPage ?? 1,
              highlight: chunk?.text ?? '',
            },
          ];
        }),
    }));
  }
  return { content, document, citations };
}
