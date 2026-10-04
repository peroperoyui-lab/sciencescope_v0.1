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

test('version subscriber never schedules minutes; T18 policy owns discussion triggers', async () => {
  const events=createHostEvents(); const minutes=[], versions=[];
  const off=subscribeHostBackground({events,minutes:{schedule:id=>minutes.push(id)},
    organizer:{organize:async value=>versions.push(value)},workbench:{get:async()=>({autoOrganize:true})},modelFor:()=>({providerId:'p',modelId:'m'})});
  await events.emit('chat.turn.persisted',{chatId:'c'}); assert.deepEqual(minutes,[]);
  await events.emit('discussion.finished',{chatId:'c'}); assert.deepEqual(minutes,[]);
  await events.emit('version.stored',{projectId:'p',versionId:'v'}); assert.equal(versions.length,1);
  off(); await events.emit('discussion.finished',{chatId:'c'}); assert.equal(minutes.length,0);
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

test('idle settings rearm from last activity; disabling preserves the clock',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
  let delay=100;const seen=[];
  const events=createHostEvents({idleDelayFor:()=>delay});
  events.on('chat.idle',value=>seen.push(value.chatId));
  await events.emit('chat.turn.persisted',{chatId:'configured'});
  t.mock.timers.tick(40);delay=null;events.refreshIdle();
  t.mock.timers.tick(200);await Promise.resolve();assert.deepEqual(seen,[]);
  delay=100;events.refreshIdle();t.mock.timers.tick(0);
  await Promise.resolve();assert.deepEqual(seen,['configured']);
  await events.emit('chat.turn.persisted',{chatId:'extended'});
  t.mock.timers.tick(40);delay=200;events.refreshIdle();
  t.mock.timers.tick(159);await Promise.resolve();assert.deepEqual(seen,['configured']);
  t.mock.timers.tick(1);await Promise.resolve();assert.deepEqual(seen,['configured','extended']);
  await events.close();
});

test('busy idle rearm waits a full interval and does not spin at zero delay',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
  let busy=true,checks=0;const seen=[];
  const events=createHostEvents({idleDelayFor:()=>100,isBusy:()=>{checks++;return busy;}});
  events.on('chat.idle',value=>seen.push(value.chatId));
  await events.emit('chat.turn.persisted',{chatId:'busy'});
  t.mock.timers.tick(100);assert.equal(checks,1);
  busy=false;t.mock.timers.tick(99);await Promise.resolve();assert.deepEqual(seen,[]);
  t.mock.timers.tick(1);await Promise.resolve();assert.deepEqual(seen,['busy']);
  assert.equal(checks,2);await events.close();
});
