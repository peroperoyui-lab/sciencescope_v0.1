// Every schema change is a numbered migration listed here, in order.
// Never edit a migration that has shipped; add a new one.
import * as core from './001-core.js';
import * as toolPreamble from './002-tool-preamble.js';
import * as researchBase from './003-research-base.js';

import * as researchVectors from './004-research-vectors.js';

import * as meetingMinutes from './005-meeting-minutes.js';

import * as secretaryChats from './006-secretary-chats.js';

import * as memoryConsolidation from './007-memory-consolidation.js';

export const migrations = [
  core,
  toolPreamble,
  researchBase,
  researchVectors,
  meetingMinutes,
  secretaryChats,
  memoryConsolidation,
];
