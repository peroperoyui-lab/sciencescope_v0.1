import { AppError } from '../../core/errors.js';

/** @param {any} value @param {string[]} values @param {string} field @returns {string} */
export function oneOf(value, values, field) {
  if (!values.includes(value)) {
    throw new AppError('INVALID_RESEARCH_RECORD', `Invalid research ${field}.`);
  }
  return value;
}

/** @param {any} value @param {string} field @returns {string} */
export function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError('INVALID_RESEARCH_RECORD', `Research ${field} is required.`);
  }
  return value;
}

/** @param {any} value @returns {any} */
export function recordObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('INVALID_RESEARCH_RECORD', 'Research metadata and payload must be objects.');
  }
  return value;
}

/** @param {any} row @param {any} options @param {string[]} where @param {any[]} params */
export function filterProject(row, options, where, params) {
  if (options.projectId === undefined) return;
  if (options.projectId === null) {
    where.push(`${row} IS NULL`);
    return;
  }
  where.push(options.includePersonal === false ? `${row} = ?` : `(${row} = ? OR ${row} IS NULL)`);
  params.push(options.projectId);
}

/** @param {any} value @returns {string} */
export function payloadText(value) {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  return Object.values(value).map(payloadText).join('\n');
}
