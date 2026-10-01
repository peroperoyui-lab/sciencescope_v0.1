import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {createDshHost} from '../adapters/runtime-dsh/host.mjs';

// Real DSH + local fixture model (T12): a branch made after a completed turn is
// a persisted child session. Resumed in its own process, the model sees the
// conversation up to that turn and nothing after it; the source is unchanged.
test('fork after a completed turn: child resumes with the prefix only, source unchanged',async()=>{
  const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'session-fork-'));
  const requests=[];
  const textOf=content=>typeof content==='string'?content:Array.isArray(content)?content.map(part=>part?.text??'').join(''):'';
  const fixture=createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;const input=JSON.parse(body);
    const users=(input.messages||[]).filter(m=>m.role==='user').map(m=>textOf(m.content));
    const all=(input.messages||[]).map(m=>textOf(m.content)).join('\n');
    requests.push({last:users.at(-1)||'',all});
    // DSH appends a runtime-context user message after the prompt; answer the last marked one.
    const marker=users.filter(u=>/TURN_[A-Z]+/.test(u)).at(-1)?.match(/TURN_[A-Z]+/)?.[0]||'NONE';
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.write(`data: ${JSON.stringify({choices:[{delta:{content:`ANSWER_${marker}`}}]})}\n\n`);
    res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
    res.end('data: [DONE]\n\n');
  });
  await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
  const runtimeConfig={providers:{fixture:{api:'openai-completions',baseURL:`http://127.0.0.1:${fixture.address().port}/v1`,apiKeyEnv:'SCIENCESCOPE_OFFLINE_KEY',models:[{id:'fixture',contextWindow:32768,maxTokens:256}]}}};
  const model={providerId:'fixture',modelId:'fixture'};
  const host=await createDshHost({home:root,cwd:root,sessionHeaders:['x-fixture'],env:{SCIENCESCOPE_OFFLINE_KEY:'fixture'}});
  const ask=async(sessionId,text)=>{const before=requests.length;const result=await host.send({sessionId,text,onEvent:()=>{}});return {answer:result.finalResponse,request:requests.slice(before).at(-1)};};
  try{
    const source=await host.startSession({model,workspace:root,runtimeConfig});
    assert.equal((await ask(source,'Please note TURN_ALPHA.')).answer,'ANSWER_TURN_ALPHA');
    assert.equal((await ask(source,'Please note TURN_BETA.')).answer,'ANSWER_TURN_BETA');

    const {turns}=await host.sessionTurns({sessionId:source});
    assert.equal(turns.length,2,'two completed turns');
    assert.ok(turns[0].endSeq<turns[1].endSeq);

    // Branch after turn 1.
    const fork=await host.forkSession({sessionId:source,atSeq:turns[0].endSeq});
    assert.match(fork.sessionId,/^session-/);
    assert.equal(fork.boundarySeq,turns[0].endSeq);

    // The child runs in its own process and sees ALPHA but not BETA.
    const child=await host.startSession({sessionId:fork.sessionId,model,workspace:root,runtimeConfig});
    assert.equal(child,fork.sessionId);
    const inChild=await ask(child,'Continue with TURN_GAMMA.');
    assert.equal(inChild.answer,'ANSWER_TURN_GAMMA');
    assert.match(inChild.request.all,/TURN_ALPHA/,'branch keeps the turn it was made after');
    assert.match(inChild.request.all,/ANSWER_TURN_ALPHA/);
    assert.doesNotMatch(inChild.request.all,/TURN_BETA/,'branch excludes later turns');

    // The source is unchanged and continues with both turns.
    const inSource=await ask(source,'Continue with TURN_DELTA.');
    assert.match(inSource.request.all,/TURN_ALPHA[\s\S]*TURN_BETA/);
    assert.doesNotMatch(inSource.request.all,/TURN_GAMMA/,'the branch does not leak into the source');

    // The child persists its own turns: release and resume it again.
    await host.releaseSession(child);
    const again=await host.startSession({sessionId:fork.sessionId,model,workspace:root,runtimeConfig});
    const resumed=await ask(again,'And TURN_EPSILON.');
    assert.match(resumed.request.all,/TURN_ALPHA[\s\S]*TURN_GAMMA/);
    assert.doesNotMatch(resumed.request.all,/TURN_BETA|TURN_DELTA/);

    // No completed turn: branching is refused.
    const fresh=await host.startSession({model,workspace:root,runtimeConfig});
    await assert.rejects(host.forkSession({sessionId:fresh}),/no completed turn/i);
  }finally{
    await host.close?.();fixture.close();await rm(root,{recursive:true,force:true});
  }
});
