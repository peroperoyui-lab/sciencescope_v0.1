import path from 'node:path';
import { mkdir, readFile, writeFile, rename, readdir, lstat, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const clone = value => JSON.parse(JSON.stringify(value));
const posix = value => value.split(path.sep).join('/');

async function atomicJson(file, value) {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}
async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return fallback; throw error; }
}
function requireProjectId(id) {
  if (typeof id !== 'string' || !id.trim() || id.length > 200) throw new TypeError('Invalid projectId');
  return id;
}
function safeName(name) {
  const value = path.basename(String(name || '')).replace(/[\u0000]/g, '').trim();
  if (!value || value === '.' || value === '..') throw new TypeError('Invalid file name');
  return value;
}
function initialSnapshot(projectName) {
  return { revision: 0, map: { nodes: [{ id: 'root', parent: null, type: 'main', text: projectName, x: 80, y: 80, attachments: [] }], edges: [] }, logs: [], versions: [], autoOrganize: false };
}
function validMap(value) {
  if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return false;
  const ids = new Set();
  for (const node of value.nodes) {
    if (!node || typeof node.id !== 'string' || !node.id || ids.has(node.id)) return false;
    ids.add(node.id);
  }
  for (const node of value.nodes) {
    if (node.parent !== null && node.parent !== undefined && (typeof node.parent !== 'string' || !ids.has(node.parent))) return false;
    const seen = new Set([node.id]); let cursor = node;
    while (cursor.parent !== null && cursor.parent !== undefined) {
      if (seen.has(cursor.parent)) return false;
      seen.add(cursor.parent); cursor = value.nodes.find(item => item.id === cursor.parent);
      if (!cursor) return false;
    }
  }
  for (const edge of value.edges) {
    if (!edge || typeof edge !== 'object') return false;
    const from = edge.source ?? edge.from; const to = edge.target ?? edge.to;
    if ((from !== undefined && !ids.has(from)) || (to !== undefined && !ids.has(to))) return false;
  }
  return true;
}

export class WorkbenchStore {
  constructor({ stateDir, projectsDir }) {
    if (!stateDir || !projectsDir) throw new TypeError('stateDir and projectsDir are required');
    this.stateDir = path.resolve(stateDir); this.projectsDir = path.resolve(projectsDir);
    this.plansFile = path.join(this.stateDir, 'plans.json');
    this.bindingsFile = path.join(this.stateDir, 'workbench-bindings.json');
    this.bindings = {};
    this.queue = Promise.resolve();
  }
  async init() {
    await mkdir(this.stateDir, { recursive: true }); await mkdir(this.projectsDir, { recursive: true });
    this.bindings = await readJson(this.bindingsFile, {});
    return this;
  }
  _enqueue(task) {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }
  _defaultFolder(projectId) { return path.join(this.projectsDir, `project-${encodeURIComponent(projectId)}`); }
  async _folder(projectId, create = false) {
    requireProjectId(projectId);
    const configured = this.bindings[projectId] || this._defaultFolder(projectId);
    const folder = path.resolve(configured);
    if (create) await mkdir(folder, { recursive: true });
    const actual = await realpath(folder);
    if (!path.isAbsolute(actual)) throw new Error('Invalid project folder');
    return actual;
  }
  async _load(projectId, projectName = '研究框架') {
    const folder = await this._folder(projectId, true);
    const stateFile = path.join(folder, 'workbench.json');
    const saved = await readJson(stateFile, null);
    const mapFile = path.join(folder, 'mind_map', 'research.json');
    let map;
    try { map = await readJson(mapFile, null); }
    catch (error) {
      if (error?.code === 'ENOENT') map = null;
      else { const invalid = new Error('INVALID_MAP'); invalid.code = 'INVALID_MAP'; throw invalid; }
    }
    if (map !== null && !validMap(map)) {
      const error = new Error('INVALID_MAP'); error.code = 'INVALID_MAP'; throw error;
    }
    if (saved) {
      const snapshot = { ...initialSnapshot(projectName), ...saved, map: saved.map || initialSnapshot(projectName).map };
      if (validMap(map) && JSON.stringify(map) !== JSON.stringify(snapshot.map)) {
        snapshot.map = map; snapshot.revision += 1; await atomicJson(stateFile, snapshot);
      }
      await mkdir(path.join(folder, 'mind_map'), { recursive: true }); await mkdir(path.join(folder, 'paper_versions'), { recursive: true });
      return { folder, stateFile, snapshot };
    }
    const snapshot = initialSnapshot(projectName); if (validMap(map)) snapshot.map = map;
    await mkdir(path.join(folder, 'mind_map'), { recursive: true }); await mkdir(path.join(folder, 'paper_versions'), { recursive: true }); await atomicJson(stateFile, snapshot); await atomicJson(mapFile, snapshot.map);
    return { folder, stateFile, snapshot };
  }
  async get(projectId, projectName = '研究框架') { return this._enqueue(async () => clone((await this._load(projectId, projectName)).snapshot)); }
  async bind(projectId, folder) { return this._enqueue(async () => {
    requireProjectId(projectId); if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new TypeError('folder must be absolute');
    const actual = await realpath(folder); const info = await lstat(actual); if (!info.isDirectory()) throw new Error('folder must be a directory');
    this.bindings[projectId] = actual; await atomicJson(this.bindingsFile, this.bindings); return actual;
  }); }
  async listFiles(projectId, relative = '') { return this._enqueue(async () => {
    const folder = await this._folder(projectId); const directory = await this._resolve(projectId, relative, true);
    const entries = await readdir(directory, { withFileTypes: true }); const result = [];
    for (const entry of entries.slice(0, 500)) {
      const full = path.join(directory, entry.name); const info = await lstat(full); if (info.isSymbolicLink()) continue;
      result.push({ name: entry.name, path: posix(path.relative(folder, full)), directory: info.isDirectory(), extension: info.isDirectory() ? '' : path.extname(entry.name), size: info.isDirectory() ? 0 : info.size });
    }
    return result;
  }); }
  async _resolve(projectId, relative = '', mustExist = false) {
    const folder = await this._folder(projectId); if (typeof relative !== 'string' || path.isAbsolute(relative)) throw new Error('Invalid relative path');
    const candidate = path.resolve(folder, relative); const root = path.resolve(folder); const within = candidate === root || candidate.startsWith(`${root}${path.sep}`); if (!within) throw new Error('Path escapes project folder');
    let checked; try { checked = await realpath(candidate); } catch (error) {
      if (mustExist || error.code !== 'ENOENT') throw error;
      let existing = candidate; const missing = [];
      while (true) {
        try { existing = await realpath(existing); break; }
        catch (parentError) { if (parentError.code !== 'ENOENT') throw parentError; const name = path.basename(existing); if (!name) throw parentError; missing.unshift(name); existing = path.dirname(existing); }
      }
      checked = path.join(existing, ...missing);
    }
    if (!(checked === root || checked.startsWith(`${root}${path.sep}`))) throw new Error('Path escapes project folder');
    return checked;
  }
  async resolvePath(projectId, relative = '') { return this._resolve(projectId, relative, false); }
  async save(projectId, input = {}) { return this._enqueue(async () => {
    const loaded = await this._load(projectId); const current = loaded.snapshot; if (input.revision !== current.revision) throw new Error('REVISION_CONFLICT');
    const next = { ...current, revision: current.revision + 1 }; for (const key of ['map', 'logs', 'autoOrganize']) if (input[key] !== undefined) next[key] = clone(input[key]);
    await atomicJson(loaded.stateFile, next); await mkdir(path.join(loaded.folder, 'mind_map'), { recursive: true }); await atomicJson(path.join(loaded.folder, 'mind_map', 'research.json'), next.map); return clone(next);
  }); }
  async importFile(projectId, { name, base64, group } = {}) { return this._enqueue(async () => {
    const loaded = await this._load(projectId); const filename = safeName(name); if (typeof base64 !== 'string') throw new TypeError('base64 is required');
    const bytes = Buffer.from(base64, 'base64'); const id = randomUUID(); const relativePath = posix(path.join('paper_versions', id, filename)); const target = await this._resolve(projectId, relativePath); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes);
    const groupKey = group ?? filename;
    const number = loaded.snapshot.versions.filter(item => (item.group ?? item.name) === groupKey).reduce((max, item) => Math.max(max, Number(item.number) || 0), 0) + 1;
    const version = { id, name: filename, group: group ?? null, number, relativePath, created: new Date().toISOString(), status: 'stored' }; loaded.snapshot.versions.push(version); loaded.snapshot.revision += 1; await atomicJson(loaded.stateFile, loaded.snapshot); return clone(version);
  }); }
  async addAsset(projectId, { name, base64 } = {}) { return this._enqueue(async () => {
    let filename = safeName(name); if (typeof base64 !== 'string') throw new TypeError('base64 is required');
    const assetRoot = await this._resolve(projectId, 'mind_map/assets'); await mkdir(assetRoot, { recursive: true });
    let target = path.join(assetRoot, filename);
    try { await lstat(target); const ext = path.extname(filename); const stem = filename.slice(0, -ext.length || undefined); filename = `${stem}-${randomUUID()}${ext}`; target = path.join(assetRoot, filename); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const relative = posix(path.join('mind_map', 'assets', filename)); await writeFile(target, Buffer.from(base64, 'base64')); return { name: filename, path: relative };
  }); }
  async getPlans() { return this._enqueue(async () => clone(await readJson(this.plansFile, []))); }
  async savePlans(plans) { return this._enqueue(async () => { if (!Array.isArray(plans)) throw new TypeError('plans must be an array'); await atomicJson(this.plansFile, plans); return clone(plans); }); }
  async updateVersion(projectId, id, patch = {}) { return this._enqueue(async () => {
    const loaded = await this._load(projectId); const version = loaded.snapshot.versions.find(item => item.id === id); if (!version) throw new Error('VERSION_NOT_FOUND');
    for (const key of ['note', 'status', 'summary']) if (patch[key] !== undefined) version[key] = patch[key]; loaded.snapshot.revision += 1; await atomicJson(loaded.stateFile, loaded.snapshot); return clone(version);
  }); }
}
export async function createWorkbenchStore(options) { return new WorkbenchStore(options).init(); }
