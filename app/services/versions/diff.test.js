import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { withCore } from '../../testing.js';
import { createVersions } from './index.js';
import { createResearchFixtures } from '../research/testing.js';
import { parseLog } from '../../shared/journal.js';
import { updateWorkbench } from '../secretary/publish.js';
import { createJournalFiles } from '../journal-files.js';
import { createProjectFiles } from '../project-files.js';

test('complete word comparison and copy restoration preserve both DOCX originals; failed parsing still opens originals', async () => {
  await withCore('version-diff', async (core, dir) => {
    const project = await core.projects.create({ name: '稿件比较' });
    const fixtures = await createResearchFixtures(dir);
    const revised = await JSZip.loadAsync(fixtures.docx.bytes);
    revised.file(
      'word/document.xml',
      (await revised.file('word/document.xml').async('string')).replace(
        '这是中文可检索段落，研究资料来源可追溯。',
        '研究改为使用环境刺激，并补充用户聚类分析。',
      ),
    );
    const revisedBytes = await revised.generateAsync({ type: 'nodebuffer' });
    const opened = [];
    const versions = createVersions(core, {
      open: async (file) => {
        opened.push(file);
      },
    });
    const imported = await versions.importFiles({
      projectId: project.id,
      files: [
        { name: '原稿.docx', base64: Buffer.from(fixtures.docx.bytes).toString('base64') },
        { name: '修订.docx', base64: revisedBytes.toString('base64') },
      ],
    });
    const [old, current] = imported.versions;
    const result = await versions.compare(current.id);
    assert.equal(result.status, 'ready');
    assert.ok(result.changes.some((part) => part.type === 'added'));
    assert.ok(result.changes.some((part) => part.type === 'removed'));
    const joined = (excluded) =>
      result.changes
        .filter((part) => part.type !== excluded)
        .map((part) => part.text)
        .join('');
    assert.equal(joined('added'), result.previous.blocks.map((block) => block.text).join('\n\n'));
    assert.equal(joined('removed'), result.current.blocks.map((block) => block.text).join('\n\n'));
    const copy = (await versions.saveAsNew(old.id)).versions[0];
    assert.equal(copy.number, 3);
    assert.equal(copy.baselineId, current.id);
    assert.deepEqual(await readFile(versions.file(copy.id)), Buffer.from(fixtures.docx.bytes));
    assert.deepEqual(await readFile(versions.file(current.id)), revisedBytes);
    assert.equal((await versions.compare(copy.id, old.id)).status, 'unchanged');
    const broken = (
      await versions.importFiles({
        projectId: project.id,
        groupId: old.groupId,
        files: [{ name: '损坏.pdf', base64: Buffer.from('not PDF').toString('base64') }],
      })
    ).versions[0];
    assert.equal((await versions.compare(broken.id)).status, 'originals-only');
    await versions.openOriginal(broken.id);
    assert.deepEqual(opened, [versions.file(broken.id)]);
  });
});

test('secretary log references survive history, undo, external edits and index rebuild', async () => {
  await withCore('journal-links', async (core) => {
    const project = await core.projects.create({ name: '关联稿件' });
    const meeting = core.meetings.create({ projectId: project.id });
    const versions = createVersions(core, { open: async () => {} });
    const version = (
      await versions.importFiles({
        projectId: project.id,
        files: [{ name: '论文.md', base64: Buffer.from('研究正文').toString('base64') }],
      })
    ).versions[0];
    const files = createProjectFiles(core);
    await files.add(project.id, '中文脚本.py', Buffer.from('print(1)').toString('base64'));
    /** @type {import('../../core/references.js').ContentReference[]} */
    const references = [
      { schema: 1, kind: 'version', projectId: project.id, id: version.id, label: version.name },
      { schema: 1, kind: 'project-file', projectId: project.id, path: '中文脚本.py' },
    ];
    const minutesRevision = await core.workspace.edit({
      resource: 'minutes',
      key: meeting.id,
      op: 'write',
      args: { text: '完成修改' },
    });
    const turn = core.turns.start({ meetingId: meeting.id, participantId: 'agent_secretary' });
    await updateWorkbench({
      core,
      runner: {
        run: async () => ({
          text: JSON.stringify({
            operations: [
              {
                target: 'log',
                op: 'append',
                title: '稿件修改',
                note: '两份关联材料。',
                references,
              },
            ],
          }),
          turnId: turn.id,
        }),
      },
      store: { patchStatus() {} },
      meetingId: meeting.id,
      minutesRevisionId: minutesRevision.revisionId,
      minutes: '完成修改',
      modes: { log: 'apply' },
    });
    const target = { resource: 'log', key: project.id };
    const saved = await core.workspace.read(target);
    assert.deepEqual(parseLog(saved.text)[0].references, references);
    assert.equal(core.workspace.history(target)[0].actorId, 'agent_secretary');
    const snapshot = core.workspace.snapshots(target)[0];
    assert.equal(snapshot.actorId, 'agent_secretary');
    const changed = await core.workspace.edit({
      ...target,
      op: 'write',
      args: { text: '## 无关联\n正文' },
    });
    assert.equal(core.db.prepare('SELECT COUNT(*) AS n FROM log_file_references').get().n, 0);
    await core.workspace.undo(changed.revisionId);
    assert.equal(core.db.prepare('SELECT COUNT(*) AS n FROM log_file_references').get().n, 2);
    await core.workspace.edit({ ...target, op: 'write', args: { text: '## 另一条' } });
    await core.workspace.restoreSnapshot(snapshot.id);
    assert.deepEqual(parseLog((await core.workspace.read(target)).text)[0].references, references);
    core.db.exec('DELETE FROM log_file_references');
    await core.workspace.read(target);
    assert.equal(core.db.prepare('SELECT COUNT(*) AS n FROM log_file_references').get().n, 2);
    await writeFile(
      path.join(core.workspace.locate.projectDir(project.id), 'workbench/log.md'),
      '## 外部改写\n正文',
    );
    await core.workspace.read(target);
    assert.equal(core.db.prepare('SELECT COUNT(*) AS n FROM log_file_references').get().n, 0);
    assert.equal(core.workspace.history(target)[0].op, 'external');
    const opened = [];
    const journalFiles = createJournalFiles(core, {
      open: async (file) => {
        opened.push(file);
      },
    });
    await journalFiles.open(project.id, references[0]);
    await journalFiles.open(project.id, references[1]);
    assert.deepEqual(opened, [versions.file(version.id), files.locate(project.id, '中文脚本.py')]);
    assert.match(files.locate(project.id, references[1].path), /中文脚本\.py$/u);
  });
});
