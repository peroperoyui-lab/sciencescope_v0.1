// Offline accounting only. Human source audits supply grades; this never judges prose.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const liveRoot = path.join(repo, '.sciencescope-local/temp/t10-validation/live');
const gradeNames = ['full', 'partial', 'wrong', 'abstained', 'failed', 'gold_conflict'];
const sum = values => values.reduce((total, value) => total + value, 0);
const mean = values => values.length ? sum(values) / values.length : null;

export function normalizeHistoricalAudit(audit) {
  return (audit.questions ?? audit.rows ?? []).map(row => ({ questionId: row.questionId ?? row.id,
    coreGrade: row.coreGrade ?? row.assessment ?? 'unknown', original: row }));
}

export function terminalRequestEvidence(events = []) {
  const forwarded = events.filter(event => event.forwarded);
  const last = forwarded.at(-1);
  const lastAttempt = last ? Object.fromEntries(['sequence', 'modelStep', 'retryIndex', 'status', 'upstreamStatus', 'upstreamErrorCode',
    'upstreamErrorType', 'connectionErrorType', 'connectionErrorCode', 'connectionCauseCodes', 'deadlineExceeded', 'upstreamAborted', 'downstreamAborted']
    .map(field => [field, last[field] ?? null])) : null;
  const transportFailure = last && (last.status >= 400 || last.upstreamAborted || last.deadlineExceeded || last.connectionErrorType);
  return { lastAttempt, terminalTransportFailure: Boolean(transportFailure),
    recoveredEarlierErrorSequences: forwarded.filter(event => event.sequence !== last?.sequence && (event.status >= 400 || event.connectionErrorType)
      && forwarded.some(later => later.sequence > event.sequence && later.status < 400 && !later.connectionErrorType)).map(event => event.sequence),
    blockedReasons: [...new Set(events.filter(event => !event.forwarded && event.blockReason).map(event => event.blockReason))] };
}

export function classifyQuestion(row, events = []) {
  if (row.prohibitedTools?.length || row.stopReason === 'NON_RESEARCH_TOOL_ATTEMPT') return 'tool_drift';
  if (row.stopReason === 'RUNNER_FAILURE' || row.runnerError || row.status === 'RUNNING' || row.status === 'INTERRUPTED_NO_RETRY') return 'infrastructure';
  if (row.terminal === 'completed' && String(row.answer ?? '').trim() && !row.stopReason && row.status !== 'FAILED') return 'completed';
  if (events.some(event => !event.forwarded && event.blockReason === 'question-cap')) return 'budget';
  if (terminalRequestEvidence(events).terminalTransportFailure) return 'infrastructure';
  if (events.some(event => ['retry-cap', 'question-physical-cap', 'global-cap', 'global-physical-cap'].includes(event.blockReason))) return 'infrastructure';
  if (row.requestCount?.blockedCompletions > 0) return 'budget';
  if (row.stopReason === 'QUESTION_DEADLINE_180S') return 'deadline_unclassified';
  return 'empty_response';
}

export function summarizeRun({ name, results, requests, audits = [] }) {
  const selected = results.selectedQuestionIds ?? results.questions.map(row => row.id);
  assert.equal(new Set(selected).size, selected.length, 'duplicate selected question');
  assert.equal(new Set(results.questions.map(row => row.id)).size, results.questions.length, 'duplicate result question');
  const auditRows = audits.flatMap(audit => {
    for (const field of ['goldSha256', 'mappingSha256', 'chunksSha256']) if (audit[field]) assert.equal(audit[field], results[field], `audit ${field} changed`);
    if (audit.rulesReceipt) assert.ok((results.componentRulesReceipts ?? [results.rulesReceipt]).some(receipt => JSON.stringify(receipt) === JSON.stringify(audit.rulesReceipt)), 'audit source receipt changed');
    return audit.questions ?? [];
  });
  assert.equal(new Set(auditRows.map(row => row.questionId)).size, auditRows.length, 'duplicate audited question');
  assert.ok(auditRows.every(row => selected.includes(row.questionId)), 'audit contains an unselected question');
  const auditMap = new Map(auditRows.map(row => [row.questionId, row]));
  const events = requests.events ?? [];
  const forwarded = events.filter(event => event.routeKind === 'completion' && event.forwarded);
  if (requests.forwardedCompletions !== undefined) assert.equal(forwarded.length, requests.forwardedCompletions, 'physical request ledger is incomplete');
  const usage = {}; const unknownUsageRequests = [];
  for (const event of forwarded) {
    if (!event.usage || !Number.isFinite(event.usage.total_tokens)) { unknownUsageRequests.push(event.sequence); continue; }
    for (const [field, count] of Object.entries(event.usage)) if (Number.isFinite(count)) usage[field] = (usage[field] ?? 0) + count;
    for (const [field, count] of Object.entries({ cached_tokens: event.usage.prompt_tokens_details?.cached_tokens,
      reasoning_tokens: event.usage.completion_tokens_details?.reasoning_tokens })) {
      if (Number.isFinite(count) && event.usage[field] === undefined) usage[field] = (usage[field] ?? 0) + count;
    }
  }
  const grades = Object.fromEntries(gradeNames.map(grade => [grade, 0]));
  const failureReasons = {}; let pending = 0; let grounded = 0; let auditedEligible = 0;
  let unsupportedSyntax = 0; let unresolvedGroups = 0; let ungroundedClaimCount = 0;
  const rows = selected.map(id => {
    const row = results.questions.find(question => question.id === id);
    if (!row) { pending += 1; return { id, outcome: 'not_run', auditStatus: 'pending' }; }
    const outcome = classifyQuestion(row, events.filter(event => event.questionId === id));
    if (outcome !== 'completed') failureReasons[outcome] = (failureReasons[outcome] ?? 0) + 1;
    const audit = auditMap.get(id);
    if (audit?.rawAnswer !== undefined) assert.equal(audit.rawAnswer, row.answer ?? '', `audit answer mismatch ${id}`);
    const grade = audit?.coreGrade;
    if (grade !== undefined) assert.ok(gradeNames.includes(grade), `unknown audit grade ${id}`);
    if (!grade) pending += 1;
    const isInfrastructure = outcome === 'infrastructure';
    const qualityGrade = grade ? (outcome === 'completed' ? grade : 'failed') : null;
    if (!isInfrastructure) {
      if (qualityGrade) { grades[qualityGrade] += 1; auditedEligible += 1; }
    }
    const claims = audit?.ungroundedClaims ?? audit?.unsupportedAdditionalClaims;
    const sourceAuditComplete = Array.isArray(claims) && Array.isArray(audit?.coreEvidence) && audit.coreEvidence.some(evidence => typeof evidence.quote === 'string' && evidence.quote.length > 0);
    const fullyGrounded = outcome === 'completed' && grade === 'full' && sourceAuditComplete && claims.length === 0
      && audit.everyClaimCited === true && audit.additionalClaimsSupported === true;
    if (fullyGrounded) grounded += 1;
    if (Array.isArray(claims)) ungroundedClaimCount += claims.length;
    const syntax = row.unsupportedCitationSyntax ?? [];
    unsupportedSyntax += syntax.length;
    unresolvedGroups += (row.citations ?? []).filter(citation => citation.resolved !== true).length;
    return { id, outcome, coreGrade: grade ?? null, qualityGrade, auditStatus: grade ? 'source_audited' : 'pending',
      fullyGrounded, ungroundedClaims: claims ?? null, unsupportedCitationSyntax: syntax,
      physicalRequests: row.requestCount?.forwardedCompletions ?? null, effectiveModelSteps: row.requestCount?.effectiveModelSteps ?? null,
      retries: row.requestCount?.retryAttempts ?? null, terminal: row.terminal ?? null, stopReason: row.stopReason ?? null,
      requestEvidence: terminalRequestEvidence(events.filter(event => event.questionId === id)),
      providerFailures: row.providerFailures ?? [], runnerError: row.runnerError ?? null };
  });
  const infrastructureFailures = failureReasons.infrastructure ?? 0;
  const denominator = selected.length - infrastructureFailures;
  return { name, status: pending ? 'AUDIT_PENDING' : 'SOURCE_AUDIT_COMPLETE', selected: selected.length,
    completeAnswers: rows.filter(row => row.outcome === 'completed').length,
    infrastructureFailures, qualityDenominator: denominator, auditedEligible, auditPending: pending,
    coreGrades: grades, fullyGrounded: grounded, coreFullRate: pending ? null : denominator ? grades.full / denominator : null,
    overallSelectedCoreFullRate: pending ? null : selected.length ? grades.full / selected.length : null,
    fullyGroundedRate: pending ? null : denominator ? grounded / denominator : null, failureReasons,
    physicalRequests: requests.forwardedCompletions ?? forwarded.length,
    effectiveModelSteps: requests.effectiveModelSteps ?? null, retries: requests.retryAttempts ?? null,
    blockedRequests: requests.blockedCompletions ?? null, knownUsageRequests: forwarded.length - unknownUsageRequests.length,
    unknownUsageRequests, knownUsage: usage, usageComplete: unknownUsageRequests.length === 0,
    unsupportedCitationSyntaxCount: unsupportedSyntax, unresolvedCitationGroupCount: unresolvedGroups,
    ungroundedClaimCount, cleanup: results.cleanup ?? null, rows };
}

export function composeInterruptedRound(original, supplemental) {
  const expected = original.results.selectedQuestionIds;
  const attempted = new Set(original.results.questions.map(row => row.id));
  const unpaid = expected.filter(id => !attempted.has(id));
  assert.deepEqual(supplemental.results.selectedQuestionIds, unpaid, 'supplemental must contain only never-attempted questions in frozen order');
  const interrupted = original.results.questions.filter(row => row.status === 'RUNNING');
  assert.ok(interrupted.length > 0, 'composite requires an original interrupted question');
  for (const field of ['goldSha256', 'mappingSha256', 'chunksSha256', 'contextApiVersion', 'promptPrefix']) assert.equal(original.results[field], supplemental.results[field], `composite ${field} changed`);
  assert.deepEqual(original.results.model, supplemental.results.model, 'composite model changed');
  for (const [file, sha] of Object.entries(original.results.rulesReceipt)) if (file !== 'scripts/evals/hybrid-live-retrieval.mjs') assert.equal(supplemental.results.rulesReceipt[file], sha, `composite model/tool source changed ${file}`);
  const supplementEvents = supplemental.requests.events.map(event => ({ ...event, originalSequence: event.sequence, componentRun: supplemental.name,
    sequence: original.requests.events.length + event.sequence }));
  const mainEvents = original.requests.events.map(event => ({ ...event, originalSequence: event.sequence, componentRun: original.name }));
  const questions = original.results.questions.map(row => row.status === 'RUNNING' ? { ...row, status: 'INTERRUPTED_NO_RETRY', answer: '', terminal: null,
    stopReason: 'RUNNER_FAILURE', runnerError: { name: 'Error', code: 'EPERM', message: 'Original proxy ledger replacement crashed; interrupted question never retried.' },
    requestCount: original.requests.questions[row.id] } : row);
  return { name: `${original.name}-composite`, results: { ...original.results, status: 'COMPOSITE_INTERRUPTED_ORIGINAL_PLUS_UNATTEMPTED_SUPPLEMENT',
    componentRulesReceipts: [original.results.rulesReceipt, supplemental.results.rulesReceipt], questions: [...questions, ...supplemental.results.questions],
    cleanup: { originalCrash: true, originalManualCleanup: original.manualCleanup ?? null, supplemental: supplemental.results.cleanup } },
    requests: { ...original.requests, events: [...mainEvents, ...supplementEvents],
      forwardedCompletions: original.requests.forwardedCompletions + supplemental.requests.forwardedCompletions,
      effectiveModelSteps: original.requests.effectiveModelSteps + supplemental.requests.effectiveModelSteps,
      retryAttempts: original.requests.retryAttempts + supplemental.requests.retryAttempts,
      blockedCompletions: original.requests.blockedCompletions + supplemental.requests.blockedCompletions },
    audits: [...(original.audits ?? []), ...(supplemental.audits ?? [])],
    provenance: { originalRun: original.name, supplementalRun: supplemental.name, interruptedQuestionIds: interrupted.map(row => row.id),
      unattemptedQuestionIds: unpaid, originalRunFinished: false, originalLedgerPreserved: true,
      accounting: 'Original committed ledger used. Crash next-ledger reserved sequence never reached transport and is preserved separately; no interrupted question retried.' } };
}

export function summarizeRuns(runs, { historical = [], allowedReceiptChanges = [] } = {}) {
  assert.ok(runs.length > 0, 'at least one run is required');
  const first = runs[0].results;
  for (const run of runs.slice(1)) {
    for (const field of ['goldSha256', 'mappingSha256', 'chunksSha256', 'contextApiVersion', 'promptPrefix', 'phase']) assert.equal(run.results[field], first[field], `${field} differs between rounds`);
    assert.deepEqual(run.results.model, first.model, 'model differs between rounds');
    for (const [file, sha] of Object.entries(first.rulesReceipt)) if (!allowedReceiptChanges.includes(file)) assert.equal(run.results.rulesReceipt[file], sha, `source code differs between rounds: ${file}`);
    assert.deepEqual(run.results.selectedQuestionIds, first.selectedQuestionIds, 'question selection differs between rounds');
  }
  const rounds = runs.map(summarizeRun);
  const allAudited = rounds.every(round => round.status === 'SOURCE_AUDIT_COMPLETE');
  return { schema: 1, generatedAt: new Date().toISOString(), status: allAudited ? 'SOURCE_AUDIT_COMPLETE' : 'AUDIT_PENDING',
    interpretation: 'Repeated after-change rounds are descriptive. Historical single runs 43/52, 42/52 and 39/52 cannot establish causal change; a controlled quality comparison requires at least three before and three after rounds.',
    questionGradeMatrix: (first.selectedQuestionIds ?? first.questions.map(row => row.id)).map(id => ({ id,
      historical: Object.fromEntries(historical.map(run => [run.name, (run.audits ?? []).flatMap(normalizeHistoricalAudit).find(row => row.questionId === id)?.coreGrade ?? 'unknown'])),
      fresh: Object.fromEntries(rounds.map(round => [round.name, round.rows.find(row => row.id === id)?.coreGrade ?? 'pending'])) })),
    ungroundedClaimNotes: rounds.flatMap(round => round.rows.flatMap(row => (row.ungroundedClaims ?? []).map(claim => ({
      round: round.name, questionId: row.id, excerpt: claim.excerpt ?? claim.claim ?? '', claimType: claim.claimType ?? claim.issueKind ?? 'unclassified',
      judgment: claim.judgment ?? 'unsupported', rationale: claim.rationale ?? claim.explanation ?? claim.reason ?? '',
      sourceSupport: claim.sourceSupport ?? null, citationSupport: claim.citationSupport ?? null,
      evidence: claim.sourceEvidence ?? claim.evidence ?? [] })))),
    roundProvenance: runs.map(run => ({ name: run.name, rulesReceipt: run.results.rulesReceipt,
      componentRulesReceipts: run.results.componentRulesReceipts ?? null, composition: run.provenance ?? null })),
    allowedReceiptChanges,
    historicalProvenance: historical.map(run => ({ name: run.name, files: run.files ?? [],
      coreFull: (run.audits ?? []).flatMap(normalizeHistoricalAudit).filter(row => row.coreGrade === 'full').length,
      knownRows: (run.audits ?? []).flatMap(normalizeHistoricalAudit).length })),
    identity: { model: first.model, goldSha256: first.goldSha256, mappingSha256: first.mappingSha256, chunksSha256: first.chunksSha256,
      contextApiVersion: first.contextApiVersion, rulesReceipt: first.rulesReceipt }, rounds,
    descriptiveMean: { coreFull: allAudited ? mean(rounds.map(round => round.coreGrades.full)) : null,
      fullyGrounded: allAudited ? mean(rounds.map(round => round.fullyGrounded)) : null,
      coreFullRate: allAudited ? mean(rounds.map(round => round.coreFullRate)) : null,
      fullyGroundedRate: allAudited ? mean(rounds.map(round => round.fullyGroundedRate)) : null,
      infrastructureFailures: mean(rounds.map(round => round.infrastructureFailures)) },
    totals: { physicalRequests: sum(rounds.map(round => round.physicalRequests)),
      effectiveModelSteps: rounds.every(round => round.effectiveModelSteps !== null) ? sum(rounds.map(round => round.effectiveModelSteps)) : null,
      retries: rounds.every(round => round.retries !== null) ? sum(rounds.map(round => round.retries)) : null,
      unknownUsageRequests: sum(rounds.map(round => round.unknownUsageRequests.length)),
      knownUsage: Object.assign({}, ...Object.keys(rounds.reduce((all, round) => ({ ...all, ...round.knownUsage }), {})).map(field => ({ [field]: sum(rounds.map(round => round.knownUsage[field] ?? 0)) }))) } };
}

export function renderReport(report) {
  const lines = ['# T10 repeated frozen-source evaluation', '', report.interpretation, '',
    '| Round | Complete | Infra excluded | Quality denominator | Core full | Fully grounded | Pending | Physical | Steps | Retries | Unknown usage |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'];
  for (const row of report.rounds) lines.push(`| ${row.name} | ${row.completeAnswers}/${row.selected} | ${row.infrastructureFailures} | ${row.qualityDenominator} | ${row.coreGrades.full} | ${row.fullyGrounded} | ${row.auditPending} | ${row.physicalRequests} | ${row.effectiveModelSteps ?? 'unknown'} | ${row.retries ?? 'unknown'} | ${row.unknownUsageRequests.length} |`);
  lines.push('', `Descriptive mean core-full: ${report.descriptiveMean.coreFull ?? 'audit pending'}; fully-grounded: ${report.descriptiveMean.fullyGrounded ?? 'audit pending'}.`, '',
    'Core-full checks the requested answer only. Fully-grounded additionally requires a source audit, every claim cited, and no unsupported additional claims. Parsed/resolved citation counts do not establish source support. Known token totals omit unknown usage and are not imputed.', '');
  for (const row of report.rounds) lines.push(`- ${row.name}: grades ${JSON.stringify(row.coreGrades)}; failures ${JSON.stringify(row.failureReasons)}; unsupported citation syntax ${row.unsupportedCitationSyntaxCount}; unresolved groups ${row.unresolvedCitationGroupCount}; ungrounded claims ${row.ungroundedClaimCount}.`);
  if (report.questionGradeMatrix?.length) {
    const columns = [...Object.keys(report.questionGradeMatrix[0].historical), ...Object.keys(report.questionGradeMatrix[0].fresh)];
    lines.push('', '| Question | ' + columns.join(' | ') + ' |', '|---|' + columns.map(() => '---').join('|') + '|');
    for (const row of report.questionGradeMatrix) lines.push('| ' + row.id + ' | ' + columns.map(column => row.historical[column] ?? row.fresh[column]).join(' | ') + ' |');
  }
  return `${lines.join('\n')}\n`;
}

export function renderClaimNotes(report) {
  const escape = value => String(value ?? '').replaceAll('|', '\\|').replace(/[\r\n]+/gu, ' ');
  const lines = ['# Per-question substantive unsupported claims', '',
    'Human source audit findings only. Wrong-page citations, uncited supported facts, methods and accurate descriptions of a bounded search are recorded separately in the source audits.', '',
    '| Round | Question | Claim type | Answer excerpt | Source judgment | Reason |', '|---|---|---|---|---|---|'];
  for (const claim of report.ungroundedClaimNotes ?? []) lines.push(`| ${escape(claim.round)} | ${escape(claim.questionId)} | ${escape(claim.claimType)} | ${escape(claim.excerpt)} | ${escape(claim.judgment)} | ${escape(claim.rationale)} |`);
  return `${lines.join('\n')}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const names = []; const historicalNames = []; const auditFiles = new Map(); let output = path.join(liveRoot, 'multi-run-report');
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--run') names.push(argv[++index]);
    else if (arg === '--historical') historicalNames.push(argv[++index]);
    else if (arg === '--audit') {
      const value = argv[++index]; const separator = value?.indexOf('=') ?? -1;
      assert.ok(separator > 0, '--audit requires RUN=FILE');
      const name = value.slice(0, separator); const files = auditFiles.get(name) ?? [];
      files.push(path.resolve(repo, value.slice(separator + 1))); auditFiles.set(name, files);
    } else if (arg === '--output') output = path.resolve(repo, argv[++index]);
    else throw new Error(`Unknown option: ${arg}`);
  }
  assert.ok(names.length && new Set(names).size === names.length, 'use --run NAME once per fresh run');
  assert.ok(names.every(name => /^[a-zA-Z0-9_-]{1,64}$/u.test(name)), 'invalid run name');
  const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
  const runs = await Promise.all(names.map(async name => ({ name,
    results: await readJson(path.join(liveRoot, name, 'results.json')),
    requests: await readJson(path.join(liveRoot, name, 'request-ledger.json')),
    audits: await Promise.all((auditFiles.get(name) ?? []).map(readJson)) })));
  const historical = await Promise.all(historicalNames.map(async name => {
    const files = await Promise.all((auditFiles.get(name) ?? []).map(async file => {
      const bytes = await readFile(file); return { path: file, sha256: createHash('sha256').update(bytes).digest('hex'), audit: JSON.parse(bytes) };
    }));
    return { name, files: files.map(({ path, sha256 }) => ({ path, sha256 })), audits: files.map(file => file.audit) };
  }));
  const report = summarizeRuns(runs, { historical });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(`${output}.json`, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(`${output}.md`, renderReport(report));
  await writeFile(`${output}-claim-notes.md`, renderClaimNotes(report));
  console.log(JSON.stringify({ status: report.status, rounds: report.rounds.length, output, totals: report.totals }));
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
