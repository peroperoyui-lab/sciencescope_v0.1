// Every schema change is a numbered migration listed here, in order.
// Never edit a migration that has shipped; add a new one.
import * as core from './001-core.js';

export const migrations = [core];
