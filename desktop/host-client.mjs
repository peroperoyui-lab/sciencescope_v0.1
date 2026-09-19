// Same-origin desktop-development host. Provider traffic belongs to DSH, not UI.
export async function hostRequest(route, body) {
  const response = await fetch(`/api/${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : {'Content-Type':'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
    cache:'no-store',
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || '操作未完成，请检查连接配置。');
  return result;
}

export async function streamChat(body, onEvent) {
  const response = await fetch('/api/chat', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
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
        if (event.type === 'completed') completed = true;
        onEvent(event);
      }
      if (done) break;
    }
    if (!completed) throw new Error('连接已中断，尚未收到完成事件。');
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
}
