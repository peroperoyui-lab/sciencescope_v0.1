import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHostEvents } from '../scripts/host-events.mjs';
import { createSummaryPolicy } from '../scripts/summary-policy.mjs';
import { DEFAULT_SUMMARY } from '../scripts/secretary-preferences.mjs';

const tempRoot = join(process.cwd(), '.sciencescope-local', 'temp');
mkdirSync(tempRoot, { recursive: true });

function fixture() {
  const root = mkdtempSync(join(tempRoot, 'summary-policy-'));
  const db = new DatabaseSync(join(root, 'summary.sqlite'));
  db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT); CREATE TABLE chats(id TEXT PRIMARY KEY,project_id TEXT,deleted_at TEXT,updated TEXT); CREATE TABLE messages(chat_id TEXT,ordinal INTEGER,role TEXT,text TEXT);`);
  db.prepare('INSERT INTO projects VALUES(?,?)').run('p1', 'Project');
  const messages = new Map([['c1', []], ['c2', []]]);
  for (const id of messages.keys()) db.prepare('INSERT INTO chats VALUES(?,?,NULL,?)').run(id, 'p1', new Date().toISOString());
  const chatStore = {
    getChat(id) { return messages.has(id) ? { id, projectId: 'p1', title: id } : null; },
    listChats() { return [...messages.keys()].map((id) => ({ id, projectId: 'p1', updated: id })); },
  };
  const minutesState = new Map();
  const minutes = {
    get(id) { const row = minutesState.get(id); return row ? { ...row } : null; },
    messagesAfter(id, through = 0) { return (messages.get(id) || []).filter((message) => message.ordinal > through); },
    async refresh(id) { const all = messages.get(id) || []; const prior = minutesState.get(id); const next = { revision: (prior?.revision || 0) + 1, throughOrdinal: all.at(-1)?.ordinal || 0, author: 'secretary', text: 'summary' }; minutesState.set(id, next); return next; },
  };
  const events = createHostEvents();
  let preferences = { summary: JSON.parse(JSON.stringify(DEFAULT_SUMMARY)) };
  const diagnostics = [];
  const policy = createSummaryPolicy({ db, events, minutes, chatStore, getPreferences: () => preferences, onDiagnostic: (item) => diagnostics.push(item), pendingDelayMs: 10 });
  return { root, db, events, policy, messages, minutes, diagnostics, setPreferences(value) { preferences = { summary: { ...JSON.parse(JSON.stringify(DEFAULT_SUMMARY)), ...value } }; }, close: async () => { await policy.close(); await events.close(); db.close(); rmSync(root, { recursive: true, force: true }); } };
}

function append(fixture, chatId, role = 'user', text = 'message') {
  const list = fixture.messages.get(chatId);
  const ordinal = list.length + 1;
  list.push({ ordinal, role, text });
  fixture.db.prepare('INSERT INTO messages VALUES(?,?,?,?)').run(chatId, ordinal - 1, role, text);
}

async function waitFor(predicate, timeout = 2500) {
  const started = Date.now();
  while (!predicate() && Date.now() - started < timeout) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.ok(predicate(), 'condition did not become true');
}

test('message and token thresholds trigger once, status exposes remaining budgets, and empty content is skipped', async () => {
  const f = fixture();
  let calls = 0;
  const original = f.minutes.refresh;
  f.minutes.refresh = async (...args) => { calls += 1; return original.apply(f.minutes, args); };
  try {
    for (let i = 0; i < 19; i += 1) append(f, 'c1', i % 2 ? 'assistant' : 'user', `m${i}`);
    await f.events.emit('chat.turn.persisted', { chatId: 'c1' });
    assert.equal(calls, 0);
    const before = await f.policy.status('c1');
    assert.equal(before.messagesRemaining, 1);
    append(f, 'c1', 'assistant', 'm19');
    await f.events.emit('chat.turn.persisted', { chatId: 'c1' });
    await waitFor(() => calls === 1);
    await f.events.emit('chat.turn.persisted', { chatId: 'c1' });
    assert.equal(calls, 1);
    f.setPreferences({ everyMessages: { enabled: false, n: 20 }, everyTokens: { enabled: true, n: 2000 } });
    append(f, 'c1', 'user', 'x'.repeat(8000));
    await f.events.emit('chat.turn.persisted', { chatId: 'c1' });
    await waitFor(() => calls === 2);
    assert.ok(f.diagnostics.some((item) => item.type === 'summary-trigger' && item.reason === 'turn'));
  } finally { await f.close(); }
});

test('discussion and project focus process only dirty chats sequentially; shutdown persists pending work', async () => {
  const f = fixture();
  const order = [];
  const original = f.minutes.refresh;
  f.minutes.refresh = async (id) => { order.push(id); return original(id); };
  try {
    append(f, 'c1', 'user', 'one'); append(f, 'c1', 'assistant', 'answer');
    await f.events.emit('discussion.finished', { chatId: 'c1' });
    await waitFor(() => order.includes('c1'));
    assert.deepEqual(order, ['c1']);
    append(f, 'c2', 'user', 'two'); append(f, 'c2', 'assistant', 'answer');
    await f.policy.focus('p1');
    await waitFor(() => order.includes('c2'));
    assert.deepEqual(order.slice(-1), ['c2']);
    await f.policy.shutdown('p1');
    assert.equal(f.db.prepare('SELECT reason FROM summary_pending WHERE project_id=?').get('p1').reason, 'shutdown');
    await f.events.emit('app.started');
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM summary_pending').get().n, 0);
  } finally { await f.close(); }
});

test('disabled rules do not call the model and close prevents later event work', async () => {
  const f = fixture();
  try {
    f.setPreferences({ afterDiscussion: false, everyMessages: { enabled: false, n: 20 }, everyTokens: { enabled: false, n: 30000 }, onEnterProject: false, onLeaveProject: false });
    append(f, 'c1', 'user', 'one'); append(f, 'c1', 'assistant', 'answer');
    let calls = 0; f.minutes.refresh = async () => { calls += 1; };
    await f.events.emit('discussion.finished', { chatId: 'c1' });
    assert.equal(calls, 0);
    await f.events.emit('chat.turn.persisted', { chatId: 'c1' });
    await f.events.emit('project.entered', { projectId: 'p1' });
    await f.events.emit('project.left', { projectId: 'p1' });
    assert.equal(await f.policy.shutdown('p1'),false);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM summary_pending').get().n,0);
    f.db.prepare('INSERT INTO summary_pending VALUES(?,?,?)').run('p1','shutdown',new Date().toISOString());
    await f.events.emit('app.started');
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(calls,0,'turn, navigation, shutdown and a pre-existing pending item honor disabled rules');
    await f.policy.close();
    append(f, 'c1', 'user', 'after close');
    await f.events.emit('chat.turn.persisted', { chatId: 'c1' });
    assert.equal(calls, 0);
  } finally { await f.events.close(); f.db.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('threshold and discussion notifications reuse the minutes debounce',async()=>{
  const f=fixture();let timer,calls=0,schedules=0;
  const original=f.minutes.refresh;
  f.minutes.schedule=id=>{schedules++;clearTimeout(timer);timer=setTimeout(()=>{calls++;void original(id);},20);};
  try{
    for(let index=0;index<20;index++)append(f,'c1',index%2?'assistant':'user');
    await f.events.emit('chat.turn.persisted',{chatId:'c1'});
    await f.events.emit('discussion.finished',{chatId:'c1'});
    assert.equal(calls,0);assert.equal(schedules,2);
    await waitFor(()=>calls===1);
    await f.events.emit('chat.turn.persisted',{chatId:'c1'});
    assert.equal(schedules,2,'covered messages do not schedule again');
  }finally{clearTimeout(timer);await f.close();}
});
