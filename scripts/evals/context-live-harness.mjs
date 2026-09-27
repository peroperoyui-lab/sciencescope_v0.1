// Opt-in evaluation helper, not a production Provider transport. Counts actual
// forwarded requests and returned usage without saving request headers/bodies.
import {createServer,request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createDshHost} from '../../adapters/runtime-dsh/host.mjs';
import {createDesktopApi} from '../desktop-api.mjs';

export async function createContextLiveHarness(name,{maxRequests=80,maxTokens=2048}={}) {
  if(!process.argv.includes('--live'))throw new Error('Paid evaluation requires --live');
  const key=(await readFile('.sciencescope-local/secret/opencode.key','utf8')).trim();
  if(!key)throw new Error('Missing workspace evaluation credential');
  const base=path.resolve('.sciencescope-local/temp/eval');await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,name+'-'));
  const evidence={model:'deepseek-v4.1-flash',requests:[],blocked:0,errors:[],checks:{},turns:[]};
  const proxy=createServer((req,res)=>{
    if(req.method!=='POST'||req.url!=='/v1/chat/completions'){res.writeHead(404);res.end();return;}
    if(evidence.requests.length>=maxRequests){evidence.blocked++;res.writeHead(429);res.end('{"error":"evaluation request budget reached"}');return;}
    const record={n:evidence.requests.length+1,at:new Date().toISOString(),status:null,usage:null};evidence.requests.push(record);
    const upstream=httpsRequest('https://opencode.ai/zen/go/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key,'x-opencode-session':String(req.headers['x-opencode-session']||'sciencescope-'+name)},timeout:120000},response=>{
      record.status=response.statusCode;res.writeHead(response.statusCode,{'content-type':response.headers['content-type']||'text/event-stream'});
      if(response.statusCode>=400){response.resume();response.on('end',()=>res.end(JSON.stringify({error:'Provider HTTP '+response.statusCode})));return;}
      let buffer='';response.setEncoding('utf8');
      response.on('data',part=>{
        res.write(part);buffer+=part;
        const lines=buffer.split('\n');buffer=lines.pop();
        for(const line of lines)if(line.startsWith('data: ')){try{const body=JSON.parse(line.slice(6));if(body.usage)record.usage=body.usage;const finish=body.choices?.find(choice=>choice.finish_reason)?.finish_reason;if(finish)record.finishReason=finish;}catch{}}
      });
      response.on('end',()=>res.end());response.on('error',()=>{record.error='UPSTREAM_STREAM_ERROR';res.destroy();});
    });
    upstream.on('timeout',()=>upstream.destroy(new Error('timeout')));
    upstream.on('error',()=>{record.error='UPSTREAM_TRANSPORT_ERROR';if(!res.headersSent)res.writeHead(502);res.end('{"error":"upstream transport failed"}');});
    req.pipe(upstream);
  });
  await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  const model={providerId:'evaluation',modelId:evidence.model};
  const runtimeConfig={providers:{evaluation:{api:'openai-completions',baseURL:`http://127.0.0.1:${proxy.address().port}/v1`,apiKeyEnv:'SCIENCESCOPE_EVAL_KEY',models:[{id:model.modelId,contextWindow:131072,maxTokens}]}}};
  const dsh=await createDshHost({home:path.join(root,'.sciencescope-local/dsh'),cwd:root,sessionHeaders:['x-opencode-session'],env:{SCIENCESCOPE_EVAL_KEY:key}});
  const host={...dsh,getRuntimeConfig:async()=>runtimeConfig,listProviders:async()=>[]};
  const api=await createDesktopApi({dataRoot:root,runtimeHost:host,onError:error=>evidence.errors.push({code:error.code||'API_ERROR',name:error.name})});
  const server=createServer((req,res)=>api.handle(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  async function call(route,body) {
    const value=await new Promise((resolve,reject)=>{
      const raw=body===undefined?'':JSON.stringify(body);
      const req=httpRequest({hostname:'127.0.0.1',port:server.address().port,path:'/api/'+route,method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json','content-length':Buffer.byteLength(raw)}},res=>{
        let data='';res.setEncoding('utf8');res.on('data',part=>data+=part);res.on('end',()=>{
          try{resolve({status:res.statusCode,events:data.trim()?data.trim().split('\n').map(line=>JSON.parse(line)):[]});}catch{reject(new Error('Invalid local API response'));}
        });
      });req.on('error',reject);req.end(raw);
    });
    if(value.status!==200||value.events.some(event=>event.type==='failed'))throw new Error('Evaluation API failure at '+route+' ('+value.status+')');
    return value.events.length===1&&!value.events[0].type?value.events[0]:value.events;
  }
  async function close() {
    await api.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));
    evidence.finishedAt=new Date().toISOString();
    evidence.forwardedRequests=evidence.requests.length;
    evidence.usage=evidence.requests.reduce((total,request)=>{if(!request.usage){total.missing++;return total;}for(const field of ['prompt_tokens','completion_tokens','total_tokens'])total[field]+=(request.usage[field]||0);total.returned++;return total;},{prompt_tokens:0,completion_tokens:0,total_tokens:0,returned:0,missing:0});
    const json=JSON.stringify(evidence,null,2);if(json.includes(key))throw new Error('Credential detected; refusing to write evidence');
    await writeFile(path.join(root,'result.json'),json+'\n');
    console.log(JSON.stringify({root,requests:evidence.forwardedRequests,usage:evidence.usage,checks:evidence.checks}));
  }
  return {root,model,host,call,evidence,close};
}
