import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createWorkbenchStore } from '../scripts/workbench-store.mjs';

const roots = [];
after(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); });
async function makeStore() {
  const base = path.resolve('.sciencescope-local', 'temp'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'workbench-')); roots.push(root);
  return { root, store: await createWorkbenchStore({ stateDir: path.join(root, 'state'), projectsDir: path.join(root, 'projects') }) };
}

test('default project snapshot survives reopen and map persistence', async () => {
  const { store } = await makeStore(); const first = await store.get('p/1', '我的框架');
  assert.equal(first.map.nodes[0].text, '我的框架'); assert.equal(first.revision, 0);
  const saved = await store.save('p/1', { revision: 0, map: { nodes: [{ id: 'n1' }], edges: [], images: ['x'] }, logs: [{ text: 'log' }], autoOrganize: true });
  assert.equal(saved.revision, 1);
  const reopened = await createWorkbenchStore({ stateDir: store.stateDir, projectsDir: store.projectsDir });
  assert.deepEqual((await reopened.get('p/1')).map.images, ['x']);
  assert.deepEqual(JSON.parse(await readFile(path.join(store.projectsDir, 'project-p%2F1', 'mind_map', 'research.json'))), saved.map);
});

test('binding and file listing report immediate real files and skip links', async () => {
  const { store, root } = await makeStore(); const folder = path.join(root, 'bound'); await mkdir(folder); await writeFile(path.join(folder, 'paper.pdf'), 'abc'); await mkdir(path.join(folder, 'nested')); await writeFile(path.join(folder, 'nested', 'x.txt'), 'x');
  await store.bind('bound', folder); const files = await store.listFiles('bound');
  assert.deepEqual(files.map(file => file.name).sort(), ['nested', 'paper.pdf']); assert.equal(files.find(file => file.name === 'paper.pdf').extension, '.pdf');
});

test('imports original bytes, stores assets and enforces path constraints', async () => {
  const { store } = await makeStore(); await store.get('p');
  const version = await store.importFile('p', { name: 'paper.pdf', base64: Buffer.from('bytes').toString('base64'), group: 'A' });
  assert.equal(await readFile(path.join(store.projectsDir, 'project-p', version.relativePath), 'utf8'), 'bytes');
  const asset = await store.addAsset('p', { name: 'figure.png', base64: Buffer.from('img').toString('base64') }); assert.equal(asset.path, 'mind_map/assets/figure.png');
  await assert.rejects(store.resolvePath?.bind(store, 'p', '../outside') ?? store._resolve('p', '../outside'), /escapes|Invalid/);
  await assert.rejects(store._resolve('p', path.isAbsolute(path.parse(process.cwd()).root) ? path.parse(process.cwd()).root : '/tmp'), /Invalid relative/);
});

test('asset collisions are unique and versions increment within a group', async () => {
  const { store } = await makeStore(); await store.get('collision');
  const data = Buffer.from('x').toString('base64');
  const first = await store.addAsset('collision', { name: 'figure.png', base64: data });
  const second = await store.addAsset('collision', { name: 'figure.png', base64: data });
  assert.equal(first.path, 'mind_map/assets/figure.png');
  assert.notEqual(second.path, first.path);
  const v1 = await store.importFile('collision', { name: 'draft.pdf', base64: data, group: 'draft' });
  const v2 = await store.importFile('collision', { name: 'draft-2.pdf', base64: data, group: 'draft' });
  assert.equal(v1.number, 1); assert.equal(v2.number, 2);
});

test('research map is reconciled from the durable map file', async () => {
  const { store } = await makeStore(); const first = await store.get('map-sync', '同步项目');
  const mapFile = path.join(store.projectsDir, 'project-map-sync', 'mind_map', 'research.json');
  const changed = { nodes: [{ id: 'root', parent: null, type: 'main' }, { id: 'n2', parent: 'root', text: '外部修改' }], edges: [{ source: 'root', target: 'n2' }] };
  await writeFile(mapFile, JSON.stringify(changed));
  const next = await store.get('map-sync', '同步项目');
  assert.equal(next.revision, first.revision + 1); assert.deepEqual(next.map, changed);
  const invalidBytes = Buffer.from('{"nodes":[{"id":"a","parent":"b"}],"edges":[]}'); await writeFile(mapFile, invalidBytes);
  await assert.rejects(store.get('map-sync', '同步项目'), error => error.code === 'INVALID_MAP');
  await assert.rejects(store.save('map-sync', { revision: next.revision, map: changed }), error => error.code === 'INVALID_MAP');
  assert.deepEqual(await readFile(mapFile), invalidBytes);
});
