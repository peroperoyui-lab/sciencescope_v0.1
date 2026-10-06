// Every schema change is a numbered migration listed here, in order.
// Never edit a migration that has shipped; add a new one.
import * as core from './001-core.js';
import * as toolPreamble from './002-tool-preamble.js';
import * as researchBase from './003-research-base.js';

export const migrations = [core, toolPreamble, researchBase];
