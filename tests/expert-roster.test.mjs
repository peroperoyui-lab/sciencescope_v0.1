import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createExpertRoster, DEFAULT_INDEPENDENT_REVIEWER } from '../scripts/expert-roster.mjs';

const tempRoot = join(process.cwd(), '.sciencescope-local', 'temp');
mkdirSync(tempRoot, { recursive: true });
const expert = (id, patch = {}) => ({ id, label: id, persona: `Prompt for ${id}`, ...patch });

function withDb(name, run) {
  const root = mkdtempSync(join(tempRoot, `expert-roster-${name}-`));
  const db = new DatabaseSync(join(root, 'test.sqlite'));
  try { return run(db, root); }
  finally { db.close(); rmSync(root, { recursive: true, force: true }); }
}

test('fresh roster seeds three participants and a disabled independent reviewer', () => withDb('defaults', (db) => {
  const roster = createExpertRoster({ db });
  const rows = roster.list();
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.filter((row) => row.kind === 'expert').map((row) => row.id), ['methodologist', 'statistician', 'red-team']);
  const reviewer = rows.find((row) => row.kind === 'reviewer');
  assert.equal(reviewer.id, DEFAULT_INDEPENDENT_REVIEWER.id);
  assert.equal(reviewer.enabled, false);
  assert.match(reviewer.persona, /independent reviewer/i);
  assert.deepEqual(reviewer.skills, []);
}));

test('migrates legacy rows without changing user personas and never reseeds a deleted reviewer', () => withDb('migration', (db) => {
  db.exec(`CREATE TABLE experts(id TEXT PRIMARY KEY, label TEXT NOT NULL, role TEXT NOT NULL, persona TEXT NOT NULL, model_json TEXT, reasoning_effort TEXT, enabled INTEGER NOT NULL, position INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE expert_roster_state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO expert_roster_state VALUES('seeded','1');`);
  db.prepare('INSERT INTO experts VALUES(?,?,?,?,?,?,?,?,?)').run('custom', '自定义专家', '方法', 'User-owned persona stays byte-for-byte.', null, null, 1, 0, '2026-01-01');

  let roster = createExpertRoster({ db });
  let custom = roster.list().find((row) => row.id === 'custom');
  assert.equal(custom.persona, 'User-owned persona stays byte-for-byte.');
  assert.equal(custom.kind, 'expert');
  assert.deepEqual(custom.skills, []);
  assert.equal(roster.list().some((row) => row.id === DEFAULT_INDEPENDENT_REVIEWER.id), true);

  roster.save([custom]);
  roster = createExpertRoster({ db });
  assert.deepEqual(roster.list().map((row) => row.id), ['custom'], 'the independent reviewer is not recreated after user deletion');
}));

test('independent-reviewer id collision leaves the existing user record untouched', () => withDb('collision', (db) => {
  db.exec(`CREATE TABLE experts(id TEXT PRIMARY KEY, label TEXT NOT NULL, role TEXT NOT NULL, persona TEXT NOT NULL, model_json TEXT, reasoning_effort TEXT, enabled INTEGER NOT NULL, position INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE expert_roster_state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO expert_roster_state VALUES('seeded','1');`);
  const userPersona = 'Do not replace this existing user prompt.';
  db.prepare('INSERT INTO experts VALUES(?,?,?,?,?,?,?,?,?)').run(DEFAULT_INDEPENDENT_REVIEWER.id, 'My reviewer', 'My role', userPersona, null, null, 1, 0, '2026-01-01');
  const roster = createExpertRoster({ db });
  const row = roster.list().find((item) => item.id === DEFAULT_INDEPENDENT_REVIEWER.id);
  assert.equal(row.label, 'My reviewer');
  assert.equal(row.persona, userPersona);
  assert.equal(row.kind, 'expert');
  assert.equal(roster.list().length, 1);
}));

test('validates kinds, skill shapes, enabled ids, separate roster limits and dispatch roles', () => withDb('validation', (db) => {
  const roster = createExpertRoster({ db });
  const enabledSkillIds = ['checklist'];
  const withSkill = expert('bio', { kind: 'reviewer', skills: ['checklist'] });
  assert.equal(roster.save([withSkill], { enabledSkillIds })[0].skills[0], 'checklist');
  for (const invalid of [
    expert('bad-kind', { kind: 'secretary' }),
    expert('bad-shape', { skills: 'checklist' }),
    expert('bad-id', { skills: ['../checklist'] }),
    expert('disabled-skill', { skills: ['not-enabled'] }),
    expert('duplicate-skill', { skills: ['checklist', 'checklist'] }),
  ]) assert.throws(() => roster.save([invalid], { enabledSkillIds }), (error) => error.code === 'INVALID_EXPERT_ROSTER' && error.status === 400);

  const combined = [
    ...Array.from({ length: 8 }, (_, index) => expert(`p-${index}`, { kind: 'expert' })),
    ...Array.from({ length: 8 }, (_, index) => expert(`r-${index}`, { kind: 'reviewer' })),
  ];
  assert.equal(roster.save(combined).length, 16, 'participants and reviewers have independent limits');
  assert.throws(() => roster.save([...combined, expert('p-overflow')]), /参加专家须为 0–8 位/u);
  assert.throws(() => roster.save([...combined, expert('r-overflow', { kind: 'reviewer' })]), /独立审核须为 0–8 位/u);
  assert.throws(() => roster.resolveParticipants(['r-0']), /不能作为作答参加者/u);

  roster.save([expert('p', { enabled: false })]);
  assert.throws(() => roster.resolveParticipants(['p']), /已停用/u);
  assert.throws(() => roster.resolveReviewer('p'), /已停用/u);
  roster.save([expert('p')]);
  assert.equal(roster.resolveReviewer('p').kind, 'expert', 'a participant can still be selected as reviewer');
}));
