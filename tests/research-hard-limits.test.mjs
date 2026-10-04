import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir, mkdtemp, rm, readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {openApplicationDatabaseSync} from '../scripts/application-database.mjs';
import {createResearchBase} from '../scripts/research-base/index.mjs';
import {createChatMinutes} from '../scripts/chat-minutes.mjs';
import {ChatStore} from '../scripts/chat-store.mjs';
import {createAssistantConversations} from '../scripts/assistant-conversations.mjs';
import {parseCitationLabel, extractCitationLabels} from '../scripts/research-base/citations.mjs';
import {createRoleSettings} from '../scripts/role-settings.mjs';
import {createExpertRoster} from '../scripts/expert-roster.mjs';
import {indexText} from '../scripts/research-base/text-index.mjs';

const base = path.resolve('.sciencescope-local/temp/t24-validation');
async function fixture(prefix) {
  await mkdir(base, {recursive:true});
  return mkdtemp(path.join(base, prefix));
}

test('a long research proposal keeps every field through pending inbox and edited acceptance', async () => {
  const root = await fixture('research-a-');
  const database = openApplicationDatabaseSync({stateDir:root});
  try {
    const research = createResearchBase({database, resolveResourcePath:async()=>null});
    const evidence = research.store.createItem({type:'knowledge',title:'Source fact',body:'Observed evidence'});
    const item = {type:'model',title:'Model '.repeat(100),body:'Derivation '.repeat(7000)+'FINAL_BODY',
      payload:{latex:'x+y+'.repeat(6000)+'FINAL_LATEX', explanation:'Explanation '.repeat(6000)+'FINAL_PAYLOAD'}};
    const rationale = 'Rationale '.repeat(500)+'FINAL_REASON';
    const quote = 'Exact quote '.repeat(800)+'FINAL_QUOTE', note = 'Evidence note '.repeat(400)+'FINAL_NOTE';
    const result = await research.toolCall('research_propose', {op:'create', item, rationale,
      evidence:[{ref:{type:'item',id:evidence.id},quote,note}]}, {projectId:'p1',role:'secretary',chatId:'main'});
    assert.equal(result.status,'awaiting_user_review');
    assert.equal(research.store.listItems({projectId:'p1',includePersonal:false}).length,0,'pending content must not become research facts');
    const pending = research.store.getProposal(result.proposalId);
    assert.equal(pending.status,'pending');
    for (const field of ['type','title','body','payload']) assert.deepEqual(pending.payload.item[field],item[field]);
    assert.equal(pending.projectId,'p1');
    assert.equal(pending.payload.item.scope,'project');
    assert.equal(pending.rationale,rationale);
    const editedBody = item.body+'\nUSER_CONFIRMED_END';
    const decision = research.store.decide(result.proposalId,{accept:true,edits:{item:{body:editedBody}}});
    const accepted = research.store.getItem(decision.resultId);
    assert.equal(accepted.body,editedBody); assert.equal(accepted.title,item.title);
    assert.deepEqual(accepted.payload,item.payload);
    const link = research.store.linksOf({type:'item',id:accepted.id})[0];
    assert.equal(link.quote,quote); assert.equal(link.note,note);
    assert.equal(research.store.getProposal(result.proposalId).status,'accepted');
    assert.throws(()=>research.store.createItem({type:'model',title:'Invalid',payload:{latex:42}}),/LaTeX/);
    assert.throws(()=>research.store.createItem({type:'knowledge',title:''}),/不能为空/);
  } finally { database.close(); await rm(root,{recursive:true,force:true}); }
});

test('long secretary proposals survive restart and handling without mutating Main or user scratch drafts', async () => {
  const root = await fixture('secretary-a-');
  let chats = await new ChatStore({stateDir:root}).init();
  try {
    await chats.ensureChat({chatId:'main',title:'Main'});
    const service = createAssistantConversations({chatStore:chats});
    const text = 'Complete proposed instruction\n'.repeat(3000)+'FINAL_PROPOSAL';
    service.saveProposal('long-proposal','main',text);
    assert.equal(service.listProposals('main')[0].text,text);
    assert.equal((await chats.pageMessages('main')).total,0);
    await service.saveDraft('secretary','main',text);
    assert.equal(service.getDraft('secretary','main'),text,'complete proposal can also be retained as an editable draft');
    assert.throws(()=>service.saveProposal('empty','main','  '),/Invalid proposal/);
    chats.close(); chats = await new ChatStore({stateDir:root}).init();
    const reopened = createAssistantConversations({chatStore:chats});
    assert.equal(reopened.listProposals('main')[0].status,'pending');
    assert.equal(reopened.resolveProposal('main','long-proposal').text,text);
    assert.equal(reopened.listProposals('main')[0].status,'handled');
    assert.equal((await chats.pageMessages('main')).total,0);
  } finally { chats.close(); await rm(root,{recursive:true,force:true}); }
});

test('long generated and user-edited minutes preserve revisions and Markdown export', async () => {
  const root = await fixture('minutes-a-');
  const db = new DatabaseSync(path.join(root,'minutes.sqlite'));
  db.exec('CREATE TABLE messages(chat_id TEXT,ordinal INTEGER,id TEXT,role TEXT,text TEXT)');
  db.prepare('INSERT INTO messages VALUES(?,?,?,?,?)').run('main',0,'answer','assistant','New result');
  const generated = 'Full research decision\n'.repeat(6000)+'FINAL_GENERATED';
  const edited = generated+'\nUSER_AUTHORITATIVE_END';
  const updates=[];
  const minutes = createChatMinutes({db,chatStore:{getChat:()=>({id:'main',title:'Main'}),getRuntimeWorkspace:()=>root},
    modelFor:()=>({providerId:'fake',modelId:'fake'}),host:{startSession:async()=>'fake',send:async()=>({finalResponse:generated}),releaseSession:async()=>{}},
    onUpdated:event=>updates.push(event)});
  try {
    assert.equal((await minutes.refresh('main')).text,generated);
    assert.equal(minutes.edit('main',edited,1).text,edited);
    assert.throws(()=>minutes.edit('main','stale',1),error=>error.code==='MINUTES_CHANGED');
    assert.throws(()=>minutes.edit('main',' ',2),error=>error.code==='INVALID_MINUTES');
    await minutes.close();
    assert.deepEqual(minutes.revisions('main').map(row=>row.text),[edited,generated]);
    assert.equal(updates.length,2);
    const markdown=await readFile(minutes.exportStatus('main').path,'utf8');
    assert.ok(markdown.endsWith(edited+'\n'));
  } finally { await minutes.close(); db.close(); await rm(root,{recursive:true,force:true}); }
});

test('compound citations beyond 32 members and 2048 characters preserve identities, unknowns and offsets', () => {
  const members=Array.from({length:400},(_,index)=>`S${index+1} p.4–5`);
  const raw='['+members.join('; ')+'; unknown-final]';
  const text='Research proof '+raw+'.';
  const [result]=extractCitationLabels(text);
  assert.equal(result.parseStatus,'partial'); assert.equal(result.raw,raw);
  assert.equal(result.citations.length,400);
  assert.equal(result.citations.at(-1).label,'S400');
  assert.deepEqual(result.unrecognized,[{raw:'unknown-final',reason:'unsupported-format'}]);
  assert.equal(text.slice(result.start,result.end),raw);
  assert.equal(parseCitationLabel('['+members.join('; ')+']').parseStatus,'parsed');
});

test('resource-limit refusal preserves existing research revisions, pending proposal and raw citation', async () => {
  const root=await fixture('resource-a-');
  const database=openApplicationDatabaseSync({stateDir:root});
  try {
    const store=createResearchBase({database,resolveResourcePath:async()=>null}).store;
    const item=store.createItem({type:'knowledge',title:'Existing',body:'Existing durable text'});
    const pending=store.propose({op:'update',targetId:item.id,payload:{item:{body:'New proposed text'}}});
    const oversized='x'.repeat(64*1024*1024+1);
    assert.throws(()=>store.updateItem(item.id,{body:oversized}),error=>error.code==='RESEARCH_RESOURCE_LIMIT'&&error.status===413);
    assert.equal(store.getItem(item.id).body,item.body);
    assert.equal(store.getItem(item.id).revision,1);
    assert.equal(store.revisionsOf(item.id).length,0);
    assert.equal(store.getProposal(pending.id).status,'pending');
    const source=store.addSource({title:'Preserved parser projection'});
    store.replaceChunks(source.id,[{text:'Existing complete passage'}]);
    assert.throws(()=>store.replaceChunks(source.id,[{text:oversized}]),error=>error.code==='RESEARCH_RESOURCE_LIMIT');
    assert.equal(store.chunksOf(source.id)[0].text,'Existing complete passage');
    const roles=createRoleSettings({db:database.db});
    roles.save('main',{prompt:'Existing role'});
    roles.bind('main','main');
    assert.throws(()=>roles.save('main',{prompt:oversized}),error=>error.code==='ROLE_PROMPT_RESOURCE_LIMIT'&&error.status===413);
    assert.equal(roles.get('main').prompt,'Existing role');
    assert.equal(roles.getBinding('main').prompt,'Existing role');
    const experts=createExpertRoster({db:database.db});
    const existingRoster=experts.list();
    assert.throws(()=>experts.save([{id:'large',label:'Large',persona:oversized}]),error=>error.code==='EXPERT_PROMPT_RESOURCE_LIMIT'&&error.status===413);
    assert.deepEqual(experts.list(),existingRoster);
    const raw='[S1 '+oversized+']';
    const citation=parseCitationLabel(raw);
    assert.equal(citation.raw,raw);
    assert.deepEqual(citation.unrecognized,[{raw,reason:'label-too-long'}]);
  } finally { database.close(); await rm(root,{recursive:true,force:true}); }
});

test('long parser passages reconstruct exactly after chunk projection rebuild with original anchors and absolute offsets', async () => {
  const root=await fixture('chunks-b-');
  const database=openApplicationDatabaseSync({stateDir:root});
  try {
    const store=createResearchBase({database,resolveResourcePath:async()=>null}).store;
    const source=store.addSource({title:'Durable source',resourceId:'original-artifact',projectId:'p1'});
    const text='a'.repeat(19999)+'😀'+' research '.repeat(3000)+' TAIL_REBUILD_SENTINEL';
    const anchor={page:7,rects:[[1,2,3,4]],quote:{exact:text,prefix:'prior',suffix:'next'}};
    const input=[{text,section:'Results',page:7,kind:'paragraph',charStart:100,charEnd:100+text.length,anchor},
      {text:'Followup',page:8}, {text:'z'.repeat(21000),charStart:90000,charEnd:90001}];
    const check=()=>{
      const chunks=store.chunksOf(source.id);
      const first=chunks.filter(chunk=>chunk.page===7);
      assert.ok(first.length>1); assert.equal(first.map(chunk=>chunk.text).join(''),text);
      let cursor=100;
      for (const chunk of first) {
        assert.equal(chunk.charStart,cursor); cursor+=chunk.text.length; assert.equal(chunk.charEnd,cursor);
        assert.deepEqual(chunk.anchor.rects,anchor.rects); assert.deepEqual(chunk.anchor.quote,anchor.quote);
        assert.equal(chunk.anchor.split.sourceOrdinal,0);
        assert.equal(chunk.anchor.split.start,chunk.charStart-100);
        assert.equal(chunk.anchor.split.end,chunk.charEnd-100);
        assert.ok(!/[\uD800-\uDBFF]$/u.test(chunk.text),'a page boundary must not break a Unicode character');
        const indexed=database.db.prepare("SELECT body FROM rb_fts WHERE doc_type='chunk' AND doc_id=?").get(chunk.id);
        assert.equal(indexed.body,indexText(chunk.text));
      }
      assert.equal(cursor,100+text.length);
      assert.equal(new Set(chunks.map(chunk=>chunk.ordinal)).size,chunks.length);
      assert.equal(chunks.find(chunk=>chunk.page===8).anchor.split.sourceOrdinal,1);
      assert.equal(chunks.at(-1).charStart,null,'inconsistent parser offsets cannot become invented absolute positions');
      assert.equal(chunks.at(-1).charEnd,null);
    };
    store.replaceChunks(source.id,input,{parser:'test'}); check();
    store.replaceChunks(source.id,[],{parser:'rebuild'});
    assert.equal(store.getSource(source.id).resourceId,'original-artifact');
    store.replaceChunks(source.id,input,{parser:'test'}); check();
    store.removeSource(source.id);
    assert.equal(store.chunksOf(source.id).length,0);
    assert.equal(database.db.prepare("SELECT count(*) AS n FROM rb_fts WHERE doc_type='chunk'").get().n,0);
  } finally { database.close(); await rm(root,{recursive:true,force:true}); }
});

test('minutes secretary receives a complete message beyond both the old 20k cap and 60k batch boundary', async () => {
  const root=await fixture('minutes-input-b-');
  const db=new DatabaseSync(path.join(root,'minutes.sqlite'));
  db.exec('CREATE TABLE messages(chat_id TEXT,ordinal INTEGER,id TEXT,role TEXT,text TEXT)');
  const long='Full original paragraph\n'.repeat(4000)+'FINAL_INPUT_SENTINEL';
  db.prepare('INSERT INTO messages VALUES(?,?,?,?,?)').run('main',0,'long','assistant',long);
  let prompt;
  const minutes=createChatMinutes({db,chatStore:{getChat:()=>({id:'main'})},modelFor:()=>({providerId:'fake',modelId:'fake'}),
    host:{startSession:async()=>'fake',send:async(input)=>{prompt=input.text;return {finalResponse:'Saved full-source minutes'};},releaseSession:async()=>{}}});
  try {
    await minutes.refresh('main');
    assert.ok(prompt.includes(long));
    assert.ok(!prompt.includes('long message shortened'));
    assert.equal(minutes.get('main').throughOrdinal,1);
  } finally { await minutes.close();db.close();await rm(root,{recursive:true,force:true}); }
});

test('long role and expert personas retain their tail through bindings and reopen without granting skills', async () => {
  const root=await fixture('persona-b-');
  const file=path.join(root,'roles.sqlite');let db=new DatabaseSync(file);
  try {
    const prompt='Custom research guidance\n'.repeat(1200)+'FINAL_PERSONA_SENTINEL';
    const roles=createRoleSettings({db});
    roles.save('secretary',{prompt});
    assert.equal(roles.bind('main','secretary').prompt,prompt);
    const roster=createExpertRoster({db});
    roster.save([{id:'long',label:'Long',persona:prompt,skills:[]}]);
    assert.deepEqual(roster.resolveParticipants(['long'])[0].skills,[]);
    db.close();db=new DatabaseSync(file);
    assert.equal(createRoleSettings({db}).getBinding('main').prompt,prompt);
    assert.equal(createExpertRoster({db}).list()[0].persona,prompt);
  } finally {db.close();await rm(root,{recursive:true,force:true});}
});
