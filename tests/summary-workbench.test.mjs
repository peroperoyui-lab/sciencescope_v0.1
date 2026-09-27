import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { openApplicationDatabaseSync } from '../scripts/application-database.mjs';
import { createWorkbenchStore } from '../scripts/workbench-store.mjs';
import { createSummaryWorkbench } from '../scripts/summary-workbench.mjs';

const roots = [];
const databases = [];
after(async () => { for (const database of databases) database.close(); for (const root of roots) await rm(root, { recursive: true, force: true }); });

async function fixture(modes = { map: 'apply', versions: 'off', plans: 'off', log: 'off' }, answer = { map: [{ op: 'status', nodeId: 'root', status: 'done' }] }, hostOptions = {}) {
  const base = path.resolve('.sciencescope-local', 'temp'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'summary-workbench-')); roots.push(root);
  await mkdir(path.join(root, 'state'), { recursive: true });
  const database = openApplicationDatabaseSync({ stateDir: path.join(root, 'state') });
  databases.push(database);
  const workbench = await createWorkbenchStore({ stateDir: path.join(root, 'state-files'), projectsDir: path.join(root, 'projects') });
  await workbench.get('project-1', '测试项目');
  let calls = 0;
  const host = { async startSession(options) { assert.equal(options.noTools, true); return 'session-summary'; }, async send(options) { calls++; return hostOptions.send ? hostOptions.send(options, answer) : { finalResponse: JSON.stringify(answer) }; }, async releaseSession() {}, async interrupt() { hostOptions.interrupt?.(); } };
  const service = createSummaryWorkbench({ db: database.db, host, workbench, chatStore: { getChat: () => ({ id: 'chat-1', projectId: 'project-1', projectName: '测试项目' }) }, getPreferences: async () => ({ summary: { workbench: modes } }), modelFor: async () => ({ providerId: 'fixture', modelId: 'fixture' }) });
  return { root, database, workbench, service, get calls() { return calls; } };
}

test('all targets off performs no model call', async () => {
  const f = await fixture({ map: 'off', versions: 'off', plans: 'off', log: 'off' });
  const result = await f.service.onMinutesUpdated({ chatId: 'chat-1', minutes: { revision: 1 } });
  assert.deepEqual(result, { proposals: [], writes: [] }); assert.equal(f.calls, 0);
});

test('apply only changes allowed map status and records an undoable write', async () => {
  const f = await fixture();
  const result = await f.service.onMinutesUpdated({ chatId: 'chat-1', previous: { revision: 1, text: 'old' }, minutes: { revision: 2, text: 'new' } });
  assert.equal(result.writes.length, 1); const snapshot = await f.workbench.get('project-1'); assert.equal(snapshot.map.nodes[0].status, 'done');
  const writes = f.service.listWrites('chat-1'); assert.equal(writes[0].minutesRevision, 2); await f.service.undo({ id: writes[0].id }); assert.equal((await f.workbench.get('project-1')).map.nodes[0].status, undefined);
});

test('propose does not mutate workbench and acceptance emits a write', async () => {
  const f = await fixture({ map: 'propose', versions: 'off', plans: 'off', log: 'off' });
  const result = await f.service.onMinutesUpdated({ chatId: 'chat-1', minutes: { revision: 4, text: 'new' } }); assert.equal(result.proposals.length, 1); assert.equal(f.calls, 1); assert.equal((await f.workbench.get('project-1')).map.nodes[0].status, undefined);
  const proposal = f.service.listProposals('chat-1')[0]; const accepted = await f.service.decide({ id: proposal.id, accept: true }); assert.equal(accepted.status, 'accepted'); assert.equal((await f.workbench.get('project-1')).map.nodes[0].status, 'done');
});

test('plan proposal prompt includes the source todo and unconfirmed mode without executing it', async () => {
  const todo = '核对缺失数据处理方案并记录敏感性分析';
  const inputs = [];
  const f = await fixture({ map: 'off', versions: 'off', plans: 'propose', log: 'off' }, { plans: [{ op: 'add', title: todo }] }, {
    send: async ({ text }, answer) => { inputs.push(text); return { finalResponse: JSON.stringify(answer) }; },
  });
  const before = await f.workbench.get('project-1');
  const result = await f.service.onMinutesUpdated({ chatId: 'chat-1', previous: { revision: 5, text: '尚未确定下一步工作。' }, minutes: { revision: 6, text: `## 待办\n- ${todo}（待完成）` } });

  assert.equal(inputs.length, 1);
  assert.match(inputs[0], /"plans":"propose"/);
  assert.match(inputs[0], /'propose' means an unconfirmed draft/);
  assert.match(inputs[0], /does NOT claim that the user approved it or that the research was performed/);
  assert.ok(inputs[0].includes(todo), 'the actual model input retains the concrete source todo');
  assert.equal(result.proposals.length, 1);
  assert.deepEqual(result.writes, []);
  const [proposal] = f.service.listProposals('chat-1');
  assert.equal(proposal.status, 'pending');
  assert.equal(proposal.target, 'plans');
  assert.equal(proposal.minutesRevision, 6);
  assert.deepEqual(proposal.op, { op: 'add', title: todo });
  assert.deepEqual(f.service.listWrites('chat-1'), []);
  assert.deepEqual(await f.workbench.getPlans(), [], 'a draft proposal creates no executable plan');
  assert.deepEqual(await f.workbench.get('project-1'), before);
});

test('accepts the explicit operations envelope and drops unknown fields', async () => {
  const f = await fixture({ map: 'apply', versions: 'off', plans: 'off', log: 'off' }, { operations: [{ target: 'map', op: 'status', nodeId: 'root', status: 'done' }, { target: 'map', op: 'status', nodeId: 'root', status: 'blocked', extra: true }] });
  const original = f.service;
  // The fixture service already validates the envelope; the unknown operation
  // is intentionally ignored rather than retried or written.
  const result = await original.onMinutesUpdated({ chatId: 'chat-1', minutes: { revision: 5 } });
  assert.equal(result.writes.length, 1); assert.equal((await f.workbench.get('project-1')).map.nodes[0].status, 'done');
});

test('undo returns 409-style error after target was changed', async () => {
  const f = await fixture(); await f.service.onMinutesUpdated({ chatId: 'chat-1', minutes: { revision: 1 } }); const write = f.service.listWrites('chat-1')[0];
  const state = await f.workbench.get('project-1'); await f.workbench.save('project-1', { revision: state.revision, map: { ...state.map, nodes: [{ ...state.map.nodes[0], status: 'user-edited' }] } });
  await assert.rejects(f.service.undo({ id: write.id }), (error) => error.code === 'TARGET_CHANGED' && error.status === 409);
});

test('out-of-scope operation names are dropped, never reinterpreted as allowed writes',async()=>{
  const f=await fixture({map:'apply',plans:'apply',log:'apply',versions:'off'}, {
    map:[{op:'delete',nodeId:'root',status:'done'},{op:'replace',parentId:'root',text:'replacement'}],
    plans:[{op:'delete',title:'unexpected new plan'}],log:[{op:'replace',title:'new',note:'not an append'}],
  });
  const before=await f.workbench.get('project-1');
  const result=await f.service.onMinutesUpdated({chatId:'chat-1',minutes:{revision:1}});
  assert.deepEqual(result,{proposals:[],writes:[]});assert.deepEqual(await f.workbench.get('project-1'),before);assert.deepEqual(await f.workbench.getPlans(),[]);
});

test('workbench revision conflicts retry once, then abort without a write receipt',async()=>{
  const f=await fixture();const original=f.workbench.updateMapNodeWithProvenance.bind(f.workbench);let calls=0;
  f.workbench.updateMapNodeWithProvenance=(...args)=>{if(++calls===1)throw new Error('REVISION_CONFLICT');return original(...args);};
  const result=await f.service.onMinutesUpdated({chatId:'chat-1',minutes:{revision:1}});
  assert.equal(calls,2);assert.equal(result.writes.length,1);
  const blocked=await fixture();let rejected=0;
  blocked.workbench.updateMapNodeWithProvenance=()=>{rejected++;throw new Error('REVISION_CONFLICT');};
  const failure=await blocked.service.onMinutesUpdated({chatId:'chat-1',minutes:{revision:1}});
  assert.equal(rejected,2);assert.equal(failure.writes.length,0);assert.equal(blocked.service.listWrites('chat-1').length,0);
  assert.equal((await blocked.workbench.get('project-1')).map.nodes[0].status,undefined);
});

test('independent chats and invalid JSON never call or write the workbench', async () => {
  const off = await fixture({ map: 'off', versions: 'off', plans: 'off', log: 'off' });
  await off.service.onMinutesUpdated({ chatId: 'chat-1', chat: { id: 'chat-1', projectId: null }, minutes: { revision: 1 } }); assert.equal(off.calls, 0);
  const invalid = await fixture({ map: 'apply', versions: 'off', plans: 'off', log: 'off' }, {}, { send: async () => ({ finalResponse: 'not-json' }) });
  const result = await invalid.service.onMinutesUpdated({ chatId: 'chat-1', minutes: { revision: 1 } }); assert.equal(result.writes.length, 0); assert.equal(invalid.service.listWrites('chat-1').length, 0);
});

test('undoing a secretary child is blocked after a user adds an edge or child', async () => {
  const f = await fixture({ map: 'apply', versions: 'off', plans: 'off', log: 'off' }, { map: [{ op: 'add_child', parentId: 'root', text: '秘书子节点' }] });
  await f.service.onMinutesUpdated({ chatId: 'chat-1', minutes: { revision: 1 } }); const write = f.service.listWrites('chat-1')[0]; const state = await f.workbench.get('project-1');
  await f.workbench.save('project-1', { revision: state.revision, map: { ...state.map, nodes: [...state.map.nodes, { id: 'user-child', parent: write.after.id, text: '用户子节点' }] } });
  await assert.rejects(f.service.undo({ id: write.id }), (error) => error.code === 'TARGET_CHANGED' && error.status === 409);
});

test('accepting one proposal twice is serialized and creates one write', async () => {
  const f = await fixture({ map: 'propose', versions: 'off', plans: 'off', log: 'off' }); await f.service.onMinutesUpdated({ chatId: 'chat-1', minutes: { revision: 1 } }); const id = f.service.listProposals('chat-1')[0].id;
  const results = await Promise.allSettled([f.service.decide({ id, accept: true }), f.service.decide({ id, accept: true })]); assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1); assert.equal(f.service.listWrites('chat-1').length, 1);
});

test('close interrupts a running summary before it can write', async () => {
  let unblock; const gate = new Promise((resolve) => { unblock = resolve; });
  let started;const ready=new Promise(resolve=>started=resolve);let interrupted=0;
  const f = await fixture({ map: 'apply', versions: 'off', plans: 'off', log: 'off' }, { map: [{ op: 'status', nodeId: 'root', status: 'done' }] }, { send: async () => {started();return gate;}, interrupt: () => {interrupted++;unblock({ finalResponse: JSON.stringify({ map: [{op:'status',nodeId:'root',status:'done'}] }) });} });
  const running = f.service.onMinutesUpdated({ chatId: 'chat-1', minutes: { revision: 1 } });await ready;await f.service.close();const result=await running;
  assert.equal(interrupted,1);assert.equal(result.writes.length,0);assert.equal(f.service.listWrites('chat-1').length,0);
});

test('versions use a guarded organizer and undo metadata without deleting its note artifact', async () => {
  const base = path.resolve('.sciencescope-local', 'temp'); await mkdir(base, { recursive: true }); const root = await mkdtemp(path.join(base, 'summary-version-')); roots.push(root); await mkdir(path.join(root, 'state'), { recursive: true });
  const database = openApplicationDatabaseSync({ stateDir: path.join(root, 'state') }); databases.push(database); const workbench = await createWorkbenchStore({ stateDir: path.join(root, 'files'), projectsDir: path.join(root, 'projects') }); await workbench.get('project-1', '测试项目'); const version = await workbench.importFile('project-1', { name: 'paper.txt', base64: Buffer.from('original').toString('base64') });
  const service = createSummaryWorkbench({ db: database.db, workbench, host: { async startSession() { return 'version-session'; }, async send({ text }) { return { finalResponse: text.includes('项目文件秘书') ? '整理结果' : JSON.stringify({ versions: [{ versionId: version.id }] }) }; }, async releaseSession() {} }, chatStore: { getChat: () => ({ id: 'chat-v', projectId: 'project-1', projectName: '测试项目' }) }, getPreferences: async () => ({ summary: { workbench: { map: 'off', versions: 'apply', plans: 'off', log: 'off' } } }), modelFor: async () => ({ providerId: 'fixture', modelId: 'fixture' }) });
  const result = await service.onMinutesUpdated({ chatId: 'chat-v', minutes: { revision: 2 }, chat: { id: 'chat-v', projectId: 'project-1', projectName: '测试项目' } }); assert.equal(result.writes.length, 1);
  const written = await workbench.get('project-1'); const organized = written.versions.find((item) => item.id === version.id); assert.equal(organized.status, 'organized'); const notePath = await workbench.resolvePath('project-1', organized.note); assert.match(await readFile(notePath, 'utf8'), /整理结果/); await service.undo({ id: result.writes[0].id }); const undone = (await workbench.get('project-1')).versions.find((item) => item.id === version.id); assert.equal(undone.note, undefined); assert.equal(undone.status, 'stored'); assert.match(await readFile(notePath, 'utf8'), /整理结果/);
});

test('version organizer cannot overwrite a user edit made while the model runs', async () => {
  const base = path.resolve('.sciencescope-local', 'temp'); await mkdir(base, { recursive: true }); const root = await mkdtemp(path.join(base, 'summary-version-guard-')); roots.push(root); await mkdir(path.join(root, 'state'), { recursive: true });
  const database = openApplicationDatabaseSync({ stateDir: path.join(root, 'state') }); databases.push(database); const workbench = await createWorkbenchStore({ stateDir: path.join(root, 'files'), projectsDir: path.join(root, 'projects') }); await workbench.get('project-1', '测试项目'); const version = await workbench.importFile('project-1', { name: 'paper.txt', base64: Buffer.from('original').toString('base64') });
  let organizeCalls=0;
  const service = createSummaryWorkbench({ db: database.db, workbench, host: { async startSession() { return 'version-guard-session'; }, async send({text}) {
    if(!text.includes('项目文件秘书'))return {finalResponse:JSON.stringify({versions:[{op:'organize',versionId:version.id}]})};
    organizeCalls++;await workbench.updateVersion('project-1',version.id,{status:'organized',note:'user-notes.md',summary:'User authored'});return {finalResponse:'不应写入'};
  }, async releaseSession() {} }, chatStore: { getChat: () => ({ id: 'chat-vg', projectId: 'project-1', projectName: '测试项目' }) }, getPreferences: async () => ({ summary: { workbench: { map: 'off', versions: 'apply', plans: 'off', log: 'off' } } }), modelFor: async () => ({ providerId: 'fixture', modelId: 'fixture' }) });
  const result = await service.onMinutesUpdated({ chatId: 'chat-vg', minutes: { revision: 2 }, chat: { id: 'chat-vg', projectId: 'project-1', projectName: '测试项目' } });
  assert.equal(organizeCalls,1,'fault must occur during actual version organization, not JSON preflight');
  assert.equal(result.writes.length,0);const saved=(await workbench.get('project-1')).versions.find(item=>item.id===version.id);
  assert.equal(saved.note,'user-notes.md');assert.equal(saved.summary,'User authored');
});
