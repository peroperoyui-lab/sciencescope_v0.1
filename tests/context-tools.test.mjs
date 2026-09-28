import test from 'node:test';
import assert from 'node:assert/strict';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {buildContextTools,contextRules,CONTEXT_API_VERSION} from '../scripts/context/tools.mjs';

const ROLES=['main','expert','secretary','global'];
const COMMON=['chat_recall','project_memory','research_search','research_read','research_propose'];

test('versioned lookup rules prioritize scoped research tools for every role',()=>{
  for(const role of ROLES){
    const rules=contextRules(role);
    assert.match(rules,/For research questions use research_search first/);
    assert.match(rules,/not shell or filesystem exploration/);
    assert.match(rules,/nextOrdinal/);
    assert.match(rules,/cite evidence for each claim/);
  }
});

function byName(role) { return new Map(buildContextTools(role).map(tool=>[tool.name,tool])); }
function assertField(field,path) {
  assert.ok(field.required===undefined||field.required===true,`${path}.required is true or omitted for an optional DSH value-schema field`);
  if(field.type==='object'){
    assert.equal(field.additionalProperties,false,`${path}.additionalProperties is false`);
    assert.ok(field.properties&&typeof field.properties==='object',`${path}.properties is declared`);
    for(const [name,nested] of Object.entries(field.properties))assertField(nested,`${path}.properties.${name}`);
  }
  if(field.type==='array'&&field.items?.type==='object'){
    assert.equal(field.items.additionalProperties,false,`${path}.items.additionalProperties is false`);
    for(const [name,nested] of Object.entries(field.items.properties??{}))assertField(nested,`${path}.items.properties.${name}`);
  }
}

test('context tool manifests are role-scoped additive contracts with explicit value schemas',()=>{
  for(const role of ROLES){
    const tools=buildContextTools(role);const names=tools.map(tool=>tool.name);const manifest=byName(role);
    assert.equal(new Set(names).size,names.length,`${role} tool names are unique`);
    for(const name of COMMON)assert.ok(manifest.has(name),`${role} has ${name}`);
    assert.equal(manifest.has('minutes_refresh'),role==='secretary');
    assert.equal(manifest.has('workspace_overview'),role==='global');
    assert.ok(manifest.get('project_memory').parameters.section.enum.includes('status'),`${role} has the status section`);
    for(const name of ['chat_recall','project_memory']){
      const parameters=manifest.get(name).parameters;
      assert.equal(Object.hasOwn(parameters,'chatId'),role==='global',`${role} ${name}.chatId scope`);
      assert.equal(Object.hasOwn(parameters,'projectId'),role==='global',`${role} ${name}.projectId scope`);
    }
    for(const tool of tools){
      assert.match(tool.name,/^[a-z_]{1,60}$/u);
      assert.equal(typeof tool.description,'string');assert.ok(tool.description.length>0);
      assert.ok(tool.parameters&&typeof tool.parameters==='object');
      for(const [name,field] of Object.entries(tool.parameters))assertField(field,`${role}.${tool.name}.parameters.${name}`);
      assert.doesNotThrow(()=>defineTool({name:tool.name,description:tool.description,parameters:tool.parameters,output:{schema:{type:'json'},render:()=>[]},execute:async()=>({})}),`${role}.${tool.name} is accepted by the installed DSH value-schema compiler`);
    }
    assert.match(contextRules(role),new RegExp(`Context API ${CONTEXT_API_VERSION.replaceAll('.','\\.')}`));
  }
  assert.deepEqual(buildContextTools('unknown'),[]);
});

test('nested research schemas mark required and optional fields without open objects',()=>{
  const manifest=byName('main');
  const search=manifest.get('research_search').parameters;
  assert.equal(search.query.required,undefined,'query-only and queries-only are both accepted; the host enforces at least one');
  assert.equal(search.queries.type,'array');
  assert.equal(search.queries.items.type,'string');
  assert.equal(search.queries.required,undefined);
  assert.equal(search.types.required,undefined);
  assert.equal(search.limit.required,undefined);

  const read=manifest.get('research_read').parameters;
  assert.equal(read.ref.required,undefined);
  assert.equal(read.ref.additionalProperties,false);
  assert.equal(read.ref.properties.type.required,true);
  assert.equal(read.ref.properties.id.required,true);

  const propose=manifest.get('research_propose').parameters;
  assert.equal(propose.op.required,true);
  assert.equal(propose.item.required,undefined);
  assert.equal(propose.item.additionalProperties,false);
  assert.equal(propose.item.properties.type.required,undefined);
  assert.equal(propose.evidence.required,undefined);
  assert.equal(propose.evidence.items.additionalProperties,false);
  assert.equal(propose.evidence.items.properties.ref.required,undefined);
  assert.equal(propose.evidence.items.properties.ref.additionalProperties,false);
  assert.equal(propose.evidence.items.properties.ref.properties.type.required,true);
  assert.equal(propose.evidence.items.properties.ref.properties.id.required,true);
  assert.equal(propose.rationale.required,true);
});

test('global target parameters and role-only tools are optional, explicit and isolated per build',()=>{
  const global=byName('global');
  for(const name of ['chat_recall','project_memory']){
    assert.equal(global.get(name).parameters.chatId.required,undefined);
    assert.equal(global.get(name).parameters.projectId.required,undefined);
  }
  assert.equal(global.get('workspace_overview').parameters.query.required,undefined);
  const secretary=byName('secretary');
  assert.deepEqual(secretary.get('minutes_refresh').parameters,{});

  global.get('project_memory').parameters.section.enum.push('MUTATED_TEST_VALUE');
  assert.ok(!byName('global').get('project_memory').parameters.section.enum.includes('MUTATED_TEST_VALUE'),'each manifest is a fresh clone');
  assert.ok(!byName('main').has('workspace_overview'),'global additions never leak to Main');
  assert.ok(!byName('global').has('minutes_refresh'),'secretary additions never leak to global');
});
