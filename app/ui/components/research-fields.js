import { html } from '../html.js';
import { t } from '../i18n/index.js';

export const researchTabs = {
  sources: '文献与资料',
  knowledge: '知识',
  model: '模型与公式',
  claim: '主张与证据',
  memory: '记忆',
  inbox: '记忆收件箱',
  brief: '项目简报',
};
export const researchSubtypes = {
  knowledge: ['finding', 'definition', 'method', 'fact', 'dataset-note', 'other'],
  model: ['theory', 'formula', 'algorithm', 'statistical-model', 'protocol'],
  claim: ['hypothesis', 'claim', 'conclusion'],
  memory: [
    'goal',
    'decision',
    'convention',
    'preference',
    'open-question',
    'lesson',
    'episode',
    'profile',
  ],
};
export const sourceKinds = [
  'paper',
  'preprint',
  'book',
  'chapter',
  'thesis',
  'report',
  'webpage',
  'dataset',
  'software',
  'file',
  'note',
];
const names = {
  goal: '目标',
  decision: '决定',
  convention: '约定',
  preference: '偏好',
  'open-question': '未决问题',
  lesson: '经验',
  episode: '阶段摘要',
  profile: '背景',
  proposed: '待确认',
  rejected: '已拒绝',
  finding: '研究发现',
  definition: '定义',
  method: '方法',
  fact: '事实',
  'dataset-note': '数据说明',
  other: '其他',
  theory: '理论',
  formula: '公式',
  algorithm: '算法',
  'statistical-model': '统计模型',
  protocol: '研究方案',
  hypothesis: '假设',
  claim: '主张',
  conclusion: '结论',
  active: '有效',
  archived: '已归档',
  superseded: '已取代',
  unread: '未读',
  reading: '阅读中',
  read: '已读',
  none: '未解析',
  queued: '等待解析',
  parsed: '已解析',
  partial: '部分解析',
  failed: '解析失败',
  unsupported: '不支持',
  paper: '论文',
  preprint: '预印本',
  book: '书籍',
  chapter: '章节',
  thesis: '学位论文',
  report: '报告',
  webpage: '网页',
  dataset: '数据集',
  software: '软件',
  file: '文件',
  note: '笔记',
  supported: '有证据支持',
  contested: '有争议',
  refuted: '已反驳',
  uncertain: '不确定',
  retracted: '已撤回',
};
/** @param {string} value */
export const researchLabel = (value) => (names[value] ? t(names[value]) : value || '—');
/** @param {any} authors */
export const authorText = (authors = []) =>
  (Array.isArray(authors) ? authors : [authors])
    .map((author) =>
      typeof author === 'string'
        ? author
        : author.literal || [author.given, author.family].filter(Boolean).join(' '),
    )
    .join('; ');
/** @param {{label:string,name:string,value?:any,textarea?:boolean,required?:boolean}} props */
export function ResearchField({ label, name, value = '', textarea = false, required = false }) {
  return html`<label class="field"
    >${t(label)}${textarea ? html`<textarea name=${name} aria-label=${t(label)} rows="5" defaultValue=${value} required=${required}></textarea>` : html`<input name=${name} aria-label=${t(label)} defaultValue=${value ?? ''} required=${required} />`}</label
  >`;
}
/** @param {{label:string,name:string,value:any,options:any[]}} props */
export function ResearchSelect({ label, name, value, options }) {
  return html`<label class="field"
    >${t(label)}<select name=${name} aria-label=${t(label)} defaultValue=${value}>
      ${options.map((entry) => {
        const [key, title] = Array.isArray(entry) ? entry : [entry, researchLabel(entry)];
        return html`<option value=${key}>${title}</option>`;
      })}
    </select></label
  >`;
}
/** @param {{text:string,query:string}} props */
export function ResearchHighlight({ text, query }) {
  const terms = query
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!terms.length) return text;
  const pattern = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return String(text)
    .split(new RegExp('(' + pattern + ')', 'giu'))
    .map((part, index) => (index % 2 ? html`<mark>${part}</mark>` : part));
}
