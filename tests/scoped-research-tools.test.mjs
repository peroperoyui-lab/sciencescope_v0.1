import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { openApplicationDatabaseSync } from '../scripts/application-database.mjs';
import { createResearchBase } from '../scripts/research-base/index.mjs';
import { createScopedResearchTools } from '../scripts/context/research-tools.mjs';

const roots = [];
async function fixture() {
  const base = path.resolve('.sciencescope-local', 'temp'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'scoped-research-tools-')); roots.push(root);
  const database = openApplicationDatabaseSync({ stateDir: root });
  const research = createResearchBase({ database, resolveResourcePath: async () => null });
  const secret = research.store.createItem({ id: 'secret-item', type: 'memory', subtype: 'preference', projectId: 'p1', scope: 'project', visibility: 'private', title: 'Hidden item', body: 'not for agents' });
  const p2 = research.store.createItem({ id: 'p2-item', type: 'memory', subtype: 'goal', projectId: 'p2', scope: 'project', title: 'P2 item', body: 'project two' });
  const personal = research.store.createItem({ id: 'personal-item', type: 'memory', subtype: 'preference', scope: 'personal', title: 'Personal item', body: 'shared personal' });
  const indexedP1 = research.store.createItem({ id: 'indexed-p1', type: 'memory', subtype: 'goal', projectId: 'p1', scope: 'project', title: 'Indexed P1', body: 'T17_GLOBAL_INDEX_MARKER project one' });
  const indexedP2 = research.store.createItem({ id: 'indexed-p2', type: 'memory', subtype: 'goal', projectId: 'p2', scope: 'project', title: 'Indexed P2', body: 'T17_GLOBAL_INDEX_MARKER project two' });
  const indexedPrivate = research.store.createItem({ id: 'indexed-private', type: 'memory', subtype: 'preference', projectId: 'p2', scope: 'project', visibility: 'private', title: 'Indexed hidden', body: 'T17_GLOBAL_INDEX_MARKER hidden' });
  const indexedPersonal = research.store.createItem({ id: 'indexed-personal', type: 'memory', subtype: 'preference', scope: 'personal', title: 'Indexed personal', body: 'T17_PERSONAL_INDEX_MARKER' });
  const publicLinked = research.store.createItem({ type: 'memory', subtype: 'goal', projectId: 'p1', scope: 'project', title: 'Public linked item', body: 'PUBLIC_READ_SENTINEL' });
  const linkedPrivate = research.store.createItem({ type: 'memory', subtype: 'preference', projectId: 'p1', scope: 'project', visibility: 'private', title: 'Linked hidden item', body: 'PRIVATE_LINK_SENTINEL' });
  research.store.link({ from: { type: 'item', id: publicLinked.id }, to: { type: 'item', id: linkedPrivate.id }, relation: 'about', quote: 'PRIVATE_LINK_SENTINEL' });
  research.store.addSource({ id: 'p1-source', projectId: 'p1', kind: 'paper', title: 'Project one source' });
  research.store.addSource({ id: 'p2-source', projectId: 'p2', kind: 'paper', title: 'Project two source' });
  const calls = [];
  const searchCalls = [];
  const retrieval = { ...research.retrieval, searchHybrid: async (input = {}) => {
    searchCalls.push(input);
    return {mode:'hybrid',hits:[indexedP1,indexedP2,personal].map((item,index)=>({ref:{type:'item',id:item.id},item,cite:'[@test]',snippet:item.body,score:1/(index+1)}))};
  } };
  const fakeResearch = { ...research, toolCall: async (name, args, context) => {
    calls.push({ name, args, context });
    return { ok: true };
  }, retrieval };
  const scoped = createScopedResearchTools({ research: fakeResearch, projectIds: async () => ['p1', 'p2'] });
  const realScoped = createScopedResearchTools({ research, projectIds: async () => ['p1', 'p2'] });
  return { database, research, scoped, realScoped, calls, searchCalls, secret, p2, personal, indexedP1, indexedP2, indexedPrivate, indexedPersonal, publicLinked, linkedPrivate, close: () => database.close() };
}

test.after(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); });

test('research read rejects private and cross-project references before reaching the runtime', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.scoped('research_read', { ref: { type: 'item', id: f.secret.id } }, { role: 'main', projectId: 'p1' }), error => error.code === 'REFERENCE_NOT_FOUND');
    await assert.rejects(f.scoped('research_read', { ref: { type: 'item', id: f.p2.id } }, { role: 'main', projectId: 'p1' }), error => error.code === 'REFERENCE_OUT_OF_SCOPE');
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});

test('global search supplies all authorized scopes to one hybrid phase and retains source project identity', async () => {
  const f = await fixture();
  try {
    const result = await f.scoped('research_search', { query: 'anything', limit: 20 }, { role: 'global' });
    assert.equal(f.searchCalls.length,1);
    assert.deepEqual(f.searchCalls[0].projectIds,['p1','p2']);
    assert.equal(f.searchCalls[0].includePersonal,true);
    assert.equal(new Set(result.hits.map(hit => JSON.stringify(hit.ref))).size, result.hits.length);
    assert.equal(result.hits[0].ref.id, f.indexedP1.id);
    assert.equal(result.hits[0].projectId, 'p1', 'the canonical record determines project identity');
    assert.equal(result.mode,'hybrid');
  } finally { f.close(); }
});

test('global real retrieval search reaches multiple project indexes and excludes private items', async () => {
  const f = await fixture();
  try {
    const result = await f.realScoped('research_search', { query: 'T17_GLOBAL_INDEX_MARKER', limit: 20 }, { role: 'global' });
    const ids = result.hits.map((hit) => hit.ref.id);
    assert.ok(ids.includes(f.indexedP1.id));
    assert.ok(ids.includes(f.indexedP2.id));
    assert.ok(!ids.includes(f.indexedPrivate.id));
  } finally { f.close(); }
});

test('global personal hits retain canonical null project scope', async () => {
  const f = await fixture();
  try {
    const result = await f.realScoped('research_search', { query: 'T17_PERSONAL_INDEX_MARKER', limit: 20 }, { role: 'global' });
    const hit = result.hits.find((entry) => entry.ref.id === f.indexedPersonal.id);
    assert.ok(hit, 'personal item should be returned by the global fan-out');
    assert.equal(hit.projectId, null);
    assert.equal(result.hits.filter((entry) => entry.ref.id === f.indexedPersonal.id).length, 1);
  } finally { f.close(); }
});

test('research_read does not expose private linked-item metadata from a public item', async () => {
  const f = await fixture();
  try {
    const raw = await f.research.toolCall('research_read', { ref: { type: 'item', id: f.publicLinked.id } }, { role: 'main', projectId: 'p1' });
    assert.equal(raw.links.length, 1, 'the underlying Research Base read contains the linked reference before scoped filtering');
    assert.match(JSON.stringify(raw), /PRIVATE_LINK_SENTINEL/);
    const result = await f.realScoped('research_read', { ref: { type: 'item', id: f.publicLinked.id } }, { role: 'main', projectId: 'p1' });
    assert.match(result.body, /PUBLIC_READ_SENTINEL/);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(`PRIVATE_LINK_SENTINEL|${f.linkedPrivate.id}`));
    assert.equal(result.links.length, 0);
  } finally { f.close(); }
});

test('global citation labels are rejected when the same S label exists in multiple projects', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.scoped('research_read', { cite: '[S1]' }, { role: 'global' }), error => error.code === 'AMBIGUOUS_CITATION');
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});
