import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import * as sqliteVec from 'sqlite-vec';
import JSZip from 'jszip';
import { createFullExport, meetingMarkdown, exportProject } from '../export.js';
import { createVectorStore } from '../research/semantic/vector-store.js';
import { createSemanticDocuments } from '../research/semantic/documents.js';
import { withExportFixture, populateExportFixture, filesIn, exportEvent } from './testing.js';
import { hashText } from '../../core/workspace/files.js';

test(
  'full export preserves research records, original bytes and readable configuration without stored credentials',
  {
    timeout: 90_000,
  },
  (t) =>
    withExportFixture(async (f) => {
      const data = await populateExportFixture(f);
      const { core } = f;
      const vector = new Float32Array(384);
      vector[0] = 1;
      const vectors = await createVectorStore({
        db: core.db,
        embedding: { embedPassages: async (texts) => texts.map(() => vector) },
        modelId: 'fixture',
        modelVersion: '1',
      });
      await vectors.upsertDocuments(createSemanticDocuments(core).documents());
      await vectors.close();
      // Keep both exports in the same named minute so this checks collisions,
      // even when slow disk work crosses a real wall-clock minute boundary.
      t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T00:00:00Z') });
      const service = createFullExport(core);
      const finished = exportEvent(core, 'export.finished');
      try {
        const first = await service.start({ target: f.target });
        assert.match(first.folder, /（未完成）$/u);
        assert.deepEqual(
          await service.start({ target: f.target, includeProjectCopies: true }),
          first,
        );
        const result = await finished.promise;
        assert.equal(result.cancelled, false);
        assert.equal(result.error, undefined);
        const state = service.get(first.jobId);
        assert.equal(state.phase, 'finished', state.error);
        assert.doesNotMatch(state.folder, /（未完成）$/u);
        const files = await filesIn(state.folder);
        assert.equal(result.files, files.length);
        const sensitive = [
          data.fakeProviderKey,
          data.fakeMcpKey,
          data.oldHeader,
          data.currentHeader,
          data.rawMcpHeader,
          data.rawMcpEnv,
          'FAKE_R5_EXCLUDED_PRIVATE_CONTENT',
        ];
        let actualBytes = 0;
        for (const file of files) {
          assert.ok(
            Buffer.byteLength(path.basename(file)) <= 255,
            'filename fits UTF-8 component boundary',
          );
          const bytes = await readFile(file);
          actualBytes += bytes.length;
          for (const secret of sensitive)
            assert.equal(
              bytes.includes(Buffer.from(secret)),
              false,
              path.relative(state.folder, file),
            );
          if (file.endsWith('.json'))
            assert.doesNotThrow(() => JSON.parse(bytes.toString('utf8')), file);
        }
        assert.equal(result.bytes, actualBytes);
        const names = files.map((file) => path.relative(state.folder, file).replaceAll('\\', '/'));
        assert.ok(names.some((name) => name.endsWith('/项目文件夹/internal-only.txt')));
        assert.ok(!names.some((name) => name.endsWith('/项目文件夹/external-only.txt')));
        assert.ok(
          names.some((name) =>
            name.endsWith(`/原件/${data.globalSource.id}/${data.longOriginalName}`),
          ),
        );
        const imageFile = files.find((file) =>
          file.endsWith(`${path.sep}${data.image.id}${path.sep}${data.image.name}`),
        );
        assert.ok(imageFile, 'original image retains its complete filename');
        assert.deepEqual(await readFile(imageFile), data.imageBytes);
        assert.ok(!names.some((name) => name.includes(`/原件/${data.projectSource.id}/`)));
        assert.match(await readFile(path.join(state.folder, 'README.md'), 'utf8'), /VACUUM INTO/);
        const config = JSON.parse(await readFile(path.join(state.folder, '设置.json'), 'utf8'));
        assert.equal(config.providers[0].keyRef, 'provider-fixture');
        assert.deepEqual(config.providers[0].headers, {
          'X-Custom': '<已移除>',
          'User-Agent': '<已移除>',
        });
        assert.equal(config.python_environments[0].id, 'env-fixture');
        const mcp = JSON.parse(await readFile(path.join(state.folder, 'MCP.json'), 'utf8'));
        assert.equal(
          mcp.servers[0].headers.Authorization.keyRef,
          'mcp.fixture-mcp.headers.Authorization',
        );
        assert.equal(mcp.servers[1].headers['X-Raw'], '<已移除>');
        assert.equal(mcp.servers[1].env.RAW_TOKEN, '<已移除>');
        assert.deepEqual(mcp.servers[1].env.REFERENCED, { keyRef: 'mcp-reference-name' });
        const redaction = JSON.parse(
          await readFile(path.join(state.folder, '脱敏记录.json'), 'utf8'),
        );
        assert.ok(
          redaction.modified.some(
            (entry) => entry.table === 'events' && entry.column === 'payload_json',
          ),
        );
        assert.ok(
          redaction.modified.some(
            (entry) => entry.table === 'revisions' && entry.column === 'before_text',
          ),
        );
        assert.ok(
          redaction.modified.some(
            (entry) => entry.table === 'resource_snapshots' && entry.column === 'content_text',
          ),
        );
        const originalSettings = JSON.parse(await readFile(core.paths.settings, 'utf8'));
        assert.equal(originalSettings.providers[0].headers['X-Custom'], data.currentHeader);
        assert.ok(
          core.db
            .prepare('SELECT 1 FROM revisions WHERE before_text LIKE ? OR after_text LIKE ?')
            .get(`%${data.oldHeader}%`, `%${data.oldHeader}%`),
        );
        const meetingFile = files.find((file) => file.endsWith(`-${data.meeting.id}.json`));
        assert.ok(meetingFile, 'long meeting title retains the ID and JSON extension');
        assert.ok(
          files.includes(meetingFile.replace(/\.json$/u, '.md')),
          'long meeting title retains the paired Markdown extension',
        );
        const record = JSON.parse(await readFile(meetingFile, 'utf8'));
        assert.equal(record.messages.length, 2);
        assert.equal(record.messages[0].refs_json.marked, true);
        assert.equal(
          record.messages[0].research_input[0].input_json.marks[0].text,
          'Marked passage',
        );
        assert.equal(record.messages[1].tool_calls[0].result_json.text, 'Tool result summary');
        assert.equal(record.messages[1].author.name, '合成专家');
        assert.equal(
          await readFile(meetingFile.replace(/\.json$/u, '.md'), 'utf8'),
          await meetingMarkdown(core, data.meeting.id),
        );
        const branch = JSON.parse(
          await readFile(
            files.find((file) => file.endsWith(`-${data.branch.id}.json`)),
            'utf8',
          ),
        );
        assert.equal(branch.archived, 1);
        assert.equal(branch.parent_meeting_id, data.meeting.id);
        assert.ok(names.some((name) => name.startsWith('对话/不属于项目/')));
        const versions = JSON.parse(
          await readFile(
            files.find(
              (file) =>
                file.replaceAll('\\', '/').endsWith('/编辑台/版本.json') &&
                file.includes(data.internal.id),
            ),
            'utf8',
          ),
        );
        assert.equal(versions[1].parent_id, versions[0].id);
        assert.match(
          await readFile(path.join(state.folder, versions[1].export_path), 'utf8'),
          /Second manuscript/,
        );
        const annotations = JSON.parse(
          await readFile(
            files.find(
              (file) =>
                file.replaceAll('\\', '/').endsWith('/编辑台/批注.json') &&
                file.includes(data.internal.id),
            ),
            'utf8',
          ),
        );
        assert.equal(annotations.manuscript_comments[0].text, 'Synthetic annotation');
        assert.equal(annotations.manuscript_bindings[0].id, 'fixture-binding');
        assert.ok(names.some((name) => name.includes('/记忆/') && name.endsWith('.md')));
        assert.ok(
          names.some(
            (name) =>
              name.startsWith('知识库/条目/Synthetic paper card-') && name.endsWith('.json'),
          ),
        );
        assert.ok(names.includes('技能/fixture-skill/SKILL.md'));
        const snapshot = new DatabaseSync(path.join(state.folder, '数据库/sciencescope.sqlite'), {
          readOnly: true,
          allowExtension: true,
        });
        try {
          snapshot.enableLoadExtension(true);
          sqliteVec.load(snapshot);
          snapshot.enableLoadExtension(false);
          for (const row of core.db
            .prepare(
              "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            )
            .all()) {
            const table = `"${String(row.name).replaceAll('"', '""')}"`;
            assert.equal(
              snapshot.prepare(`SELECT count(*) n FROM ${table}`).get().n,
              core.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,
              String(row.name),
            );
            for (const recordRow of snapshot.prepare(`SELECT * FROM ${table}`).iterate())
              for (const value of Object.values(recordRow)) {
                const bytes =
                  typeof value === 'string'
                    ? Buffer.from(value)
                    : value instanceof Uint8Array
                      ? Buffer.from(value)
                      : null;
                if (bytes)
                  for (const secret of sensitive)
                    assert.equal(bytes.includes(Buffer.from(secret)), false, String(row.name));
              }
          }
          for (const revision of snapshot
            .prepare('SELECT after_text,after_hash FROM revisions')
            .all())
            assert.equal(
              revision.after_hash,
              hashText(revision.after_text == null ? null : String(revision.after_text)),
            );
          for (const revision of snapshot
            .prepare('SELECT content_text,content_hash FROM resource_snapshots')
            .all())
            assert.equal(
              revision.content_hash,
              hashText(revision.content_text == null ? null : String(revision.content_text)),
            );
        } finally {
          snapshot.close();
        }
        // Existing exports keep their original Markdown/ZIP contract.
        const old = await exportProject(core, data.internal.id);
        assert.match(old.name, /\.zip$/u);
        assert.ok(
          Object.keys((await JSZip.loadAsync(old.zip)).files).some((name) =>
            name.endsWith(`-${data.meeting.id}.md`),
          ),
        );
        const secondFinished = exportEvent(core, 'export.finished');
        try {
          const second = await service.start({ target: f.target, includeProjectCopies: true });
          assert.notEqual(second.folder, first.folder);
          assert.match(second.folder, / \(2\)（未完成）$/u);
          await secondFinished.promise;
          const secondFiles = await filesIn(service.get(second.jobId).folder);
          assert.ok(
            secondFiles.some((file) =>
              file.includes(`${path.sep}原件${path.sep}${data.projectSource.id}${path.sep}`),
            ),
          );
          assert.equal((await readdir(f.target)).length, 2);
        } finally {
          secondFinished.cancel();
        }
      } finally {
        finished.cancel();
        await service.close();
      }
    }),
);
