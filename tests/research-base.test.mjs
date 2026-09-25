import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { openApplicationDatabaseSync } from '../scripts/application-database.mjs';
import { createResearchBase } from '../scripts/research-base/index.mjs';
import { chunkBlocks } from '../scripts/research-base/ingest.mjs';
import { indexText, matchExpression } from '../scripts/research-base/text-index.mjs';

async function fixture() {
  const base = path.resolve('.sciencescope-local/temp'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'research-base-'));
  const database = openApplicationDatabaseSync({ stateDir: root });
  const files = path.join(root, 'files'); await mkdir(files);
  const add = async (id, title, content, projectId = 'p1') => { await writeFile(path.join(files, title), content); return database.addResource({ id, projectId, title, kind: path.extname(title).slice(1), path: title, metadata: { storage: 'library' } }); };
  const rb = createResearchBase({ database, resolveResourcePath: async (resource) => path.join(files, resource.path) });
  return { root, database, rb, add, close: async () => { database.close(); await rm(root, { recursive: true, force: true }); } };
}

test('CJK bigram index matches two-character Chinese words and mixed text', () => {
  assert.equal(indexText('跑步社CRP水平'), '跑步 步社 crp 水平');
  assert.equal(matchExpression('胰岛素 敏感 insulin'), '"胰岛 岛素" AND "敏感" AND "insulin"');
  assert.equal(matchExpression('  '), null);
});

test('chunking keeps headings with their text and equations whole', () => {
  const chunks = chunkBlocks([
    { kind: 'heading', text: '方法', section: '方法' },
    { kind: 'paragraph', text: '随机分组。', section: '方法' },
    { kind: 'paragraph', text: '双盲。', section: '方法' },
    { kind: 'equation', text: '$$y = \\beta x$$', section: '方法' },
    { kind: 'paragraph', text: 'x'.repeat(5000), section: '结果', page: 2 },
  ]);
  assert.equal(chunks[0].text, '方法\n随机分组。\n\n双盲。');
  assert.equal(chunks[1].kind, 'equation');
  assert.equal(chunks.filter((c) => c.section === '结果').length, 3, 'long text is split at MAX_CHARS');
  assert.equal(chunks.at(-1).page, 2);
});

test('ingest, search, read and cite across markdown, LaTeX and CSV', async () => {
  const f = await fixture();
  try {
    await f.add('r-md', 'study.md', '# 间歇性禁食研究\n\n## 方法\n\n跑步社招募 38 名志愿者，未随机分组。\n\n## 结果\n\n空腹胰岛素 p=0.041，CRP p=0.048。\n');
    await f.add('r-tex', 'model.tex', '\\documentclass{article}\\title{Insulin Model}\\author{Ada Lovelace \\and Alan Turing}\n\\begin{document}\n\\begin{abstract}A minimal model of insulin sensitivity.\\end{abstract}\n\\section{Model}\nWe define sensitivity as\n\\begin{equation}\nS_I = \\frac{\\Delta G}{\\Delta I}\n\\end{equation}\n% hidden comment\nwhere \\emph{G} is glucose.\n\\end{document}\n');
    await f.add('r-csv', 'data.csv', 'id,group,insulin\n1,IF,8.1\n2,control,9.4\n');
    await f.add('r-pdf', 'paper.pdf', '%PDF-1.4 not parsed yet');
    const sync = await f.rb.ingest.syncResources({ projectId: 'p1' });
    await sync.done;
    const sources = f.rb.store.listSources({ projectId: 'p1' });
    const byTitle = Object.fromEntries(sources.map((s) => [s.resourceId, s]));
    assert.equal(byTitle['r-md'].contentStatus, 'parsed');
    assert.equal(byTitle['r-md'].title, '间歇性禁食研究', 'markdown H1 becomes the title');
    assert.equal(byTitle['r-tex'].title, 'Insulin Model');
    assert.deepEqual(byTitle['r-tex'].authors.map((a) => a.literal), ['Ada Lovelace', 'Alan Turing']);
    assert.match(byTitle['r-tex'].abstract, /minimal model/);
    assert.equal(byTitle['r-pdf'].contentStatus, 'unsupported', 'PDF waits for the T04 parser');
    assert.deepEqual(sources.map((s) => s.label).sort(), ['S1', 'S2', 'S3', 'S4']);

    const hits = f.rb.retrieval.search({ query: '随机', projectId: 'p1' });
    assert.equal(hits[0].ref.type, 'chunk');
    assert.match(hits[0].cite, /^\[S\d\]$/u);
    assert.match(hits[0].snippet, /未随机分组/);
    assert.equal(hits[0].section, '间歇性禁食研究 > 方法');
    const tex = f.rb.retrieval.search({ query: 'frac Delta', projectId: 'p1' });
    assert.match(tex[0].snippet, /\\frac\{\\Delta G\}/u, 'LaTeX math is kept verbatim');
    assert.doesNotMatch(f.rb.retrieval.read({ ref: { type: 'source', id: byTitle['r-tex'].id } }).text, /hidden comment/);
    assert.equal(f.rb.retrieval.search({ query: '随机', projectId: 'other', includePersonal: false }).length, 0, 'other projects are not searched');

    const read = f.rb.retrieval.read({ ref: hits[0].ref });
    assert.match(read.text, /未随机分组[\s\S]*p=0\.041/);
    const cite = f.rb.retrieval.resolveCitation(hits[0].cite, { projectId: 'p1' });
    assert.equal(cite.ref.type, 'source');
  } finally { await f.close(); }
});

test('memory items: supersession, brief budget, visibility and proposals with evidence', async () => {
  const f = await fixture();
  try {
    const { store, retrieval } = f.rb;
    const pref = store.createItem({ type: 'memory', subtype: 'preference', scope: 'personal', title: '统计报告', body: '效应量须附 95% CI。', importance: 5 });
    const goal = store.createItem({ type: 'memory', subtype: 'goal', projectId: 'p1', title: '研究问题', body: 'IF 是否改善年轻人胰岛素敏感性' });
    const decision = store.createItem({ type: 'memory', subtype: 'decision', projectId: 'p1', title: '主要终点', body: '以 HOMA-IR 为主要终点' });
    const secret = store.createItem({ type: 'memory', subtype: 'preference', projectId: 'p1', title: '私人备注', body: '导师偏好', visibility: 'private' });
    const lesson = store.createItem({ type: 'memory', subtype: 'lesson', scope: 'expert:statistician', projectId: 'p1', title: '先查多重比较', body: '24 项检验需校正' });

    const { item: next, superseded } = store.supersedeItem(decision.id, { title: '主要终点', body: '改为 Matsuda 指数' });
    assert.equal(superseded.status, 'superseded'); assert.equal(superseded.supersededBy, next.id); assert.ok(superseded.validTo);
    assert.equal(store.linksOf({ type: 'item', id: next.id }, { relation: 'supersedes' }).length, 1);

    const brief = retrieval.brief({ projectId: 'p1' });
    assert.match(brief.text, /### 用户偏好与背景\n- 统计报告：效应量须附 95% CI。 \[@[0-9a-f]{8}\]/u);
    assert.match(brief.text, /改为 Matsuda 指数/); assert.doesNotMatch(brief.text, /HOMA-IR/, 'superseded decisions leave the brief');
    assert.doesNotMatch(brief.text, /导师偏好/, 'private items never reach agents');
    assert.doesNotMatch(brief.text, /先查多重比较/, 'expert lessons only for that expert');
    assert.match(retrieval.brief({ projectId: 'p1', expertId: 'statistician' }).text, /先查多重比较/);
    assert.ok(retrieval.brief({ projectId: 'p1', budget: 60 }).text.length < 400, 'brief respects its budget');
    assert.equal(retrieval.search({ query: '导师', projectId: 'p1', audience: 'agent' }).length, 0);
    assert.equal(retrieval.search({ query: '导师', projectId: 'p1', audience: 'user' }).length, 1);
    assert.equal(retrieval.search({ query: 'HOMA', projectId: 'p1' }).length, 0);
    assert.equal(retrieval.search({ query: 'HOMA', projectId: 'p1', includeSuperseded: true })[0].item.status, 'superseded');

    // Agent write path: proposal → user decision → item + evidence links.
    const model = { type: 'model', subtype: 'formula', title: '胰岛素敏感性', body: '最小模型', payload: { latex: 'S_I = \\frac{\\Delta G}{\\Delta I}', variables: [{ symbol: 'S_I', meaning: '敏感性' }] } };
    const out = await f.rb.toolCall('research_propose', { op: 'create', item: model, evidence: [{ ref: { type: 'item', id: goal.id }, relation: 'about' }], rationale: '讨论中确定' }, { projectId: 'p1', role: 'expert', expertId: 'statistician', chatId: 'c1' });
    assert.equal(out.status, 'awaiting_user_review');
    assert.equal((await f.rb.toolCall('research_propose', { op: 'create', item: model, evidence: [{ ref: { type: 'item', id: goal.id }, relation: 'about' }], rationale: '讨论中确定' }, { projectId: 'p1' })).duplicate, true);
    await assert.rejects(f.rb.toolCall('research_propose', { op: 'create', item: { type: 'model', title: 'x', payload: { variables: 'no' } } }, { projectId: 'p1' }), /variables/);
    assert.equal(retrieval.search({ query: '最小模型', projectId: 'p1', docTypes: ['item'] }).length, 0, 'a proposal is not knowledge yet');
    const personal = await f.rb.toolCall('research_propose', { op: 'create', item: { type: 'memory', subtype: 'convention', scope: 'project', title: '采血时间', body: '早上 8 点空腹' }, evidence: [{ cite: `[@${goal.id.slice(4, 12)}]`, relation: 'about' }], rationale: '用户要求' }, { projectId: null });
    const personalProposal = store.getProposal(personal.proposalId);
    assert.equal(personalProposal.payload.item.scope, 'personal'); assert.match(personal.note, /no project/);
    assert.deepEqual(personalProposal.payload.evidence[0].ref, { type: 'item', id: goal.id }, 'evidence may be given as a cite label');
    const decided = store.decide(out.proposalId, { accept: true, edits: { item: { title: '胰岛素敏感性（最小模型）' } } });
    const created = store.getItem(decided.resultId);
    assert.equal(created.title, '胰岛素敏感性（最小模型）'); assert.equal(created.createdBy, 'agent:expert:statistician'); assert.equal(created.origin.proposalId, out.proposalId);
    assert.equal(store.linksOf({ type: 'item', id: created.id }, { direction: 'in' })[0].relation, 'about');
    assert.throws(() => store.decide(out.proposalId, { accept: true }), /已经处理/);
    const found = await f.rb.toolCall('research_search', { query: 'frac Delta' }, { projectId: 'p1', chatId: 'c1', messageId: 'm1' });
    assert.equal(found.hits[0].ref.id, created.id, 'formula LaTeX is searchable');
    assert.deepEqual(store.usageOf('c1', 'm1').map((u) => u.how), ['search']);
    const readItem = await f.rb.toolCall('research_read', { cite: found.hits[0].cite }, { projectId: 'p1' });
    assert.equal(readItem.payload.latex, 'S_I = \\frac{\\Delta G}{\\Delta I}');

    // Optimistic edit guard and revisions.
    const edited = store.updateItem(goal.id, { body: '改：IF 对胰岛素敏感性的影响', expectedRevision: 1 });
    assert.equal(edited.revision, 2); assert.throws(() => store.updateItem(goal.id, { body: 'x', expectedRevision: 1 }), /已被修改/);
    assert.equal(store.revisionsOf(goal.id)[0].snapshot.body, 'IF 是否改善年轻人胰岛素敏感性');
  } finally { await f.close(); }
});

test('legacy knowledge rows are mirrored once into research items', async () => {
  const f = await fixture();
  try {
    await f.add('r1', 'a.md', '# A\n\ntext');
    f.database.proposeKnowledge({ id: 'k1', namespace: 'canonical', projectId: 'p1', title: '旧知识', content: '内容', sourceIds: ['r1'] });
    f.database.acceptKnowledge('k1');
    assert.equal(f.rb.syncLegacyKnowledge(), 1);
    assert.equal(f.rb.syncLegacyKnowledge(), 0);
    const [item] = f.rb.store.listItems({ projectId: 'p1', type: 'knowledge' });
    assert.equal(item.legacyId, 'k1'); assert.equal(item.status, 'active');
  } finally { await f.close(); }
});
