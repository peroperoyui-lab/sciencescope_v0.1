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

  async updateVersionWithProvenance(projectId, id, patch = {}, { expectedBefore, provenance } = {}) { return this._enqueue(async () => {
    const loaded = await this._load(projectId); const version = loaded.snapshot.versions.find(item => item.id === id); if (!version) throw new Error('VERSION_NOT_FOUND');
    if (expectedBefore && JSON.stringify(version) !== JSON.stringify(expectedBefore)) throw new Error('TARGET_CHANGED');
    const before = clone(version); for (const key of ['note', 'status', 'summary']) if (patch[key] !== undefined) version[key] = patch[key];
    loaded.snapshot.revision += 1; await atomicJson(loaded.stateFile, loaded.snapshot); return { before, after: clone(version), revision: loaded.snapshot.revision };
  }); }

  async restoreVersionWithProvenance(projectId, id, before, after, { revision } = {}) { return this._enqueue(async () => {
    const loaded = await this._load(projectId); if (revision !== undefined && revision !== loaded.snapshot.revision) throw new Error('REVISION_CONFLICT');
    const version = loaded.snapshot.versions.find(item => item.id === id); if (!version || JSON.stringify(version) !== JSON.stringify(after)) throw new Error('TARGET_CHANGED');
    const restored = { ...version }; for (const key of ['note', 'status', 'summary']) { if (Object.hasOwn(before || {}, key)) restored[key] = before[key]; else delete restored[key]; }
    const next = { ...loaded.snapshot, revision: loaded.snapshot.revision + 1, versions: loaded.snapshot.versions.map(item => item.id === id ? restored : item) };
    await atomicJson(loaded.stateFile, next); return clone(restored);
  }); }

  // T18 summary writes are one queue item each. They check the map snapshot
  // revision inside the queue and never call another queued method, avoiding
  // the nested-queue deadlock that a read/modify/save helper would create.
  async appendLogWithProvenance(projectId, { title, note, provenance, revision } = {}) { return this._enqueue(async () => {
    const loaded = await this._load(projectId); if (revision !== undefined && revision !== loaded.snapshot.revision) throw new Error('REVISION_CONFLICT');
    if (typeof title !== 'string' || !title.trim() || typeof note !== 'string') throw new TypeError('title and note are required');
    const stamp = new Date().toISOString(); const entry = { id: `summary-${randomUUID()}`, title: title.trim(), note, text: note, time: stamp, created: stamp, ...(provenance ? { provenance: clone(provenance) } : {}) };
    const next = { ...loaded.snapshot, revision: loaded.snapshot.revision + 1, logs: [...(loaded.snapshot.logs || []), entry] };
    await atomicJson(loaded.stateFile, next); await mkdir(path.join(loaded.folder, 'mind_map'), { recursive: true }); await atomicJson(path.join(loaded.folder, 'mind_map', 'research.json'), next.map);
    return { before: null, after: clone(entry), revision: next.revision };
  }); }

  async updateMapNodeWithProvenance(projectId, nodeId, status, { provenance, revision } = {}) { return this._enqueue(async () => {
    const loaded = await this._load(projectId); if (revision !== undefined && revision !== loaded.snapshot.revision) throw new Error('REVISION_CONFLICT');
    const nodes = loaded.snapshot.map?.nodes || []; const node = nodes.find(item => item.id === nodeId); if (!node) throw new Error('NODE_NOT_FOUND');
    const before = clone(node); const after = { ...node, status: String(status) };
    const next = { ...loaded.snapshot, revision: loaded.snapshot.revision + 1, map: { ...loaded.snapshot.map, nodes: nodes.map(item => item.id === nodeId ? after : item) } };
    await atomicJson(loaded.stateFile, next); await mkdir(path.join(loaded.folder, 'mind_map'), { recursive: true }); await atomicJson(path.join(loaded.folder, 'mind_map', 'research.json'), next.map);
    return { before, after: clone(after), revision: next.revision };
  }); }

  async appendMapChildWithProvenance(projectId, parentId, text, { provenance, revision } = {}) { return this._enqueue(async () => {
    const loaded = await this._load(projectId); if (revision !== undefined && revision !== loaded.snapshot.revision) throw new Error('REVISION_CONFLICT');
    const nodes = loaded.snapshot.map?.nodes || []; if (!nodes.some(item => item.id === parentId)) throw new Error('PARENT_NODE_NOT_FOUND');
    if (typeof text !== 'string' || !text.trim()) throw new TypeError('text is required');
    const child = { id: `summary-${randomUUID()}`, parent: parentId, text: text.trim(), origin: 'secretary', ...(provenance ? { provenance: clone(provenance) } : {}) };
    const next = { ...loaded.snapshot, revision: loaded.snapshot.revision + 1, map: { ...loaded.snapshot.map, nodes: [...nodes, child] } };
    await atomicJson(loaded.stateFile, next); await mkdir(path.join(loaded.folder, 'mind_map'), { recursive: true }); await atomicJson(path.join(loaded.folder, 'mind_map', 'research.json'), next.map);
    return { before: null, after: clone(child), revision: next.revision };
  }); }

  async restoreMapNodeWithProvenance(projectId, nodeId, before, after, { revision } = {}) { return this._enqueue(async () => {
    const loaded = await this._load(projectId); if (revision !== undefined && revision !== loaded.snapshot.revision) throw new Error('REVISION_CONFLICT');
    const nodes = loaded.snapshot.map?.nodes || []; const index = nodes.findIndex(item => item.id === nodeId); const current = index < 0 ? null : nodes[index];
    if (JSON.stringify(current) !== JSON.stringify(after)) throw new Error('TARGET_CHANGED');
    if (before === null) {
      const hasChild = nodes.some(item => item.id !== nodeId && item.parent === nodeId);
      const hasEdge = (loaded.snapshot.map?.edges || []).some(edge => (edge.source ?? edge.from) === nodeId || (edge.target ?? edge.to) === nodeId);
      if (hasChild || hasEdge) throw new Error('TARGET_CHANGED');
    }
    const nextNodes = before === null ? nodes.filter(item => item.id !== nodeId) : nodes.map(item => item.id === nodeId ? clone(before) : item);
    const next = { ...loaded.snapshot, revision: loaded.snapshot.revision + 1, map: { ...loaded.snapshot.map, nodes: nextNodes } };
    await atomicJson(loaded.stateFile, next); await mkdir(path.join(loaded.folder, 'mind_map'), { recursive: true }); await atomicJson(path.join(loaded.folder, 'mind_map', 'research.json'), next.map);
    return { revision: next.revision };
  }); }

  async restoreLogWithProvenance(projectId, logId, after, { revision } = {}) { return this._enqueue(async () => {
    const loaded = await this._load(projectId); if (revision !== undefined && revision !== loaded.snapshot.revision) throw new Error('REVISION_CONFLICT');
    const logs = loaded.snapshot.logs || []; const index = logs.findIndex(item => item.id === logId); if (index < 0 || JSON.stringify(logs[index]) !== JSON.stringify(after)) throw new Error('TARGET_CHANGED');
    const next = { ...loaded.snapshot, revision: loaded.snapshot.revision + 1, logs: logs.filter(item => item.id !== logId) };
    await atomicJson(loaded.stateFile, next); await mkdir(path.join(loaded.folder, 'mind_map'), { recursive: true }); await atomicJson(path.join(loaded.folder, 'mind_map', 'research.json'), next.map); return { revision: next.revision };
  }); }

  async addPlanWithProvenance(projectId, { title, project, provenance } = {}) { return this._enqueue(async () => {
    if (typeof title !== 'string' || !title.trim()) throw new TypeError('title is required');
    const plans = await readJson(this.plansFile, []); const entry = { id: `summary-${randomUUID()}`, title: title.trim(), projectId, project: project || null, done: false, ...(provenance ? { provenance: clone(provenance) } : {}) };
    await atomicJson(this.plansFile, [...plans, entry]); return { before: null, after: clone(entry) };
  }); }

  async completePlanWithProvenance(projectId, planId, { provenance, expectedBefore } = {}) { return this._enqueue(async () => {
    const plans = await readJson(this.plansFile, []); const index = plans.findIndex(item => item.id === planId && (item.projectId === projectId || item.projectId == null)); if (index < 0) throw new Error('PLAN_NOT_FOUND');
    const before = clone(plans[index]); if (expectedBefore && JSON.stringify(before) !== JSON.stringify(expectedBefore)) throw new Error('TARGET_CHANGED');
    const after = { ...before, done: true, ...(provenance ? { provenance: clone(provenance) } : {}) }; plans[index] = after; await atomicJson(this.plansFile, plans); return { before, after: clone(after) };
  }); }

  async restorePlanWithProvenance(planId, before, after) { return this._enqueue(async () => {
    const plans = await readJson(this.plansFile, []); const index = plans.findIndex(item => item.id === planId); if (index < 0 || JSON.stringify(plans[index]) !== JSON.stringify(after)) throw new Error('TARGET_CHANGED');
    const next = before === null ? plans.filter(item => item.id !== planId) : plans.map((item, i) => i === index ? clone(before) : item); await atomicJson(this.plansFile, next); return clone(before);
  }); }
}
export async function createWorkbenchStore(options) { return new WorkbenchStore(options).init(); }
