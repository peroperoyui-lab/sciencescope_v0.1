import {
  RETRIEVAL_TOPICS,
  RETRIEVAL_DISTRACTORS,
  RETRIEVAL_QUESTIONS,
} from './retrieval-corpus.js';
import { createKnowledgeStore } from './store.js';

/**
 * Populate only a caller-owned temporary core. Every edge has evidence from the
 * synthetic passage; entity descriptions never substitute for a source citation.
 * @param {import('../../core/index.js').Core} core
 * @param {ReturnType<typeof import('../research/index.js').createResearch>} research
 * @returns {Promise<any>}
 */
export async function buildRetrievalFixture(core, research) {
  const graph = createKnowledgeStore(core);
  const sources = {};
  const entities = {};
  const hub = graph.createEntity({
    name: '回归分析',
    nameEn: 'Regression analysis',
    kind: 'method',
    description: '一般统计建模方法。',
  });
  for (const topic of RETRIEVAL_TOPICS) {
    const source = await research.importSource({
      name: topic.key + '.txt',
      title: topic.title,
      kind: 'paper',
      bytes: Buffer.from(topic.body),
    });
    sources[topic.key] = source.id;
    const chunk = research.store.chunks(source.id)[0];
    const evidence = [{ ref: 'chunk:' + chunk.id, quote: chunk.text, page: chunk.page }];
    const entity = graph.createEntity({
      name: topic.name,
      aliases: topic.aliases,
      kind: 'method',
      layer: 'extracted',
      evidence,
    });
    entities[topic.key] = entity.id;
    graph.createEdge({
      fromRef: 'source:' + source.id,
      toRef: 'entity:' + entity.id,
      relation: 'uses',
      layer: 'extracted',
      evidence,
    });
  }
  for (const [key, title, body] of RETRIEVAL_DISTRACTORS) {
    const source = await research.importSource({
      name: key + '.txt',
      title,
      kind: 'paper',
      bytes: Buffer.from(body),
    });
    sources[key] = source.id;
    const chunk = research.store.chunks(source.id)[0];
    graph.createEdge({
      fromRef: 'source:' + source.id,
      toRef: 'entity:' + hub.id,
      relation: 'describes',
      layer: 'extracted',
      evidence: [{ ref: 'chunk:' + chunk.id, quote: chunk.text, page: chunk.page }],
    });
  }
  for (const [title, body] of [
    ['记录：数据复现', '复现前记录数据版本和随机种子。'],
    ['Note: research protocols', 'Record the sampling protocol before collecting data.'],
    ['记录：文献检索', '保存检索式与检索日期。'],
    ['Note: visualization', 'Label axes with units and disclose missing observations.'],
  ])
    research.store.createItem({ type: 'note', subtype: 'summary', title, body });
  return {
    sources,
    entities,
    hub: hub.id,
    questions: RETRIEVAL_QUESTIONS.map((question) => ({
      ...question,
      correctIds: question.correct.map((key) => sources[key]),
    })),
  };
}
