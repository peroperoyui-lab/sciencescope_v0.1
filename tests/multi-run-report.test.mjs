import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyQuestion, composeInterruptedRound, normalizeHistoricalAudit, summarizeRun, summarizeRuns } from '../scripts/evals/multi-run-report.mjs';
import { resolveAnswerCitations } from '../scripts/evals/hybrid-live-retrieval.mjs';

const complete = (id, answer = '29 libraries [S2 p.1]') => ({ id, answer, terminal: 'completed', status: 'COMPLETED_AUDIT_PENDING', requestCount: { forwardedCompletions: 3, effectiveModelSteps: 2, retryAttempts: 1 }, prohibitedTools: [] });
const receipt = { goldSha256: 'gold', mappingSha256: 'mapping', chunksSha256: 'chunks', rulesReceipt: { parser: 'sha' }, contextApiVersion: 'version', phase: 'single-pass', model: { modelId: 'fake' }, promptPrefix: 'question' };
const audited = row => ({ questionId: row.id, rawAnswer: row.answer, coreGrade: 'full', everyClaimCited: true, additionalClaimsSupported: true, ungroundedClaims: [], coreEvidence: [{ quote: '29 libraries', textSha256: 'source-sha' }] });

test('answer citation receipt retains compound members, ranges and unrecognized syntax', async () => {
  const lookedUp = [];
  const result = await resolveAnswerCitations('Fact [S1 p.2–4, S2 p.7] and [S1 nope]. Repeat [S1 p.2–4, S2 p.7].', async label => {
    lookedUp.push(label);
    return { citation: null, parseStatus: 'parsed', citations: [{ ref: { type: 'source', id: 'a' }, fromPage: 2, toPage: 4 }, { ref: { type: 'chunk', id: 'b' }, page: 7 }], unrecognized: [] };
  });
  assert.equal(result.citationParseAudit.length, 3);
  assert.equal(lookedUp.length, 1);
  assert.equal(result.citations[0].resolved, true);
  assert.equal(result.citations[0].citations.length, 2);
  assert.equal(result.citations[0].citations[0].toPage, 4);
  assert.deepEqual(result.unsupportedCitationSyntax.map(row => row.raw), ['S1 nope']);
  assert.equal(result.citations[1].resolved, false);
});

test('answer receipts record malformed explicit citations without calling the source resolver',async()=>{
  const result=await resolveAnswerCitations('Unknown [S3 p.4) and [S³].',()=>assert.fail('unknown syntax must not be resolved'));
  assert.deepEqual(result.citationParseAudit.map(row=>row.raw),['[S3 p.4)','[S³]']);
  assert.equal(result.citations.length,2);
  assert.ok(result.citations.every(row=>!row.resolved));
  assert.deepEqual(result.unsupportedCitationSyntax.map(row=>row.label),['[S3 p.4)','[S³]']);
});

test('quality excludes only unresolved infrastructure failures; recovered retries remain quality eligible', () => {
  const row = complete('q1');
  const failed = { id: 'q2', answer: '', terminal: 'failed', requestCount: {}, prohibitedTools: [] };
  const requests = { forwardedCompletions: 4, effectiveModelSteps: 3, retryAttempts: 1, events: [
    { sequence: 1, questionId: 'q1', routeKind: 'completion', forwarded: true, status: 502 },
    { sequence: 2, questionId: 'q1', routeKind: 'completion', forwarded: true, status: 200, usage: { total_tokens: 12, prompt_tokens: 8, completion_tokens: 4 } },
    { sequence: 3, questionId: 'q1', routeKind: 'completion', forwarded: true, status: 200, usage: { total_tokens: 9 } },
    { sequence: 4, questionId: 'q2', routeKind: 'completion', forwarded: true, status: 502 },
  ] };
  const report = summarizeRun({ name: 'fixture', results: { ...receipt, selectedQuestionIds: ['q1', 'q2'], questions: [row, failed] }, requests, audits: [{ ...receipt, questions: [audited(row), { questionId: 'q2', coreGrade: 'failed', rawAnswer: '' }] }] });
  assert.equal(report.infrastructureFailures, 1);
  assert.equal(report.qualityDenominator, 1);
  assert.equal(report.coreGrades.full, 1);
  assert.equal(report.fullyGrounded, 1);
  assert.equal(report.coreFullRate, 1);
  assert.equal(report.physicalRequests, 4);
  assert.equal(report.effectiveModelSteps, 3);
  assert.equal(report.retries, 1);
  assert.deepEqual(report.unknownUsageRequests, [1, 4]);
  assert.equal(report.knownUsage.total_tokens, 21);
});

test('core-full grade cannot hide ungrounded claims, pending audits or gold conflicts', () => {
  const rows = ['q1', 'q2', 'q3', 'q4'].map(id => complete(id));
  const audits = [audited(rows[0]), { ...audited(rows[1]), ungroundedClaims: [{ excerpt: 'Invented explanation', judgment: 'unsupported' }], additionalClaimsSupported: false }, { ...audited(rows[2]), coreGrade: 'gold_conflict' }];
  const report = summarizeRun({ name: 'fixture', results: { ...receipt, selectedQuestionIds: rows.map(row => row.id), questions: rows }, requests: { events: [] }, audits: [{ questions: audits }] });
  assert.equal(report.coreGrades.full, 2);
  assert.equal(report.coreGrades.gold_conflict, 1);
  assert.equal(report.fullyGrounded, 1);
  assert.equal(report.ungroundedClaimCount, 1);
  assert.equal(report.auditPending, 1);
  assert.equal(report.coreFullRate, null);
  assert.equal(classifyQuestion({ terminal: 'failed', prohibitedTools: ['bash'] }), 'tool_drift');
  assert.equal(classifyQuestion({ terminal: 'failed' }, [{ forwarded: false, blockReason: 'question-cap' }]), 'budget');
  assert.equal(classifyQuestion({ terminal: 'failed' }, [{ forwarded: false, blockReason: 'retry-cap' }]), 'infrastructure');
});

test('multi-round source identity and audit answers are enforced before means are calculated', () => {
  const row = complete('q1');
  const run = { name: 'r1', results: { ...receipt, selectedQuestionIds: ['q1'], questions: [row] }, requests: { events: [] }, audits: [{ ...receipt, questions: [audited(row)] }] };
  const report = summarizeRuns([run, { ...run, name: 'r2' }, { ...run, name: 'r3' }]);
  assert.equal(report.descriptiveMean.coreFull, 1);
  assert.equal(report.totals.effectiveModelSteps, null, 'unknown accounting is not zero');
  assert.match(report.interpretation, /cannot establish causal/u);
  assert.throws(() => summarizeRuns([run, { ...run, results: { ...run.results, rulesReceipt: { parser: 'different' } } }]), /source code/u);
  assert.throws(() => summarizeRun({ ...run, audits: [{ questions: [{ ...audited(row), rawAnswer: 'changed answer' }] }] }), /answer mismatch/u);
});

test('a recovered transport failure does not determine a later deadline failure; terminal evidence is retained', () => {
  const events = [{ sequence: 1, questionId: 'q1', forwarded: true, status: 502, connectionErrorType: 'TRANSPORT' },
    { sequence: 2, questionId: 'q1', forwarded: true, status: 200, modelStep: 1 }];
  const row = { ...complete('q1', ''), terminal: 'cancelled', stopReason: 'QUESTION_DEADLINE_180S' };
  assert.equal(classifyQuestion(row, events), 'deadline_unclassified');
  events.push({ sequence: 3, questionId: 'q1', forwarded: true, status: 504, modelStep: 2, connectionErrorType: 'TIMEOUT', deadlineExceeded: true });
  assert.equal(classifyQuestion(row, events), 'infrastructure');
  const report = summarizeRun({ name: 'fixture', results: { ...receipt, selectedQuestionIds: ['q1'], questions: [row] }, requests: { events }, audits: [] });
  assert.equal(report.rows[0].requestEvidence.lastAttempt.status, 504);
  assert.equal(report.rows[0].requestEvidence.lastAttempt.connectionErrorType, 'TIMEOUT');
  assert.deepEqual(report.rows[0].requestEvidence.recoveredEarlierErrorSequences, [1]);
});

test('historical grade matrix preserves unknown rows and never applies the six-question rerun to old results', () => {
  const row = complete('q1');
  const run = { name: 'r1', results: { ...receipt, selectedQuestionIds: ['q1'], questions: [row] }, requests: { events: [] }, audits: [{ questions: [audited(row)] }] };
  const report = summarizeRuns([run], { historical: [{ name: 'old39', audits: [{ questions: [{ questionId: 'q1', coreGrade: 'failed' }] }] }, { name: 'old43', audits: [] }] });
  assert.deepEqual(report.questionGradeMatrix[0], { id: 'q1', historical: { old39: 'failed', old43: 'unknown' }, fresh: { r1: 'full' } });
  assert.deepEqual(normalizeHistoricalAudit({ questions: [{ id: 'q1', assessment: 'full' }] }).map(({ questionId, coreGrade }) => ({ questionId, coreGrade })), [{ questionId: 'q1', coreGrade: 'full' }]);
  assert.equal(normalizeHistoricalAudit({ rows: [{ id: 'q1', coreGrade: 'gold_conflict' }] })[0].coreGrade, 'gold_conflict');
});

test('a completed terminal cannot override prohibited tools or post-answer runner failure', () => {
  const row = complete('q1');
  const drift = { ...row, status: 'FAILED', stopReason: 'NON_RESEARCH_TOOL_ATTEMPT', prohibitedTools: ['bash'] };
  assert.equal(classifyQuestion(drift), 'tool_drift');
  assert.equal(classifyQuestion({ ...row, status: 'FAILED', stopReason: 'RUNNER_FAILURE', runnerError: { name: 'Error' } }), 'infrastructure');
  assert.equal(classifyQuestion({ ...row, providerFailures: [{ code: 'SERVER', recovered: true }] }, [{ sequence: 1, status: 502, forwarded: true }]), 'completed');
  const result = summarizeRun({ name: 'fixture', results: { ...receipt, selectedQuestionIds: ['q1'], questions: [drift] }, requests: { events: [] }, audits: [{ questions: [audited(row)] }] });
  assert.equal(result.completeAnswers, 0);
  assert.equal(result.fullyGrounded, 0);
  assert.equal(result.coreGrades.full, 0);
  assert.equal(result.coreGrades.failed, 1);
});

test('an interrupted round composes only never-attempted questions and preserves the crash as infrastructure', () => {
  const rulesReceipt = { parser: 'same', 'scripts/evals/hybrid-live-retrieval.mjs': 'before-fix' };
  const original = { name: 'r2', results: { ...receipt, rulesReceipt, selectedQuestionIds: ['q1', 'q2', 'q3'], questions: [complete('q1'), { id: 'q2', status: 'RUNNING' }] },
    requests: { questions: { q2: { forwardedCompletions: 1 } }, events: [], forwardedCompletions: 0, effectiveModelSteps: 0, retryAttempts: 0, blockedCompletions: 0 }, audits: [] };
  const supplement = { name: 'remaining', results: { ...receipt, rulesReceipt: { ...rulesReceipt, 'scripts/evals/hybrid-live-retrieval.mjs': 'after-fix' }, selectedQuestionIds: ['q3'], questions: [complete('q3')] }, requests: { ...original.requests }, audits: [] };
  const combined = composeInterruptedRound(original, supplement);
  assert.equal(combined.results.questions[1].status, 'INTERRUPTED_NO_RETRY');
  assert.equal(classifyQuestion(combined.results.questions[1]), 'infrastructure');
  assert.deepEqual(combined.provenance.unattemptedQuestionIds, ['q3']);
  assert.throws(() => composeInterruptedRound(original, { ...supplement, results: { ...supplement.results, selectedQuestionIds: ['q2', 'q3'] } }), /never-attempted/u);
  assert.throws(() => summarizeRuns([original, { ...original, results: { ...original.results, rulesReceipt: supplement.results.rulesReceipt } }]), /source code/u);
  assert.doesNotThrow(() => summarizeRuns([original, { ...original, results: { ...original.results, rulesReceipt: supplement.results.rulesReceipt } }], { allowedReceiptChanges: ['scripts/evals/hybrid-live-retrieval.mjs'] }));
});
