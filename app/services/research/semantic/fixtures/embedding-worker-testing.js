// Local protocol fixture: no tokenizer, model, inference library or network.
import { parentPort, workerData } from 'node:worker_threads';

const requests = [];
parentPort.on('message', (message) => {
  if (message.type === 'warmup') {
    if (!workerData.modelDir || workerData.maxTokens !== 32) process.exit(8);
    parentPort.postMessage({ id: message.id, result: {} });
    return;
  }
  requests.push(message);
  if (requests.length !== 2) return;
  if (requests.every((request) => request.texts[0].includes('exit-pending'))) process.exit(7);
  for (const request of requests.reverse())
    parentPort.postMessage({
      id: request.id,
      result: { vectors: request.texts.map((text) => [text.length]) },
    });
});
