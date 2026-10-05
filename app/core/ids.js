import { randomUUID } from 'node:crypto';

/**
 * Short, readable, sortable-enough ids such as `prj_3f9a2c1d0b7e4a51`.
 * @param {string} prefix
 * @returns {string}
 */
export function newId(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

/** @returns {string} Current time as an ISO string. */
export function nowIso() {
  return new Date().toISOString();
}
