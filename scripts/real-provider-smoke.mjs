// Explicit opt-in against the running desktop host. Never part of npm test.
import assert from 'node:assert/strict';
import { realpath, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let origin;
try { origin = new URL(process.argv[2] || ''); } catch { throw new Error('INVALID_HOST'); }
const projectId = process.argv[3];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await realpath(path.join(repoRoot, '.sciencescope-local', 'temp'));
if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1') throw new Error('INVALID_HOST');
if (typeof projectId !== 'string' || !projectId.trim()) throw new Error('PROJECT_ID_REQUIRED');
const request = async (route, body) => {
  const response = await fetch(new URL(`/api/${route}`, origin), { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error(`APPLICATION_HTTP_${response.status}`);
  return response;
};
const contained = (candidate, root) => candidate === root || candidate.startsWith(`${root}${path.sep}`);
let chatId; let fixture; let fixtureCreated = false;
try {
  const workbench = await (await request(`workbench?projectId=${encodeURIComponent(projectId)}`)).json();
  assert.equal(typeof workbench.folder, 'string', 'WORKBENCH_FOLDER_MISSING');
  const folder = await realpath(workbench.folder);
  assert.ok(contained(folder, tempRoot), 'WORKBENCH_FOLDER_OUTSIDE_TEMP');
  fixture = path.join(folder, `real-provider-smoke-${Date.now()}.txt`);
  assert.ok(contained(fixture, folder), 'FIXTURE_PATH_OUTSIDE_PROJECT');
  await writeFile(fixture, 'SCIENCESCOPE_COMMUNICATION_OK\n', { flag: 'wx' });
  fixtureCreated = true;
  const { providers } = await (await request('providers')).json();
  const provider = providers.find(p => p.name === 'OpenCode Go' && p.configured);
  assert.ok(provider, 'PROVIDER_NOT_CONFIGURED');
  const modelId = provider.models.find(id => id === 'deepseek-v4.1-flash');
  assert.ok(modelId, 'MODEL_NOT_CONFIGURED');
  chatId = `agent-acceptance-${Date.now()}`;
  const response = await request('chat', { chatId, projectId, model: { providerId: provider.id, modelId }, executionMode: 'ask', title: '客户端工具连通验收', text: `Use a filesystem read tool to read only ${path.basename(fixture)} in your current working directory. Do not modify any file or read anything else. Reply with the exact sentinel found in that file.` });
  const events = (await response.text()).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert.ok(!events.some(event => event.type === 'failed'), 'RUNTIME_FAILED');
  const completed = events.some(event => event.type === 'completed');
  const text = events.filter(event => event.type === 'text-delta').map(event => event.delta).join('');
  const calls = events.filter(event => event.type === 'tool-call');
  const results = events.filter(event => event.type === 'tool-result');
  assert.ok(completed, 'STREAM_NOT_COMPLETED');
  assert.ok(text.includes('SCIENCESCOPE_COMMUNICATION_OK'), 'SENTINEL_MISSING');
  assert.ok(calls.length > 0, 'FILESYSTEM_TOOL_NOT_CALLED');
  assert.ok(calls.every(call => typeof call.name === 'string' && /read/i.test(call.name)), 'NON_READ_TOOL_CALL');
  assert.ok(calls.every(call => String(call.argumentsPreview || '').includes(path.basename(fixture))), 'TOOL_READ_TARGET_MISMATCH');
  assert.ok(calls.every(call => results.some(result => result.callId === call.callId && !result.isError)), 'TOOL_RESULT_FAILED');
  assert.ok(results.every(result => calls.some(call => call.callId === result.callId)), 'UNEXPECTED_TOOL_RESULT');
  const listed = await (await request(`chats?projectId=${encodeURIComponent(projectId)}`)).json();
  assert.ok(listed.chats?.some(chat => chat.id === chatId && chat.projectId === projectId), 'CHAT_PROJECT_BINDING_MISSING');
  const page = await (await request(`chats/${encodeURIComponent(chatId)}/messages?limit=60`)).json();
  assert.ok(page.messages.some(message => message.role === 'assistant' && message.text.includes('SCIENCESCOPE_COMMUNICATION_OK')), 'PERSISTED_MESSAGE_MISSING');
  console.log(JSON.stringify({ provider: provider.name, model: modelId, projectId, applicationTurns: 1, textDelta: true, toolCalls: calls.length, toolNames: calls.map(call => call.name), matchingToolResults: results.length, completed, persisted: true }));
} catch (error) {
  console.error(JSON.stringify({ passed: false, category: error?.message?.startsWith('APPLICATION_HTTP_') ? error.message : error?.message || 'SMOKE_FAILED' }));
  process.exitCode = 1;
} finally {
  if (fixtureCreated) { try { await unlink(fixture); } catch { /* owned fixture may already be gone */ } }
  if (chatId) { try { await request('chats/delete', { chatId }); } catch (error) { console.error(JSON.stringify({ cleanup: 'CHAT_SOFT_DELETE_FAILED', category: /409/.test(error?.message || '') ? 'BUSY' : 'APPLICATION' })); } }
}
