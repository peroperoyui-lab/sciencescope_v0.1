// Same-origin desktop-development host. Provider traffic belongs to DSH, not UI.
function apiHeaders(contentType = false) {
  const token = globalThis.window?.__SCIENCESCOPE_API_TOKEN__;
  return {...(contentType ? {'Content-Type':'application/json'} : {}), ...(token ? {Authorization:`Bearer ${token}`} : {})};
}

export async function hostRequest(route, body, {keepalive = false} = {}) {
  const response = await fetch(`/api/${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: apiHeaders(body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
    cache:'no-store', ...(keepalive ? {keepalive:true} : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || '操作未完成，请检查连接配置。');
  return result;
}

export async function hostBlob(route) {
  const response = await fetch(`/api/${route}`, {headers:apiHeaders(), cache:'no-store'});
  if (!response.ok) {
    let message = '资源读取失败';
    try { message = (await response.json()).message || message; } catch {}
    throw new Error(message);
  }
  return response.blob();
}

export async function streamChat(body, onEvent, endpoint='/api/chat') {
  const response = await fetch(endpoint, {method:'POST', headers:apiHeaders(true), body:JSON.stringify(body)});
  if (!response.ok) { const result = await response.json(); throw new Error(result.message || '发送失败'); }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value,{stream:true});
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === 'failed') throw new Error(event.message || '运行失败');
        if (event.type === 'completed' || event.type === 'cancelled') completed = true;
        onEvent(event);
      }
      if (done) break;
    }
    if (!completed) throw new Error('连接已中断，尚未收到完成事件。');
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
}
