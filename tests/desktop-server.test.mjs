import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {createDesktopServer} from '../scripts/preview-desktop.mjs';
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
