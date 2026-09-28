import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { ChatStore } from '../scripts/chat-store.mjs';
import { createWorkbenchStore } from '../scripts/workbench-store.mjs';
import { createContextAccess } from '../scripts/context/registry.mjs';

const roots = [];
const handles = [];
async function fixture() {
  const base = path.resolve('.sciencescope-local', 'temp'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'context-access-')); roots.push(root);
  const chatStore = await new ChatStore({ stateDir: path.join(root, 'state') }).init();
  handles.push(chatStore);
  await chatStore.updateWorkspace({ projects: [{ id: 'p1', name: 'Alpha', desc: '' }, { id: 'p2', name: 'Beta', desc: '' }] });
  const workbench = await createWorkbenchStore({ stateDir: path.join(root, 'state'), projectsDir: path.join(root, 'projects') });
  await workbench.get('p1', 'Alpha'); await workbench.get('p2', 'Beta');
  await chatStore.ensureChat({ chatId: 'c1', projectId: 'p1', title: 'Alpha Main' });
  await chatStore.ensureChat({ chatId: 'c2', projectId: 'p2', title: 'Beta Main' });
  await chatStore.ensureChat({ chatId: 'independent', projectId: null, title: 'Independent Main' });
  await chatStore.appendMessage({ chatId: 'c1', id: 'u1', role: 'user', text: 'Alpha decision' });
  await chatStore.appendMessage({ chatId: 'c1', id: 'a1', role: 'assistant', text: 'Alpha answer' });
  await chatStore.appendMessage({ chatId: 'c1', id: 'sys1', role: 'system', text: 'tool preamble and result must not be exposed' });
  chatStore.db.db.exec(`CREATE TABLE assistant_conversations(scope TEXT NOT NULL, owner_id TEXT NOT NULL, chat_id TEXT NOT NULL UNIQUE, PRIMARY KEY(scope,owner_id));`);
  await chatStore.ensureChat({ chatId: 'aux-secretary', projectId: 'p1', title: '秘书' });
  chatStore.db.db.prepare('INSERT INTO assistant_conversations VALUES(?,?,?)').run('secretary', 'c1', 'aux-secretary');
  const records = new Map();
  const messagesAfter = (chatId, ordinal) => chatStore.db.db.prepare("SELECT ordinal,id,role,text FROM messages WHERE chat_id=? AND ordinal>=? AND role IN ('user','assistant') ORDER BY ordinal").all(chatId, ordinal).map((row) => ({ ordinal: row.ordinal + 1, id: row.id, role: row.role, text: row.text, speaker: row.role === 'user' ? 'User' : 'Main expert', files: [] }));
  const minutes = { get: (chatId) => records.get(chatId) || null, messagesAfter, format: (message) => `<message n="${message.ordinal}" speaker="${message.speaker}">\n${message.text}\n</message>`, refresh: async (chatId) => records.get(chatId) || null };
  const access = createContextAccess({ db: chatStore.db.db, chatStore, minutes, workbench });
  return { root, chatStore, workbench, minutes, records, access };
}

test.after(async () => { for (const handle of handles) handle.close(); for (const root of roots) await rm(root, { recursive: true, force: true }); });

test('context access enforces secretary scope and global drill-down', async () => {
  const { access, workbench, records } = await fixture();
  await workbench.savePlans([{ project: 'Alpha', title: 'Finish status wiring', done: false }]);
  const initial = await workbench.get('p1', 'Alpha');
  await workbench.save('p1', { revision: initial.revision, map: { nodes: [{ id: 'root', parent: null, text: 'Alpha root ' + 'x'.repeat(600), status: 'in-progress' }], edges: [] }, logs: [{ title: 'A log entry', date: 'today', text: 'Completed the baseline review', note: 'recorded' }] });
  records.set('c1', { revision: 2, throughOrdinal: 2, text: '7. To-dos\n- Finish status wiring' });
  const secretary = { role: 'secretary', mainChatId: 'c1', projectId: 'p1', chatId: 'aux-secretary' };
  const recalled = await access.call('chat_recall', { from: 1, to: 2 }, secretary);
  assert.match(recalled.messages, /Alpha decision/);
  assert.doesNotMatch(recalled.messages, /tool preamble/);
  await assert.rejects(access.call('project_memory', { section: 'log', projectId: 'p2' }, secretary), error => error.code === 'TARGET_NOT_ALLOWED');
  const global = await access.call('project_memory', { section: 'log', projectId: 'p2' }, { role: 'global', chatId: 'aux-global' });
  assert.deepEqual(global.log, []);
  const status = await access.call('project_memory', { section: 'status' }, secretary);
  assert.equal(status.pendingPlans[0].title, 'Finish status wiring');
  assert.equal(status.minutesTodos, '- Finish status wiring');
  assert.equal(status.recentLogs[0].text, 'Completed the baseline review');
  assert.equal((await access.call('project_memory', { section: 'log' }, secretary)).log[0].text, 'Completed the baseline review');
  assert.match((await access.call('project_memory', { section: 'map' }, secretary)).map, /x{500}/);
  await assert.rejects(access.call('chat_recall', { chatId: 'aux-secretary', from: 1, to: 2 }, { role: 'global' }), error => error.code === 'CHAT_NOT_FOUND');
  await assert.rejects(access.call('chat_recall', { chatId: 'does-not-exist', from: 1, to: 2 }, { role: 'global' }), error => error.code === 'CHAT_NOT_FOUND');
  await assert.rejects(access.call('project_memory', { section: 'log', projectId: 'p2', chatId: 'c1' }, { role: 'global' }), error => error.code === 'TARGET_MISMATCH');
  const workspace = await access.call('workspace_overview', {}, { role: 'global', chatId: 'aux-global' });
  assert.equal(typeof workspace.commit, 'undefined');
  assert.equal(workspace.independentChats[0].chatId, 'independent');
});

test('catch-up cursor advances only on successful completion and overview is changed-only', async () => {
  const { access, chatStore } = await fixture();
  const first = await access.catchUp({ conversationId: 'aux-secretary', chatId: 'c1' });
  assert.match(first.text, /主对话共 2 条/);
  assert.equal((await access.followUp({ conversationId: 'aux-secretary', chatId: 'c1' })).seenOrdinal, 0);
  await first.commit({ type: 'completed' });
  assert.equal((await access.followUp({ conversationId: 'aux-secretary', chatId: 'c1' })).seenOrdinal, 2);
  assert.equal((await access.catchUp({ conversationId: 'aux-secretary', chatId: 'c1' })).text, '');
  await chatStore.appendMessage({ chatId: 'c1', id: 'u2', role: 'user', text: 'new turn' });
  const pending = await access.catchUp({ conversationId: 'aux-secretary', chatId: 'c1' });
  await assert.rejects(pending.commit({ type: 'cancelled', cancelled: true }), error => error.code === 'COMMIT_NOT_ACCEPTED');
  assert.equal((await access.followUp({ conversationId: 'aux-secretary', chatId: 'c1' })).seenOrdinal, 2);
  const overview1 = await access.overview({ conversationId: 'aux-global' });
  assert.equal(overview1.changed, true); assert.match(overview1.text, /Alpha/);
  await overview1.commit({ type: 'completed' });
  const overview2 = await access.overview({ conversationId: 'aux-global' });
  assert.equal(overview2.text, ''); assert.equal(overview2.changed, false);
  await chatStore.appendMessage({ chatId: 'c1', id: 'a2', role: 'assistant', text: 'activity' });
  const overview3 = await access.overview({ conversationId: 'aux-global' });
  assert.equal(overview3.changed, true); assert.notEqual(overview3.text, '');
});

test('plans and status keep same-name projects isolated by explicit projectId', async () => {
  const { access, chatStore, workbench } = await fixture();
  await chatStore.updateWorkspace({ projects: [{ id: 'p1', name: 'Same name', desc: '' }, { id: 'p2', name: 'Same name', desc: '' }] });
  await workbench.savePlans([
    { project: 'Same name', title: 'Ambiguous legacy plan', done: false },
    { projectId: 'p1', project: 'Same name', title: 'P1 explicit plan', done: false },
    { projectId: 'p2', project: 'Same name', title: 'P2 explicit plan', done: false },
  ]);
  const p1 = { role: 'secretary', mainChatId: 'c1', projectId: 'p1' };
  const p2 = { role: 'secretary', mainChatId: 'c2', projectId: 'p2' };
  const p1Plans = await access.call('project_memory', { section: 'plans' }, p1);
  const p2Plans = await access.call('project_memory', { section: 'plans' }, p2);
  assert.deepEqual(p1Plans.plans.map((plan) => plan.title), ['P1 explicit plan']);
  assert.deepEqual(p2Plans.plans.map((plan) => plan.title), ['P2 explicit plan']);
  const p1Status = await access.call('project_memory', { section: 'status' }, p1);
  const p2Status = await access.call('project_memory', { section: 'status' }, p2);
  assert.deepEqual(p1Status.pendingPlans.map((plan) => plan.title), ['P1 explicit plan']);
  assert.deepEqual(p2Status.pendingPlans.map((plan) => plan.title), ['P2 explicit plan']);
});

test('hybrid conversation recall filters candidates by Main chat before fusion and preserves exact reads',async()=>{
  const f=await fixture();let calls=0;
  const access=createContextAccess({db:f.chatStore.db.db,chatStore:f.chatStore,minutes:f.minutes,workbench:f.workbench,
    vectorRetriever:{async search({queries,candidates}){
      calls++;assert.deepEqual(queries,['nonliteral query','不同问法']);
      assert.deepEqual(candidates.map(c=>JSON.parse(c.ref.id)[0]),['c1','c1']);
      return {rankings:queries.map(()=>[
        {ref:{type:'message',id:JSON.stringify(['aux-secretary','private'])}},
        {ref:{type:'message',id:JSON.stringify(['c2','other-project'])}},
        {ref:{type:'message',id:JSON.stringify(['c1','a1'])}}
      ])};
    }}});
  const ctx={role:'secretary',mainChatId:'c1',projectId:'p1'};
  const result=await access.call('chat_recall',{queries:['nonliteral query','不同问法']},ctx);
  assert.equal(result.mode,'hybrid');assert.equal(result.results.length,1);assert.equal(result.results[0].excerpt,'Alpha answer');
  const exact=await access.call('chat_recall',{from:1,to:2},ctx);assert.match(exact.messages,/Alpha decision/);assert.equal(calls,1);
  await assert.rejects(access.call('chat_recall',{chatId:'aux-secretary',query:'secret'},{role:'global'}),error=>error.code==='CHAT_NOT_FOUND');
  assert.equal(calls,1,'private target rejected before vector access');
});
