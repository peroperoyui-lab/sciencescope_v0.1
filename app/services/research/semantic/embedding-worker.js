import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import * as ort from 'onnxruntime-node';
import { AutoTokenizer, env } from '@huggingface/transformers';

const modelDir = path.resolve(workerData.modelDir);
const maxTokens = Math.min(512, Math.max(1, Number(workerData.maxTokens) || 512));
let tokenizer;
let session;
let loadPromise;
let tail = Promise.resolve();

async function load() {
  if (session && tokenizer) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.cacheDir = path.join(modelDir, '.cache');
    env.useBrowserCache = false;
    env.localModelPath = `${modelDir}${path.sep}`;
    if (env.backends?.onnx) env.backends.onnx.logLevel = 'error';
    tokenizer = await AutoTokenizer.from_pretrained(modelDir, { local_files_only: true });
    session = await ort.InferenceSession.create(
      path.join(modelDir, 'onnx', 'model_quantized.onnx'),
      {
        intraOpNumThreads: 2,
        interOpNumThreads: 1,
        graphOptimizationLevel: 'all',
      },
    );
  })().catch((error) => {
    loadPromise = null;
    throw error;
  });
  return loadPromise;
}

async function embed(texts) {
  await load();
  const encoded = await tokenizer(texts, {
    padding: true,
    truncation: true,
    max_length: maxTokens,
  });
  const feeds = {
    input_ids: new ort.Tensor('int64', encoded.input_ids.data, encoded.input_ids.dims),
    attention_mask: new ort.Tensor(
      'int64',
      encoded.attention_mask.data,
      encoded.attention_mask.dims,
    ),
  };
  if (session.inputNames.includes('token_type_ids'))
    feeds.token_type_ids = new ort.Tensor(
      'int64',
      new BigInt64Array(encoded.input_ids.data.length),
      encoded.input_ids.dims,
    );
  const output = await session.run(feeds);
  const hidden = output[session.outputNames[0]];
  const [batchSize, sequenceLength, dimensions] = hidden.dims;
  const mask = encoded.attention_mask.data;
  const vectors = [];
  for (let batch = 0; batch < batchSize; batch += 1) {
    const vector = new Float32Array(dimensions);
    let tokenCount = 0;
    for (let token = 0; token < sequenceLength; token += 1) {
      if (!mask[batch * sequenceLength + token]) continue;
      tokenCount += 1;
      const start = (batch * sequenceLength + token) * dimensions;
      for (let dimension = 0; dimension < dimensions; dimension += 1)
        vector[dimension] += hidden.data[start + dimension];
    }
    let norm = 0;
    for (let dimension = 0; dimension < dimensions; dimension += 1) {
      vector[dimension] /= tokenCount || 1;
      norm += vector[dimension] * vector[dimension];
    }
    norm = Math.sqrt(norm);
    if (!Number.isFinite(norm) || norm === 0)
      throw Object.assign(new Error('Embedding output cannot be normalized.'), {
        code: 'EMBEDDING_INVALID_VECTOR',
      });
    for (let dimension = 0; dimension < dimensions; dimension += 1) vector[dimension] /= norm;
    vectors.push(vector);
  }
  return vectors;
}

async function handle(message) {
  if (message.type === 'warmup') {
    await embed(['query: warmup']);
    return { ready: true };
  }
  if (message.type === 'embed') {
    if (
      !Array.isArray(message.texts) ||
      message.texts.length > 8 ||
      message.texts.some((text) => typeof text !== 'string')
    ) {
      throw Object.assign(new Error('Embedding worker received an invalid batch.'), {
        code: 'INVALID_EMBEDDING_BATCH',
      });
    }
    return { vectors: await embed(message.texts) };
  }
  throw Object.assign(new Error('Unknown embedding worker request.'), {
    code: 'INVALID_EMBEDDING_REQUEST',
  });
}

parentPort.on('message', (message) => {
  tail = tail.then(async () => {
    try {
      parentPort.postMessage({ id: message.id, result: await handle(message) });
    } catch (error) {
      parentPort.postMessage({
        id: message.id,
        error: {
          code: error?.code || 'EMBEDDING_FAILED',
          message: String(error?.message ?? error),
        },
      });
    }
  });
});
