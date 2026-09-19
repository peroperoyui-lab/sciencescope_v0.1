// Explicit opt-in; uses an already-saved provider, never edits credentials/models.
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { createDesktopApi } from './desktop-api.mjs';

const config = JSON.parse(await readFile(new URL('../.sciencescope-local/state/test-api.env.json',import.meta.url),'utf8'));
const baseUrl = config.SCIENCESCOPE_TEST_BASE_URL;
const model = config.SCIENCESCOPE_TEST_MODEL;
if (!baseUrl || !model) throw new Error('Explicit local test route required');
const api = await createDesktopApi();
const server = http.createServer((req,res)=>void api.handle(req,res));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  const status = await (await fetch(origin+'/api/status')).json();
  if (!status.tokenStreaming) throw new Error('Runtime does not advertise token streaming');
  const {providers} = await (await fetch(origin+'/api/providers')).json();
  const provider = providers.find(p=>p.baseUrl===baseUrl && p.protocol==='openai-chat-completions' && p.models.includes(model));
  if (!provider) throw new Error('Save the explicit test model in API settings first');
  const start = performance.now();
  const response = await fetch(origin+'/api/chat', {
    method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(120000),
    body:JSON.stringify({projectId:'stream-check',chatId:`stream-${Date.now()}`,model:{providerId:provider.id,modelId:model},text:'Do not use tools. Write SCIENCESCOPE_STREAM_OK then exactly 8 numbered short steps in Chinese for checking a research hypothesis. End with a fenced Python code block containing print(2+2).'}),
  });
  if (!response.ok) throw new Error(`Chat failed: HTTP ${response.status}`);
  const decoder = new TextDecoder(); let buffer=''; let text=''; let deltas=0; let firstMs; let completedMs;
  for await (const bytes of response.body) {
    buffer += decoder.decode(bytes,{stream:true});
    const lines = buffer.split('\n'); buffer=lines.pop();
    for(const line of lines.filter(Boolean)) {
      const event=JSON.parse(line);
      if(event.type==='text-delta') { firstMs ??= performance.now()-start; deltas++; text+=event.delta; }
      if(event.type==='text-reset') text='';
      if(event.type==='text-replace') text=event.text;
      if(event.type==='completed') completedMs=performance.now()-start;
      if(event.type==='failed') throw new Error('Runtime reported failure');
    }
  }
  const passed=deltas>1 && firstMs<completedMs && text.includes('SCIENCESCOPE_STREAM_OK');
  console.log(JSON.stringify({applicationChatRequests:1,deltas,firstTextMs:Math.round(firstMs??0),completedMs:Math.round(completedMs??0),sentinelReceived:text.includes('SCIENCESCOPE_STREAM_OK'),passed}));
  if(!passed) process.exitCode=1;
} catch(error) {
  // No raw provider error/payload is logged.
  console.error(error.name==='TimeoutError'?'Streaming smoke timed out':'Streaming smoke failed');
  process.exitCode=1;
} finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); await api.close(); }
