// Names and icons for knowledge-base nodes and relations. Built-in keys get
// a Chinese name (and English through i18n); custom keys show as written.
import { t } from '../i18n/index.js';
import { researchLabel } from './research-fields.js';

export const entityKinds = [
  'method',
  'variant',
  'dataset',
  'variable',
  'metric',
  'software',
  'concept',
  'person',
  'org',
];
const kindNames = {
  method: '方法',
  variant: '变体',
  dataset: '数据集',
  variable: '变量',
  metric: '指标',
  software: '软件',
  concept: '概念',
  person: '人物',
  org: '机构',
  knowledge: '知识',
  model: '模型与公式',
  claim: '主张与证据',
  code: '代码',
  folder: '文件夹',
};
const kindIcons = {
  source: 'file-text',
  method: 'flask-conical',
  variant: 'git-branch',
  dataset: 'database',
  variable: 'variable',
  metric: 'sigma',
  software: 'package',
  concept: 'lightbulb',
  person: 'user',
  org: 'building-2',
  knowledge: 'book-marked',
  model: 'sigma',
  claim: 'scale',
  code: 'file-code',
  folder: 'folder',
};
const relationNames = {
  cites: '引用',
  proposes: '提出',
  implements: '实现',
  'variant-of': '变体自',
  uses: '使用',
  compares: '比较',
  'evaluates-on': '评测于',
  describes: '描述',
  supports: '支持',
  contradicts: '反驳',
  qualifies: '限定',
  defines: '定义',
  'part-of': '属于',
  'same-as': '等同',
  'derived-from': '派生自',
  'similar-to': '相似',
  'in-folder': '位于',
};

/** @param {string} kind */
export const kindLabel = (kind) =>
  kindNames[kind] ? t(kindNames[kind]) : researchLabel(kind) || kind;
/** @param {string} kind */
export const kindIcon = (kind) => kindIcons[kind] ?? 'file-text';
/** The design system colours nodes by `data-node-kind`; sources share one colour. @param {string} type @param {string} kind */
export const nodeKind = (type, kind) =>
  type === 'source' ? 'source' : type === 'item' ? (kind === 'code' ? 'code' : 'concept') : kind;
/** @param {string} relation */
export const relationLabel = (relation) =>
  relationNames[relation] ? t(relationNames[relation]) : relation;

/** `source:<id>` → `{type:'source', id}`. @param {string} ref */
export function splitRef(ref) {
  const colon = ref.indexOf(':');
  return { type: ref.slice(0, colon), id: ref.slice(colon + 1) };
}

/** MM-DD for this year, YYYY-MM-DD otherwise. @param {string} [iso] */
export function shortDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (value) => String(value).padStart(2, '0');
  const day = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return date.getFullYear() === new Date().getFullYear() ? day : `${date.getFullYear()}-${day}`;
}
