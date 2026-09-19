import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import { createWorkbenchStore } from './workbench-store.mjs';

const execFile = promisify(execFileCallback);
const MAX_UPLOAD = 20 * 1024 * 1024;

export class WorkbenchApiError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'WorkbenchApiError';
    this.code = code;
    this.status = status;
  }
}

function requiredProjectId(value) {
  if (typeof value !== 'string' || !value.trim()) throw new WorkbenchApiError('INVALID_PROJECT', '请先选择有效的项目。');
  return value;
}

// Callers resolve an owned/bound location first. This helper never accepts a URL.
export async function openLocalDocument(resolved) {
  const info=await stat(resolved);
  const ordinary=info.isDirectory()||/\.(?:pdf|docx?|xlsx?|pptx?|csv|tsv|txt|md|markdown|json|yaml|yml|xml|css|rs|go|java|c|h|cpp|hpp|sql|tex|png|jpe?g|webp|gif|svg|bmp|tiff?|mp3|wav|mp4|mov|zip|7z|rar)$/iu.test(resolved);
  const command=ordinary
    ? '$p = New-Object System.Diagnostics.ProcessStartInfo; $p.FileName = $env:SCOPESCOPE_OPEN_PATH; $p.UseShellExecute = $true; [System.Diagnostics.Process]::Start($p) | Out-Null'
    : '$p = New-Object System.Diagnostics.ProcessStartInfo; $p.FileName = Join-Path $env:SystemRoot "explorer.exe"; $p.Arguments = \'/select,"\' + $env:SCOPESCOPE_OPEN_PATH + \'"\'; $p.UseShellExecute = $true; [System.Diagnostics.Process]::Start($p) | Out-Null';
  await execFile(path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,env:{...process.env,SCOPESCOPE_OPEN_PATH:resolved}});
  return {opened:true};
}

export async function createWorkbenchApi({ stateDir, projectsDir, getWorkspace }) {
  const store = await createWorkbenchStore({ stateDir, projectsDir });
  async function project(projectId) {
    const id = requiredProjectId(projectId);
    const workspace = await getWorkspace();
    const found = workspace.projects?.find(item => item.id === id && !item.archived);
    if (!found) throw new WorkbenchApiError('PROJECT_NOT_FOUND', '项目不存在或已归档。', 404);
    return { id, meta: found };
  }
  async function call(projectId, method, ...args) {
    const selected = await project(projectId);
    try {
      const result = await store[method](projectId, ...(method === 'get' ? [selected.meta.name, ...args] : args));
      if ((method === 'get' || method === 'save') && result && typeof result === 'object') result.folder = await store.resolvePath(projectId, '');
      return result;
    }
    catch (error) {
      if (error?.code === 'REVISION_CONFLICT' || error?.message === 'REVISION_CONFLICT') throw new WorkbenchApiError('REVISION_CONFLICT', '工作台已被其他操作更新，请刷新后重试。', 409);
      if (error?.code === 'INVALID_MAP' || error?.message === 'INVALID_MAP') throw new WorkbenchApiError('INVALID_MAP', '导图文件格式无效，请修复或恢复文件；未覆盖。', 409);
      if (error?.code === 'NOT_FOUND' || error?.message === 'PROJECT_NOT_FOUND') throw new WorkbenchApiError('NOT_FOUND', '工作台文件不存在。', 404);
      throw error;
    }
  }
  async function open(projectId, relative) {
    await project(projectId);
    let resolved;
    try { resolved = await store.resolvePath(projectId, relative); }
    catch { throw new WorkbenchApiError('INVALID_PATH', '文件路径无效。'); }
    return openLocalDocument(resolved);
  }
  return { store, project, call, open, MAX_UPLOAD };
}
