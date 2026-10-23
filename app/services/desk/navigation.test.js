import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { withCore } from '../../testing.js';
import { createAppServer } from '../../server/server.js';
import { setupAnnotations } from './annotation-testing.js';
import { annotationText } from './annotation-anchors.js';

async function apiFor(core, f) {
  const server = createAppServer({ core, desk: f.desk, versions: f.versions, token: 'desk-nav' });
  const url = await server.listen();
  return {
    close: () => server.close(),
    async post(route, body, status = 200) {
      const response = await fetch(url + '/api/desk/' + route, {
        method: 'POST',
        headers: { authorization: 'Bearer desk-nav', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      assert.equal(response.status, status, JSON.stringify(result));
      return result;
    },
  };
}

test('desk entry continues, forks or chooses recent activity and rebinds only future changes', () =>
  withCore('desk-enter', async (core, dir) => {
    const f = await setupAnnotations(core, dir, 'md');
    const api = await apiFor(core, f);
    const events = [];
    const unsubscribe = core.events.subscribe((event) => events.push(event));
    try {
      const projectId = f.project.id;
      const first = await api.post('enter', { projectId, mode: 'continue' });
      assert.equal(first.created, true);
      assert.equal(first.meeting.title, '编辑台');
      assert.deepEqual(first.sessionIds, [f.id]);
      const meetingId = first.meeting.id;
      const original = core.meetings.get(meetingId);
      assert.deepEqual(
        original.members.map((member) => member.participantId),
        ['person_user', 'agent_main'],
      );
      assert.equal(original.workFolder, f.folder);
      assert.equal(
        (await api.post('enter', { projectId, meetingId, mode: 'branch' }, 400)).code,
        'DESK_BRANCH_EMPTY',
      );
      await f.replace('第二段', '修改第二段');
      const change = (await f.desk.getSession(f.id)).changes[0];
      assert.equal(change.meetingId, meetingId);
      await copyFile(f.file, path.join(f.folder, '另一份.md'));
      const group = await f.desk.registerDocument({ projectId, path: '另一份.md' });
      const secondSession = await f.desk.openSession({ groupId: group.id, meetingId });
      const messages = ['研究目标', '论文建议'].map((text) =>
        core.messages.post({ meetingId, authorId: 'person_user', text }),
      );
      const before = core.meetings.get(meetingId);
      const branch = await api.post('enter', { projectId, meetingId, mode: 'branch' });
      assert.equal(branch.created, true);
      assert.equal(branch.meeting.parentMeetingId, meetingId);
      assert.equal(core.meetings.get(branch.meeting.id).forkMessageId, messages[1].id);
      assert.equal(core.messages.list(meetingId).messages.length, 2);
      assert.equal(core.messages.list(branch.meeting.id).messages.length, 2);
      assert.deepEqual(core.meetings.get(meetingId), before);
      assert.deepEqual(new Set(branch.sessionIds), new Set([f.id, secondSession.session.id]));
      await f.replace('修改第二段', '再次修改第二段');
      const changed = await f.desk.getSession(f.id);
      assert.equal(changed.changes[0].meetingId, meetingId);
      assert.equal(changed.changes[1].meetingId, branch.meeting.id);
      const reopened = await api.post('sessions', { groupId: f.group.id, meetingId });
      assert.equal(reopened.session.id, f.id);
      assert.equal(reopened.session.meetingId, meetingId);
      const continued = await api.post('enter', { projectId, meetingId, mode: 'continue' });
      assert.equal(continued.created, false);
      const cut = await api.post('enter', {
        projectId,
        meetingId,
        mode: 'branch',
        atMessageId: messages[0].id,
      });
      assert.equal(core.messages.list(cut.meeting.id).messages.length, 1);
      // Pinned and archived chats must not outrank actual last activity.
      core.meetings.update(meetingId, { pinned: true });
      core.meetings.update(cut.meeting.id, { archived: true });
      core.db.prepare('UPDATE meetings SET updated_at=? WHERE id=?').run('2000-01-01', meetingId);
      core.db
        .prepare('UPDATE meetings SET updated_at=? WHERE id=?')
        .run('2099-01-01', cut.meeting.id);
      assert.equal(
        (await api.post('enter', { projectId, mode: 'continue' })).meeting.id,
        branch.meeting.id,
      );
      const other = await core.projects.create({ name: '其他项目' });
      assert.equal(
        (await api.post('enter', { projectId: other.id, meetingId, mode: 'continue' }, 400)).code,
        'DESK_MEETING_PROJECT',
      );
      const fresh = await api.post('enter', { projectId: other.id, mode: 'continue' });
      assert.equal(
        core.meetings.get(fresh.meeting.id).workFolder,
        core.workspace.locate.projectDir(other.id),
      );
      assert.deepEqual(events.filter((event) => event.type === 'desk.entered').at(-1).payload, {
        projectId: other.id,
        meetingId: fresh.meeting.id,
        mode: 'continue',
      });
      assert.deepEqual(core.turns.running(), []);
    } finally {
      unsubscribe();
      await api.close();
      await f.close();
    }
  }));

for (const format of ['docx', 'tex'])
  test(`desk focus resolves ${format} current text, moved quotes, ambiguity and old versions`, () =>
    withCore('desk-focus-' + format, async (core, dir) => {
      const f = await setupAnnotations(core, dir, format);
      const api = await apiFor(core, f);
      const events = [];
      const unsubscribe = core.events.subscribe((event) => events.push(event));
      try {
        const location = {
          blockId: f.opened.blocks[0].id,
          characters: { start: 2, end: 6 },
          quote: { exact: '甲乙丙丁', prefix: '前文', suffix: '后文。' },
        };
        const reference = {
          schema: 1,
          kind: 'project-file',
          projectId: f.project.id,
          path: path.basename(f.file),
          location,
        };
        const focus = () => api.post('focus', { reference });
        const first = await focus();
        assert.equal(first.status, 'exact');
        assert.equal(first.sessionId, f.id);
        assert.equal(first.from, 2);
        const oldVersion = first.versionId;
        const whole = await api.post('focus', {
          reference: { ...reference, location: { blockId: location.blockId } },
        });
        assert.equal(whole.from, 0);
        assert.equal(whole.to, annotationText(f.opened.blocks[0]).length);
        await f.replace('前文', '新增前文');
        assert.equal((await focus()).from, 4); // unsaved working copy wins
        await f.desk.save(f.id, { to: 'project' });
        await f.desk.closeSession(f.id);
        if (format === 'docx') {
          const zip = await JSZip.loadAsync(await readFile(f.file));
          const xml = await zip.file('word/document.xml').async('string');
          const paragraphs = [...xml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/gu)].map(
            (match) => match[0],
          );
          zip.file(
            'word/document.xml',
            xml.replace(paragraphs[0] + paragraphs[1], paragraphs[1] + paragraphs[0]),
          );
          await writeFile(f.file, await zip.generateAsync({ type: 'nodebuffer' }));
        } else {
          const text = await readFile(f.file, 'utf8');
          await writeFile(
            f.file,
            '重复甲乙丙丁不匹配。\n\n' + text.split('\n\n').reverse().join('\n\n'),
          );
        }
        const moved = await api.post('focus', {
          reference: { schema: 1, kind: 'version', id: oldVersion, location },
        });
        assert.equal(moved.status, 'moved');
        assert.equal(moved.versionId, oldVersion);
        assert.notEqual(moved.sessionId, f.id);
        const current = await f.desk.getSession(moved.sessionId);
        assert.equal(
          annotationText(current.blocks.find((block) => block.id === moved.blockId)).slice(
            moved.from,
            moved.to,
          ),
          '甲乙丙丁',
        );
        // Full-text matching must use context when the same sentence occurs twice.
        if (format === 'tex') {
          const withoutContext = await api.post('focus', {
            reference: { ...reference, location: { quote: { exact: '甲乙丙丁' } } },
          });
          assert.equal(withoutContext.status, 'missing');
        }
        await f.desk.closeSession(moved.sessionId);
        if (format === 'docx') {
          const zip = await JSZip.loadAsync(await readFile(f.file));
          zip.file(
            'word/document.xml',
            (await zip.file('word/document.xml').async('string')).replaceAll('甲乙丙丁', ''),
          );
          await writeFile(f.file, await zip.generateAsync({ type: 'nodebuffer' }));
        } else await writeFile(f.file, (await readFile(f.file, 'utf8')).replaceAll('甲乙丙丁', ''));
        const missing = await focus();
        assert.equal(missing.status, 'missing');
        assert.ok(!Object.hasOwn(missing, 'from'));
        assert.ok(!Object.hasOwn(missing, 'blockId'));
        assert.deepEqual(
          events.filter((event) => event.type === 'desk.focus').at(-1).payload,
          missing,
        );
      } finally {
        unsubscribe();
        await api.close();
        await f.close();
      }
    }));
