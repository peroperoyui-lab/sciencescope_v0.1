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
import * as turnActivities from './018-turn-activities.js';
import * as turnError from './019-turn-error.js';
import * as inputImages from './020-input-images.js';
import * as removeAutomation from './021-remove-automation.js';
import * as knowledgeBase from './022-knowledge-base.js';
import * as projectFileIndex from './023-project-file-index.js';
import * as versionGraph from './024-version-graph.js';
import * as paperCards from './025-paper-cards.js';
import * as knowledgePositions from './026-knowledge-positions.js';
import * as deskSourceSync from './027-desk-source-sync.js';
import * as versionDiffs from './028-version-diffs.js';
import * as deskAnnotations from './029-desk-annotations.js';
import * as versionMarks from './030-version-marks.js';

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
  turnActivities,
  turnError,
  inputImages,
  removeAutomation,
  knowledgeBase,
  projectFileIndex,
  versionGraph,
  paperCards,
  knowledgePositions,
  deskSourceSync,
  versionDiffs,
  deskAnnotations,
  versionMarks,
];
