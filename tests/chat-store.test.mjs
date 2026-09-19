import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { ChatStore } from '../scripts/chat-store.mjs';

const ownedRoots=[];
const handles=[];
after(async()=>{for(const handle of handles)handle.close();for(const root of ownedRoots)await rm(root,{recursive:true,force:true});});
async function store() {
  const base=path.resolve('.sciencescope-local','temp');await mkdir(base,{recursive:true});
  const root = await mkdtemp(path.join(base, 'sciencescope-chat-'));ownedRoots.push(root);
  const handle=await new ChatStore({ stateDir: root }).init();handles.push(handle);return handle;
}

test('chat is absent until accepted/ensured and survives reopen with paged messages', async () => {
  const chats = await store();
  assert.deepEqual(chats.listChats(), []);
  await chats.ensureChat({ chatId: 'chat-1', projectId: null, title: 'Draft', model: { providerId: 'p', modelId: 'm' } });
  for (let i = 0; i < 61; i += 1) await chats.appendMessage({ chatId: 'chat-1', id: `m-${i}`, role: i % 2 ? 'assistant' : 'user', text: `message ${i}` });
  const latest = await chats.pageMessages('chat-1', { limit: 60 });
  assert.equal(latest.messages.length, 60);
  assert.equal(latest.messages[0].id, 'm-1');
  assert.equal(latest.hasMoreBefore, true);
  const reopened = await new ChatStore({ stateDir: chats.stateDir }).init();
  handles.push(reopened);
  assert.equal((await reopened.pageMessages('chat-1', { limit: 2 })).messages[0].id, 'm-59');
});

test('moving a bound runtime chat is rejected, preserving workspace truth', async () => {
  const chats = await store();
  await chats.ensureChat({ chatId: 'chat-2', projectId: 'p1', title: 'A' });
  await chats.markRuntimeBinding('chat-2', 'session-abc');
  await assert.rejects(chats.move('chat-2', 'p2'), /CHAT_WORKSPACE_MOVE_UNSUPPORTED/);
  assert.equal(chats.getChat('chat-2').projectId, 'p1');
  await chats.move('chat-2','p2',{allowBound:true});
  assert.equal(chats.getBinding('chat-2'),'session-abc');
});

test('workspace persistence uses the narrow presentation whitelist', async () => {
  const chats = await store();
  const value = await chats.updateWorkspace({ projects: [{ id: 'p1', name: 'Project', desc: 'Notes', archived: false, secret: 'drop' }], pins: ['chat-1'], projectExpanded: { p1: true }, lastChatId: 'chat-1', credentials: 'drop' });
  assert.deepEqual(value.projects[0], { id: 'p1', name: 'Project', desc: 'Notes', archived: false });
  assert.equal(value.credentials, undefined);
  const persisted = JSON.parse(chats.db.db.prepare("SELECT data_json FROM workspaces WHERE id='default'").get().data_json);
  assert.equal(persisted.credentials, undefined);
});

test('failed writes do not poison later mutations and before cursor is a hard boundary', async () => {
  const chats = await store();
  await assert.rejects(chats.updateWorkspace({ projects: [{ id: 'bad id', name: 'x' }] }));
  await chats.updateWorkspace({ projects: [{ id: 'p1', name: 'ok' }] });
  await chats.ensureChat({ chatId: 'chat-3', projectId: null });
  for (let i = 0; i < 4; i += 1) await chats.appendMessage({ chatId: 'chat-3', id: `x-${i}`, role: 'user', text: `${i}` });
  const page = await chats.pageMessages('chat-3', { before: '2', limit: 60 });
  assert.deepEqual(page.messages.map(message => message.id), ['x-0', 'x-1']);
});
