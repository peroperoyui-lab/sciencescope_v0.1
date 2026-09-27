import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostEvents} from '../scripts/host-events.mjs';
import {subscribeHostBackground} from '../scripts/host-background.mjs';

test('host events isolate synchronous and asynchronous errors; unsubscribe and close drain work', async () => {
  const errors = [], seen = [];
  const events = createHostEvents({onError:error=>errors.push(error.message)});
  events.on('turn', () => { throw new Error('sync'); });
  events.on('turn', async () => { throw new Error('async'); });
  const off = events.on('turn', () => seen.push('removed')); off();
  let release; const wait = new Promise(resolve => release = resolve);
  events.on('turn', async () => { await wait; seen.push('done'); });
  void events.emit('turn', {});
  let drained = false; const closing = events.close().then(()=>{drained=true;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(drained,false); release(); await closing;
  assert.deepEqual(errors.sort(),['async','sync']); assert.deepEqual(seen,['done']);
  await events.emit('turn'); assert.deepEqual(seen,['done']);
});

test('idle notification resets on persisted activity and shutdown cancels it', async () => {
  const events = createHostEvents({idleMs:15}); const seen=[];
  events.on('chat.idle', value=>seen.push(value.chatId));
  await events.emit('chat.turn.persisted',{chatId:'one'});
  await events.emit('discussion.finished',{chatId:'one'});
  await new Promise(resolve=>setTimeout(resolve,35)); assert.deepEqual(seen,['one']);
  await events.emit('chat.turn.persisted',{chatId:'two'}); await events.close();
  await new Promise(resolve=>setTimeout(resolve,25)); assert.deepEqual(seen,['one']);
});

test('T17 only discussion schedules minutes; version auto-organize subscribes to storage', async () => {
  const events=createHostEvents(); const minutes=[], versions=[];
  const off=subscribeHostBackground({events,minutes:{schedule:id=>minutes.push(id)},
    organizer:{organize:async value=>versions.push(value)},workbench:{get:async()=>({autoOrganize:true})},modelFor:()=>({providerId:'p',modelId:'m'})});
  await events.emit('chat.turn.persisted',{chatId:'c'}); assert.deepEqual(minutes,[]);
  await events.emit('discussion.finished',{chatId:'c'}); assert.deepEqual(minutes,['c']);
  await events.emit('version.stored',{projectId:'p',versionId:'v'}); assert.equal(versions.length,1);
  off(); await events.emit('discussion.finished',{chatId:'c'}); assert.equal(minutes.length,1);
  await events.close();
});

test('a running turn is not reported idle after its previous commit',async()=>{
  let busy=true;const seen=[];
  const events=createHostEvents({idleMs:15,isBusy:()=>busy});
  events.on('chat.idle',value=>seen.push(value.chatId));
  await events.emit('chat.turn.persisted',{chatId:'long-turn'});
  await new Promise(resolve=>setTimeout(resolve,45));assert.deepEqual(seen,[]);
  busy=false;await events.emit('chat.turn.persisted',{chatId:'long-turn'});
  await new Promise(resolve=>setTimeout(resolve,35));assert.deepEqual(seen,['long-turn']);
  await events.close();
});
