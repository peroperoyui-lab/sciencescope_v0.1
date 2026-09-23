import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {createDesktopServer} from '../scripts/preview-desktop.mjs';
import {createDesktopApi} from '../scripts/desktop-api.mjs';
import {DESKTOP_ASSETS} from '../scripts/build-desktop.mjs';

test('production desktop HTTP router serves every declared module, including transitive chat imports',async()=>{
  const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'desktop-router-'));
  const server=await createDesktopServer({dataRoot:root,outputDir:path.join(root,'assets'),runtimeHost:{close:async()=>{}}});
  try {
    for(const asset of DESKTOP_ASSETS) {
      const response=await fetch(server.url+'desktop/'+asset);
      assert.equal(response.status,200,asset);
      assert.match(response.headers.get('content-type'),asset.endsWith('.css')?/text\/css/:/javascript/);
    }
    assert.equal((await fetch(server.url+'desktop/not-a-module.mjs')).status,404);
  }finally{await server.close();await rm(root,{recursive:true,force:true});}
});

test('production API requires the per-server token, including status',async()=>{
  const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'desktop-api-auth-'));
  const server=await createDesktopServer({dataRoot:root,outputDir:path.join(root,'assets'),runtimeHost:{close:async()=>{}}});
  try {
    assert.equal(server.apiToken.length,64);
    const noToken=await fetch(server.url+'api/status');
    assert.equal(noToken.status,401);
    assert.equal((await noToken.text()).includes(server.apiToken),false,'token must not enter error responses');
    const wrongToken='0'.repeat(server.apiToken.length);
    const wrong=await fetch(server.url+'api/status',{headers:{Authorization:`Bearer ${wrongToken}`}});
    assert.equal(wrong.status,401);
    assert.equal((await wrong.text()).includes(server.apiToken),false);
    const fullChat=await fetch(server.url+'api/chat',{method:'POST',headers:{Authorization:`Bearer ${wrongToken}`,'Content-Type':'application/json'},body:JSON.stringify({text:'must not run',executionMode:'full',model:{providerId:'missing',modelId:'missing'}})});
    assert.equal(fullChat.status,401);
    assert.equal((await fullChat.text()).includes(server.apiToken),false);
    const valid=await fetch(server.url+'api/status',{headers:{Authorization:`Bearer ${server.apiToken}`}});
    assert.equal(valid.status,200);
    const body=await valid.text();
    assert.equal(body.includes(server.apiToken),false);
    for (const route of ['profile','workspace']) {
      const response=await fetch(server.url+`api/${route}`,{headers:{Authorization:`Bearer ${server.apiToken}`}});
      assert.equal(response.status,200,route);
      assert.equal((await response.text()).includes(server.apiToken),false,route);
    }
  } finally { await server.close(); await rm(root,{recursive:true,force:true}); }
});

test('multibyte wrong API token is rejected without timing comparison errors',async()=>{
  const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'desktop-api-unicode-'));
  const api=await createDesktopApi({dataRoot:root,apiToken:'expected-token',runtimeHost:{close:async()=>{}}});
  const response={status:0,body:'',writeHead(status){this.status=status;},end(body=''){this.body=String(body);}};
  try {
    await api.handle({url:'/api/status',method:'GET',headers:{host:'127.0.0.1:43210',authorization:'Bearer 令'},socket:{localPort:43210}},response);
    assert.equal(response.status,401);
  } finally { await api.close(); await rm(root,{recursive:true,force:true}); }
});

test('each production desktop server receives a distinct API token',async()=>{
  const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
  const rootA=await mkdtemp(path.join(base,'desktop-api-token-a-'));
  const rootB=await mkdtemp(path.join(base,'desktop-api-token-b-'));
  const [first,second]=await Promise.all([
    createDesktopServer({dataRoot:rootA,outputDir:path.join(rootA,'assets'),runtimeHost:{close:async()=>{}}}),
    createDesktopServer({dataRoot:rootB,outputDir:path.join(rootB,'assets'),runtimeHost:{close:async()=>{}}}),
  ]);
  try { assert.ok(first.apiToken!==second.apiToken,'tokens must differ'); }
  finally { await Promise.all([first.close(),second.close()]); await Promise.all([rm(rootA,{recursive:true,force:true}),rm(rootB,{recursive:true,force:true})]); }
});
