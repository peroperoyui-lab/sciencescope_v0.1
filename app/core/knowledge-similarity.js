import { AppError } from './errors.js';

/**
 * Keep saved preferences and derived-edge rebuilds on the same parameter rules.
 * @param {{threshold:number,maxPerPaper:number}} settings
 * @returns {void}
 */
export function validateSimilaritySettings(settings) {
  if (!Number.isFinite(settings?.threshold) || settings.threshold < -1 || settings.threshold > 1)
    throw new AppError('INVALID_KNOWLEDGE_SIMILARITY', '相似边阈值必须是 -1 到 1 之间的有限数字。');
  if (!Number.isInteger(settings?.maxPerPaper) || settings.maxPerPaper < 0)
    throw new AppError(
      'INVALID_KNOWLEDGE_SIMILARITY',
      '每篇资料的相似边数量必须是大于或等于 0 的整数，0 表示不建相似边。',
    );
}
