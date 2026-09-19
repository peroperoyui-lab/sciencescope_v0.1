// Explicit opt-in: one real desktop composer send, then soft-remove only its test chat.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const browser=await chromium.connectOverCDP('http://127.0.0.1:9229');
try{
  const page=browser.contexts()[0].pages()[0];
  const previous=await page.evaluate(()=>V.chat);
  await page.evaluate(()=>window.SSV2.newThread(null));
  const id=await page.evaluate(()=>V.chat);
  const input=page.locator('textarea[data-draft="main"]');
  await input.fill('Do not use tools. Reply with exactly: SCIENCESCOPE_NATIVE_CHAT_OK');
  await page.locator('[data-v="send"][data-scope="main"]').click();
  await page.waitForFunction(()=>S.messages.some(m=>m.role==='assistant'&&m.text.includes('SCIENCESCOPE_NATIVE_CHAT_OK'))&&!V.pending.has(V.chat),{},{timeout:120000});
  assert.ok(await page.locator('.message-text').filter({hasText:'SCIENCESCOPE_NATIVE_CHAT_OK'}).count());
  await page.evaluate(async id=>{const r=await fetch('/api/chats/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chatId:id})});if(!r.ok)throw new Error('test chat cleanup failed');},id);
  await page.evaluate(async previous=>{S.threads=S.threads.filter(t=>!t.deletedAt);if(S.threads.some(t=>t.id===previous))await window.SSV2.loadThread(previous);},previous);
  await page.reload();
  console.log(JSON.stringify({nativeComposer:true,realProvider:true,responseVisible:true,completed:true,testChatSoftRemoved:true}));
}finally{await browser.close();}
