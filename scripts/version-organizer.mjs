import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_NOTES_TEMPLATE } from './secretary-preferences.mjs';

const MAX_TEXT = 40000;
const SUPPORTED = new Set(['.md', '.txt', '.csv', '.tex', '.json']);

function modelKey(model) {
  if (!model || typeof model.providerId !== 'string' || !model.providerId.trim() ||
      typeof model.modelId !== 'string' || !model.modelId.trim()) {
    throw new TypeError('model.providerId and model.modelId are required');
  }
  return { providerId: model.providerId, modelId: model.modelId };
}

function extension(version) {
  return path.extname(String(version?.name ?? version?.relativePath ?? '')).toLowerCase();
}

function textPart(value, label) {
  const text = String(value ?? '');
  if (text.length <= MAX_TEXT) return { text, truncated: false };
  return { text: `${text.slice(0, MAX_TEXT)}\n\n[${label} truncated at ${MAX_TEXT} characters]`, truncated: true };
}

function previousVersion(snapshot, version) {
  const group = version.group ?? version.name;
  return (snapshot.versions ?? [])
    .filter((candidate) => candidate.id !== version.id && (candidate.group ?? candidate.name) === group)
    .filter((candidate) => Number(candidate.number) < Number(version.number))
    .sort((a, b) => Number(b.number) - Number(a.number))[0];
}

function promptFor({ project, version, source, baseline, notesTemplate }) {
  return [
    '你是项目文件秘书。请只整理版本变化说明，不要替用户决定研究方向，不要改写原件。',
    `请使用以下笔记模板作为 Markdown 输出结构（保留标题和顺序，可在其下补充内容）：\n${notesTemplate}`,
    '说明中保留原件位置、对比基线、研究影响、已决定与待决定事项及生成时间；模板没有这些标题时放在相关章节。',
    '若输入被截取，请明确说明可获得的内容范围；不要声称看到了未提供的内容。',
    `项目上下文：${project ? JSON.stringify(project) : '无'}`,
    `当前版本：${version.name}（第 ${version.number ?? '?'} 版）`,
    `原件相对位置：${version.relativePath}`,
    `当前原件内容：\n${source.text}`,
    baseline ? `对比基线：${baseline.version.name}\n${baseline.text}` : '对比基线：无（首版）',
  ].join('\n\n');
}

/**
 * Build the isolated, no-tools secretary workflow for a paper version.
 * `host` is the public desktop DSH host (startSession/send/releaseSession).
 */
export function createVersionOrganizer({ host, store, getProject, getPreferences }) {
  if (!host || !store) throw new TypeError('host and store are required');
  const pending = new Map();

  function organize({ projectId, versionId, model }) {
    const key = `${projectId}:${versionId}`;
    if (pending.has(key)) return pending.get(key);
    const work = run({ projectId, versionId, model: modelKey(model) }).finally(() => pending.delete(key));
    pending.set(key, work);
    return work;
  }

  async function run({ projectId, versionId, model }) {
    const snapshot = await store.get(projectId);
    const version = (snapshot.versions ?? []).find((item) => item.id === versionId);
    if (!version) throw new Error('VERSION_NOT_FOUND');
    const ext = extension(version);
    if (!SUPPORTED.has(ext)) {
      return store.updateVersion(projectId, versionId, { status: 'unsupported', note: '秘书仅支持 .md、.txt、.csv、.tex、.json 原件。' });
    }

    let sessionId;
    try {
      const originalPath = await store.resolvePath(projectId, version.relativePath);
      const source = textPart(await readFile(originalPath, 'utf8'), 'current version');
      const baselineVersion = previousVersion(snapshot, version);
      let baseline;
      if (baselineVersion) {
        const baselinePath = await store.resolvePath(projectId, baselineVersion.relativePath);
        baseline = { version: baselineVersion, ...textPart(await readFile(baselinePath, 'utf8'), 'baseline') };
      }
      const preferences = await getPreferences?.(projectId) ?? { notesTemplate: DEFAULT_NOTES_TEMPLATE };
      const notesTemplate = typeof preferences.notesTemplate === 'string' && preferences.notesTemplate.length > 0
        ? preferences.notesTemplate
        : DEFAULT_NOTES_TEMPLATE;
      const prompt = promptFor({ project: await getProject?.(projectId), version, source, baseline, notesTemplate });
      const runtimeConfig = await host.getRuntimeConfig?.();
      sessionId = await host.startSession({ model, workspace: path.dirname(originalPath), runtimeConfig, noTools: true });
      const response = await host.send({ sessionId, text: prompt });
      const note = String(response?.finalResponse ?? response?.text ?? '').trim();
      if (!note) throw new Error('EMPTY_RESPONSE');
      const preferredName = `${path.basename(originalPath)}.notes.md`;
      let noteName = preferredName;
      try { await access(path.join(path.dirname(originalPath), preferredName));
        if (version.status === 'organized') return version;
        noteName = `${path.basename(originalPath)}.notes.${Date.now()}.md`;
      } catch { /* no existing note */ }
      const notePath = path.join(path.dirname(originalPath), noteName);
      const provenance=`<!-- ScienceScope secretary: ${JSON.stringify({generatedAt:new Date().toISOString(),model,source:version.relativePath,baseline:baselineVersion?.relativePath??null,sourceTruncated:source.truncated,baselineTruncated:baseline?.truncated??false})} -->`;
      await writeFile(notePath, `${provenance}\n\n${note}\n`, {encoding:'utf8',flag:'wx'});
      const relativeNote = path.posix.join(path.posix.dirname(version.relativePath.replaceAll('\\', '/')), noteName);
      const summary = note.replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').slice(0, 500);
      return store.updateVersion(projectId, versionId, { status: 'organized', note: relativeNote, summary });
    } catch {
      await store.updateVersion(projectId, versionId, { status: 'failed', note: '秘书整理失败；原件仍保留，可稍后重新整理。' });
      return store.get(projectId).then((next) => next.versions.find((item) => item.id === versionId));
    } finally {
      if (sessionId && typeof host.releaseSession === 'function') await host.releaseSession(sessionId).catch(() => {});
    }
  }

  return { organize };
}

export default { createVersionOrganizer };
