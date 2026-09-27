// Local-only Stage 3 dense benchmark.  This is intentionally separate from
// the production retrieval path: it embeds the frozen corpus/query set and
// ranks by cosine similarity only (no hybrid/RRF/keyword fusion).
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { validateFrozenMapping, recallAt, APPROVED_GOLD_SHA256, PAPER_DENOMINATOR } from './real-corpus-retrieval.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const benchDir = path.join(repo, '.sciencescope-local', 'bench');
const modelDir = path.join(repo, '.sciencescope-local', 'models', 'multilingual-e5-small');
const defaultOut = path.join(repo, '.sciencescope-local', 'temp', 'local-validation-r4', 'final-eval');
const defaultGold = path.join(repo, 'tests', 'fixtures', 'retrieval-eval', 'gold.json');
const defaultMapping = path.join(defaultOut, 'mapping-frozen.json');
const setupSmokeOut = path.join(repo, '.sciencescope-local', 'temp', 'local-validation-r4', 'dense-setup-smoke.json');
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const isDirect = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

function options(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { out.help = true; continue; }
    if (arg.startsWith('--')) { const key = arg.slice(2); out[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; continue; }
    out._.push(arg);
  }
  return out;
}

function usage() {
  return `Usage:
  node scripts/evals/real-corpus-dense.mjs setup-smoke
  node scripts/evals/real-corpus-dense.mjs dense [--out DIR] [--mapping FILE] [--gold FILE]

Local-only: requires the pinned model under .sciencescope-local/models and
isolated .sciencescope-local/bench dependencies. No model download is allowed.
`;
}

function l2Normalize(values) {
  let norm = 0; for (const value of values) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return Float32Array.from(values, (value) => value / norm);
}

function cosine(a, b) {
  let score = 0; for (let i = 0; i < a.length; i += 1) score += a[i] * b[i];
  return score;
}

function peakSampler() {
  let peak = process.memoryUsage().rss;
  let timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 25);
  timer.unref?.();
  return { read: () => { peak = Math.max(peak, process.memoryUsage().rss); clearInterval(timer); return peak; } };
}

async function ensureLocalModel() {
  const manifest = JSON.parse(await readFile(path.join(modelDir, 'download-manifest.json'), 'utf8'));
  if (!manifest.modelId || !manifest.revision) throw new Error('Local embedding model manifest is incomplete');
  for (const file of manifest.files ?? []) await stat(path.join(modelDir, ...file.path.split('/')));
  const quantized = path.join(modelDir, 'onnx', 'model_quantized.onnx');
  await stat(quantized);
  return manifest;
}

async function loadEmbedder() {
  const manifest = await ensureLocalModel();
  const require = createRequire(path.join(benchDir, 'package.json'));
  const { AutoTokenizer, env } = require('@huggingface/transformers');
  const ort = require('onnxruntime-node');
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = `${modelDir}${path.sep}`;
  env.backends.onnx.logLevel = 'error';
  const tokenizer = await AutoTokenizer.from_pretrained(modelDir);
  const session = await ort.InferenceSession.create(path.join(modelDir, 'onnx', 'model_quantized.onnx'), { intraOpNumThreads: 2, interOpNumThreads: 1, graphOptimizationLevel: 'all' });
  return { tokenizer, session, ort, manifest };
}

async function embedBatch(embedder, texts) {
  const enc = await embedder.tokenizer(texts, { padding: true, truncation: true, max_length: 512 });
  const feeds = {
    input_ids: new embedder.ort.Tensor('int64', enc.input_ids.data, enc.input_ids.dims),
    attention_mask: new embedder.ort.Tensor('int64', enc.attention_mask.data, enc.attention_mask.dims),
  };
  if (embedder.session.inputNames.includes('token_type_ids')) feeds.token_type_ids = new embedder.ort.Tensor('int64', new BigInt64Array(enc.input_ids.data.length), enc.input_ids.dims);
  const result = await embedder.session.run(feeds);
  const hidden = result[embedder.session.outputNames[0]];
  const [batchSize, sequenceLength, hiddenSize] = hidden.dims;
  const output = [];
  for (let batchIndex = 0; batchIndex < batchSize; batchIndex += 1) {
    const pooled = new Float32Array(hiddenSize); let count = 0;
    for (let tokenIndex = 0; tokenIndex < sequenceLength; tokenIndex += 1) {
      if (!enc.attention_mask.data[batchIndex * sequenceLength + tokenIndex]) continue;
      count += 1;
      const start = (batchIndex * sequenceLength + tokenIndex) * hiddenSize;
      for (let dimension = 0; dimension < hiddenSize; dimension += 1) pooled[dimension] += hidden.data[start + dimension];
    }
    for (let dimension = 0; dimension < hiddenSize; dimension += 1) pooled[dimension] /= count || 1;
    output.push(l2Normalize(pooled));
  }
  return output;
}

async function embedTexts(embedder, texts, batchSize = 8) {
  const output = [];
  const batches = [];
  for (let offset = 0; offset < texts.length; offset += batchSize) {
    const batch = texts.slice(offset, offset + batchSize);
    const startedAt = performance.now();
    output.push(...await embedBatch(embedder, batch));
    const durationMs = performance.now() - startedAt;
    batches.push({ offset, count: batch.length, durationMs, meanPerTextMs: durationMs / batch.length });
  }
  return { vectors: output, batches };
}

function rankChunks(chunkVectors, queryVector) {
  return chunkVectors.map((row) => ({ chunkId: row.chunkId, score: cosine(row.vector, queryVector) })).sort((a, b) => b.score - a.score);
}

function metrics(rows, denominator = PAPER_DENOMINATOR) {
  return Object.fromEntries([1, 5, 10].map((k) => [`r${k}`, rows.filter((row) => recallAt(row.rankedChunkIds, row.expectedChunkIds, k)).length / denominator]));
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

export async function main(argv = process.argv.slice(2)) {
  const args = options(argv);
  if (args.help) { console.log(usage()); return; }
  if (args._[0] === 'setup-smoke') {
    const embedder = await loadEmbedder();
    try {
      const startedAt = performance.now();
      const smoke = (await embedTexts(embedder, ['query: ScienceScope local embedding setup smoke'], 1)).vectors[0];
      let norm = 0; for (const value of smoke) norm += value * value;
      const result = { setup: true, modelId: embedder.manifest.modelId, revision: embedder.manifest.revision, dimensions: smoke.length, finite: [...smoke].every(Number.isFinite), l2Norm: Math.sqrt(norm), durationMs: performance.now() - startedAt, noNetwork: true };
      await mkdir(path.dirname(setupSmokeOut), { recursive: true });
      await writeFile(setupSmokeOut, json(result), 'utf8');
      console.log(JSON.stringify({ out: setupSmokeOut, ...result }));
    } finally { await embedder.session.release?.(); }
    return;
  }
  if (args._[0] !== 'dense') { console.log(usage()); return; }
  const out = path.resolve(repo, args.out ?? defaultOut);
  const goldPath = path.resolve(repo, args.gold ?? defaultGold);
  const mappingPath = path.resolve(repo, args.mapping ?? defaultMapping);
  const [goldBytes, mapping, chunksFile] = await Promise.all([readFile(goldPath), readFile(mappingPath, 'utf8'), readFile(path.join(out, 'chunks.json'), 'utf8')]);
  const goldSha256 = (await import('node:crypto')).createHash('sha256').update(goldBytes).digest('hex');
  if (goldSha256 !== APPROVED_GOLD_SHA256) throw new Error('Immutable approved gold SHA mismatch');
  const gold = JSON.parse(goldBytes);
  const frozen = JSON.parse(mapping);
  const papers = (gold.questions ?? []).filter((question) => question.category !== 'memory_synthetic');
  validateFrozenMapping(frozen, { goldSha256, questionIds: papers.map((question) => question.id) });
  const chunks = JSON.parse(chunksFile).chunks ?? [];
  if (!chunks.length) throw new Error('No prepared chunks found; run prepare first');
  const peak = peakSampler();
  const embedder = await loadEmbedder();
  try {
    const passageStart = performance.now();
    const passageResult = await embedTexts(embedder, chunks.map((chunk) => `passage: ${chunk.text}`), 8);
    const passageMs = performance.now() - passageStart;
    const chunkVectors = chunks.map((chunk, index) => ({ chunkId: chunk.chunkId, vector: passageResult.vectors[index] }));
    const queryVectors = { zh: [], en: [] }; const queryTimings = { zh: [], en: [] };
    for (const question of papers) {
      for (const language of ['zh', 'en']) {
        const startedAt = performance.now();
        const result = await embedTexts(embedder, [`query: ${question.query[language]}`], 1);
        queryVectors[language].push(result.vectors[0]);
        queryTimings[language].push(performance.now() - startedAt);
      }
    }
    const queryMs = queryTimings.zh.reduce((sum, value) => sum + value, 0) + queryTimings.en.reduce((sum, value) => sum + value, 0);
    const byQuestion = new Map(frozen.mapping.map((row) => [row.questionId, row]));
    const modes = {};
    for (const mode of ['zh', 'en', 'bilingual-maxcos']) {
      const rows = papers.map((question, index) => {
        const zh = queryVectors.zh[index]; const en = queryVectors.en[index];
        const ranked = chunkVectors.map((row) => ({ chunkId: row.chunkId, score: mode === 'zh' ? cosine(row.vector, zh) : mode === 'en' ? cosine(row.vector, en) : Math.max(cosine(row.vector, zh), cosine(row.vector, en)) })).sort((a, b) => b.score - a.score);
        return { questionId: question.id, expectedChunkIds: byQuestion.get(question.id).goldChunkIds, rankedChunkIds: ranked.slice(0, 10).map((row) => row.chunkId), topScores: ranked.slice(0, 10).map((row) => row.score) };
      });
      modes[mode] = { metrics: metrics(rows), rows };
    }
    const rssPeakBytes = peak.read();
    const result = {
    schema: 1,
    mode: 'dense',
    model: { id: embedder.manifest.modelId, revision: embedder.manifest.revision, directory: modelDir, onnx: 'onnx/model_quantized.onnx' },
    localOnly: true,
    noHybrid: true,
    preprocessing: { prefix: 'E5 query:/passage:', maxTokens: 512, pooling: 'mean', normalization: 'L2', batchSize: 8, cpuThreads: 2 },
    corpus: { chunkCount: chunks.length, paperDenominator: PAPER_DENOMINATOR },
    timingsMs: { passageEmbedding: passageMs, passageBatches: passageResult.batches, queryEmbedding: queryMs, query: { zh: { values: queryTimings.zh, p50: percentile(queryTimings.zh, 0.5), p95: percentile(queryTimings.zh, 0.95) }, en: { values: queryTimings.en, p50: percentile(queryTimings.en, 0.5), p95: percentile(queryTimings.en, 0.95) } } },
    rssPeakBytes,
    hardware: { platform: process.platform, arch: process.arch, cpuCount: os.cpus().length, cpuModel: os.cpus()[0]?.model ?? null, totalRamBytes: os.totalmem(), osVersion: os.version(), node: process.version },
    estimate500Papers: { formula: 'passageEmbeddingMs / chunkCount * (chunkCount / 8) * 500', estimatedMs: passageMs / chunks.length * (chunks.length / 8) * 500 },
    modes,
    };
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, 'dense-results.json'), json(result), 'utf8');
    console.log(JSON.stringify({ out, chunkCount: chunks.length, modes: Object.keys(modes), rssPeakBytes }));
  } finally { await embedder.session.release?.(); }
}

if (isDirect) main().catch((error) => { console.error(error.stack ?? error); process.exitCode = 1; });
