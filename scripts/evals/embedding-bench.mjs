// Retrieval benchmark: keyword (Research Base FTS) vs dense (multilingual-e5-large
// via onnxruntime-node) vs hybrid RRF, single-language and bilingual queries,
// plus CPU speed and memory. Run from .sciencescope-local/bench after
//   npm i --ignore-scripts onnxruntime-node@1.30.0 @huggingface/transformers@4.3.0
// with the model in .sciencescope-local/models/<dir> (see RESEARCH_BASE.md §3):
//   node scripts/evals/embedding-bench.mjs e5-large-int8 <threads>   (cwd = .sciencescope-local/bench)
// The 15-question set is tiny and hand-written; it shows direction, not accuracy.
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import * as ort from 'onnxruntime-node';
import { AutoTokenizer, env } from '@huggingface/transformers';

const repo = path.resolve('../../'); // cwd is .sciencescope-local/bench
const { openApplicationDatabaseSync } = await import(path.join(repo, 'scripts/application-database.mjs'));
const { createResearchStore } = await import(path.join(repo, 'scripts/research-base/store.mjs'));
const { createResearchSearch } = await import(path.join(repo, 'scripts/research-base/search.mjs'));

const modelDir = process.argv[2] || 'e5-large-int8';
const threads = Number(process.argv[3] || os.cpus().length);
env.localModelPath = path.resolve('../models'); env.allowRemoteModels = false;

const passages = [
  ['p1', 'Time-restricted eating for 12 weeks improved insulin sensitivity, with HOMA-IR decreasing by 0.6 compared with the control diet.'],
  ['p2', '志愿者来自学校跑步社，对照组是没有参加社团的学生，两组在入组前的日常运动量就存在明显差别。'],
  ['p3', '本研究共检验了 24 项血液指标，但没有对多次检验进行校正；按 Bonferroni 方法，显著性阈值应为 0.0021。'],
  ['p4', 'The Matsuda index is defined as ISI = 10000 / sqrt(G0 · I0 · mean(G) · mean(I)), using fasting and OGTT mean glucose and insulin.'],
  ['p5', 'Fasting insulin shows marked circadian variation; samples drawn at different times of day can differ by more than 20%.'],
  ['p6', '若要以 80% 的检验效能检出 d=0.45 的效应，每组大约需要 155 名受试者。'],
  ['p7', 'Serum C-reactive protein fell from 2.1 to 1.6 mg/L in the intervention arm.'],
  ['p8', '采用计算机生成的随机序列分组，分配方案装在不透明密封信封中，由不参与招募的人员保管。'],
  ['p9', 'Habitual physical activity is strongly associated with both insulin action and inflammatory markers, and must be treated as a confounder.'],
  ['p10', '空腹胰岛素的组间差异 d≈0.47，95% 置信区间为 0.02 到 0.92，区间下限接近零。'],
  ['p11', 'One night of total sleep deprivation impaired working memory accuracy on the n-back task.'],
  ['p12', '口服葡萄糖耐量试验在 0、30、60、90、120 分钟采血，计算各时间点血糖和胰岛素的平均值。'],
  // distractors
  ['d1', 'The study was approved by the university ethics committee and all participants gave written consent.'],
  ['d2', '实验室温度保持在 22 摄氏度，所有样本在 -80 摄氏度保存。'],
  ['d3', 'Participants were asked to keep a food diary for three days before each visit.'],
  ['d4', '数据使用 R 4.3 进行分析，显著性水平设为 0.05。'],
  ['d5', 'Body mass index was calculated as weight in kilograms divided by height in metres squared.'],
  ['d6', '受试者在每次随访前 48 小时内避免饮酒和剧烈运动。'],
  ['d7', 'Glycated haemoglobin (HbA1c) did not change significantly over the trial.'],
  ['d8', '问卷采用李克特五点量表，内部一致性 Cronbach α 为 0.86。'],
  ['d9', 'A mixed-effects model with random intercepts for participants was fitted to repeated measures.'],
  ['d10', '跑步社每周组织三次训练，每次约 60 分钟。'],
  ['d11', 'Insulin was measured by chemiluminescent immunoassay with an intra-assay CV of 4%.'],
  ['d12', '本研究的局限在于样本量较小，且随访时间只有 6 周。'],
];
const translations = {
  '禁食对胰岛素敏感性有什么影响': 'effect of fasting on insulin sensitivity',
  '为什么两组不可比': 'why the two groups are not comparable',
  'multiple comparison correction': '多重比较校正',
  'how is the Matsuda index computed': 'Matsuda 指数 如何计算',
  '采血时间不同会带来什么偏差': 'bias from different blood sampling times',
  'sample size and statistical power': '样本量与检验效能',
  '炎症指标的变化': 'change in inflammatory markers',
  'randomisation and allocation concealment': '随机分组与分配隐藏',
  '运动是否是混杂因素': 'is physical activity a confounder',
  'effect size with confidence interval': '效应量与置信区间',
  '睡眠不足对记忆的影响': 'effect of sleep loss on memory',
  'OGTT 取样时间点': 'OGTT sampling time points',
  '选择偏倚': 'selection bias',
  '假阳性风险': 'risk of false positives',
  '昼夜节律': 'circadian rhythm',
};
const queries = [
  ['禁食对胰岛素敏感性有什么影响', 'p1', 'cross-lingual'],
  ['为什么两组不可比', 'p2', 'paraphrase'],
  ['multiple comparison correction', 'p3', 'cross-lingual'],
  ['how is the Matsuda index computed', 'p4', 'keyword'],
  ['采血时间不同会带来什么偏差', 'p5', 'cross-lingual'],
  ['sample size and statistical power', 'p6', 'cross-lingual'],
  ['炎症指标的变化', 'p7', 'cross-lingual'],
  ['randomisation and allocation concealment', 'p8', 'cross-lingual'],
  ['运动是否是混杂因素', 'p9', 'cross-lingual'],
  ['effect size with confidence interval', 'p10', 'cross-lingual'],
  ['睡眠不足对记忆的影响', 'p11', 'cross-lingual'],
  ['OGTT 取样时间点', 'p12', 'keyword'],
  ['选择偏倚', 'p2', 'paraphrase'],
  ['假阳性风险', 'p3', 'paraphrase'],
  ['昼夜节律', 'p5', 'cross-lingual'],
];

// ---- dense encoder ----
const t0 = Date.now();
const tokenizer = await AutoTokenizer.from_pretrained(path.basename(modelDir === 'e5-large-int8' ? 'e5-large-int8' : 'fast-multilingual-e5-large'));
const session = await ort.InferenceSession.create(path.resolve('../models', modelDir, 'model.onnx'), { intraOpNumThreads: threads, interOpNumThreads: 1, graphOptimizationLevel: 'all' });
const loadMs = Date.now() - t0;
async function embed(texts, maxLength = 512) {
  const enc = await tokenizer(texts, { padding: true, truncation: true, max_length: maxLength });
  const feeds = { input_ids: new ort.Tensor('int64', enc.input_ids.data, enc.input_ids.dims), attention_mask: new ort.Tensor('int64', enc.attention_mask.data, enc.attention_mask.dims) };
  if (session.inputNames.includes('token_type_ids')) feeds.token_type_ids = new ort.Tensor('int64', new BigInt64Array(enc.input_ids.data.length), enc.input_ids.dims);
  const out = await session.run(feeds);
  const hidden = out[session.outputNames[0]]; const [b, n, d] = hidden.dims; const mask = enc.attention_mask.data;
  const vectors = [];
  for (let i = 0; i < b; i++) {
    const v = new Float32Array(d); let count = 0;
    for (let t = 0; t < n; t++) if (mask[i * n + t]) { count++; for (let k = 0; k < d; k++) v[k] += hidden.data[(i * n + t) * d + k]; }
    let norm = 0; for (let k = 0; k < d; k++) { v[k] /= count; norm += v[k] * v[k]; } norm = Math.sqrt(norm);
    for (let k = 0; k < d; k++) v[k] /= norm; vectors.push(v);
  }
  return { vectors, tokens: enc.attention_mask.dims[1] };
}
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// ---- speed ----
const sample = passages[2][1].repeat(8); // long Chinese text → truncated to 512 tokens
const speed = {};
for (const [label, texts, max] of [['1×~40 tokens (query)', ['query: 禁食对胰岛素敏感性有什么影响'], 64], ['8×256 tokens', Array(8).fill('passage: ' + sample), 256], ['8×512 tokens', Array(8).fill('passage: ' + sample), 512]]) {
  await embed(texts, max);
  const runs = []; for (let i = 0; i < 3; i++) { const s = performance.now(); await embed(texts, max); runs.push(performance.now() - s); }
  runs.sort((a, b) => a - b); speed[label] = { msPerBatch: Math.round(runs[1]), msPerText: Math.round(runs[1] / texts.length) };
}
const rssMb = Math.round(process.memoryUsage().rss / 1048576);

// ---- quality ----
const passageVecs = (await embed(passages.map(([, t]) => 'passage: ' + t))).vectors;
const base = path.resolve('../temp'); const dir = await mkdtemp(path.join(base, 'bench-'));
const database = openApplicationDatabaseSync({ stateDir: dir });
const store = createResearchStore({ db: database.db }); const search = createResearchSearch({ store });
const source = store.addSource({ title: 'bench', kind: 'file' });
store.replaceChunks(source.id, passages.map(([, text]) => ({ text })));
const chunkId = (i) => `${source.id}-c${i}`;
const idOf = Object.fromEntries(passages.map(([id], i) => [chunkId(i), id]));
const rank = { keyword: [], dense: [], hybrid: [], keywordBilingual: [], denseBilingual: [], hybridBilingual: [] };
for (const [q, gold, kind] of queries) {
  const kw = search.search({ query: q, docTypes: ['chunk'], k: 10 }).map((h) => idOf[h.ref.id]);
  const qv = (await embed(['query: ' + q])).vectors[0];
  const dense = passages.map(([id], i) => [id, dot(qv, passageVecs[i])]).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const scores = new Map();
  kw.forEach((id, r) => scores.set(id, (scores.get(id) || 0) + 1 / (60 + r)));
  dense.slice(0, 10).forEach((id, r) => scores.set(id, (scores.get(id) || 0) + 1 / (60 + r)));
  const hybrid = [...scores].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  // Bilingual: the same question in both languages (as a cheap LLM would rewrite it).
  const t = translations[q];
  const kw2 = search.search({ query: t, docTypes: ['chunk'], k: 10 }).map((h) => idOf[h.ref.id]);
  const tv = (await embed(['query: ' + t])).vectors[0];
  const dense2 = passages.map(([id], i) => [id, Math.max(dot(qv, passageVecs[i]), dot(tv, passageVecs[i]))]).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const s2 = new Map(); const add = (list, n) => list.slice(0, n).forEach((id, r) => s2.set(id, (s2.get(id) || 0) + 1 / (60 + r)));
  add(kw, 10); add(kw2, 10); add(dense2, 10);
  const hybrid2 = [...s2].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const kwBoth = [...new Set([...kw, ...kw2])];
  if (process.env.DEBUG) console.log(q, 'gold', gold, 'dense top3', dense.slice(0,3).join(','), 'pos', dense.indexOf(gold));
  for (const [name, list] of [['keyword', kw], ['dense', dense], ['hybrid', hybrid], ['keywordBilingual', kwBoth], ['denseBilingual', dense2], ['hybridBilingual', hybrid2]]) rank[name].push({ q, kind, pos: list.indexOf(gold) });
}
const summary = Object.fromEntries(Object.entries(rank).map(([name, rows]) => [name, { 'R@1': rows.filter((r) => r.pos === 0).length, 'R@3': rows.filter((r) => r.pos >= 0 && r.pos < 3).length, miss: rows.filter((r) => r.pos < 0).map((r) => r.q) }]));
database.close(); await rm(dir, { recursive: true, force: true });
console.log(JSON.stringify({ model: modelDir, threads, loadMs, rssMb, speed, queries: queries.length, summary }, null, 1));
