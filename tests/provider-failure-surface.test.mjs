import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {createDshHost} from '../adapters/runtime-dsh/host.mjs';

test('a provider rejection reaches the host as a categorised failure, and an unknown model fails startup without killing the host',async()=>{
  const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'provider-failure-'));let requests=0;
  const fixture=createServer(async(req,res)=>{
    for await(const _ of req);requests++;
    res.writeHead(404,{'Content-Type':'application/json'});
    res.end('{"message":"model not found","type":"invalid_request_error"}');
  });
  await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
  const runtimeConfig={providers:{fixture:{api:'openai-completions',baseURL:`http://127.0.0.1:${fixture.address().port}/v1`,apiKeyEnv:'SCIENCESCOPE_OFFLINE_KEY',models:[{id:'fixture',contextWindow:32768,maxTokens:256}]}}};
  const host=await createDshHost({home:root,cwd:root,sessionHeaders:['x-fixture'],env:{SCIENCESCOPE_OFFLINE_KEY:'fixture'}});
  try{
    await assert.rejects(host.startSession({model:{providerId:'fixture',modelId:'not-registered'},workspace:root,runtimeConfig}));
    const sessionId=await host.startSession({model:{providerId:'fixture',modelId:'fixture'},workspace:root,runtimeConfig});
    await assert.rejects(host.send({sessionId,text:'hello'}),error=>/DSH model request failed/.test(error.message)&&/404|model not found/.test(error.message)&&typeof error.cause?.code==='string');
    assert.equal(requests,1);
  }finally{await host.close();fixture.closeAllConnections();await new Promise(r=>fixture.close(r));await rm(root,{recursive:true,force:true});}
});
