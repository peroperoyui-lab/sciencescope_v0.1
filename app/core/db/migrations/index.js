// Every schema change is a numbered migration listed here, in order.
// Never edit a migration that has shipped; add a new one.
import * as core from './001-core.js';
import * as toolPreamble from './002-tool-preamble.js';
import * as researchBase from './003-research-base.js';

import * as researchVectors from './004-research-vectors.js';

import * as meetingMinutes from './005-meeting-minutes.js';

import * as secretaryChats from './006-secretary-chats.js';

import * as memoryConsolidation from './007-memory-consolidation.js';

import * as resourceSnapshots from './008-resource-snapshots.js';

import * as meetingOutbox from './009-meeting-outbox.js';

import * as messageDeliverables from './010-message-deliverables.js';

import * as globalAssistant from './011-global-assistant.js';
import * as researchInput from './012-research-input.js';
import * as pythonEnvironments from './013-python-environments.js';
import * as meetingGoals from './014-meeting-goals.js';
import * as manuscriptVersions from './015-manuscript-versions.js';
import * as versionNotes from './016-version-notes.js';
import * as logFileReferences from './017-log-file-references.js';

export const migrations = [
  core,
  toolPreamble,
  researchBase,
  researchVectors,
  meetingMinutes,
  secretaryChats,
  memoryConsolidation,
  resourceSnapshots,
  meetingOutbox,
  messageDeliverables,
  globalAssistant,
  researchInput,
  pythonEnvironments,
  meetingGoals,
  manuscriptVersions,
  versionNotes,
  logFileReferences,
];
