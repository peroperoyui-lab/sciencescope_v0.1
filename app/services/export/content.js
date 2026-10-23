import path from 'node:path';
import { meetingMarkdown } from '../export.js';
import { fileName } from './paths.js';
import { records, itemMarkdown, markdownCore } from './records.js';
import { decodeRow } from './writer.js';

/** @param {any} context */
export async function planMeetings({ db, writer, paths, projectFolders }) {
  const view = markdownCore(db);
  for (const meeting of records(db, 'SELECT * FROM meetings ORDER BY created_at,id')) {
    writer.check();
    const folder = meeting.project_id ? projectFolders.get(meeting.project_id) : '不属于项目';
    const base = `对话/${folder}/${fileName(meeting.title)}-${fileName(meeting.id)}`;
    writer.text(`${base}.md`, () => meetingMarkdown(view, meeting.id));
    writer.json(`${base}.json`, () => ({
      ...meeting,
      members: records(
        db,
        'SELECT * FROM meeting_members WHERE meeting_id=? ORDER BY position',
        meeting.id,
      ),
      messages: records(
        db,
        'SELECT * FROM messages WHERE meeting_id=? ORDER BY seq',
        meeting.id,
      ).map((message) => ({
        ...message,
        author: decodeRow(
          db.prepare('SELECT * FROM participants WHERE id=?').get(message.author_id),
        ),
        deliverables: records(
          db,
          'SELECT * FROM message_deliverables WHERE message_id=?',
          message.id,
        ),
        research_input: records(
          db,
          'SELECT * FROM message_research_input WHERE message_id=?',
          message.id,
        ),
        tool_calls: message.turn_id
          ? records(db, 'SELECT * FROM tool_calls WHERE turn_id=? ORDER BY seq', message.turn_id)
          : [],
      })),
      turns: records(db, 'SELECT * FROM turns WHERE meeting_id=? ORDER BY started_at', meeting.id),
    }));
  }
  await writer.tree(paths.deliverables, '对话/附件/交付文件');
  for (const image of records(db, 'SELECT * FROM input_images'))
    await writer.copy(
      path.resolve(paths.library, image.original_path),
      `对话/附件/图片/${fileName(image.id)}/${fileName(image.name, 255)}`,
    );
}

/** @param {any} context */
export async function planKnowledge({ db, writer, paths, includeProjectCopies }) {
  writer.rows('知识库/资料.json', () =>
    db.prepare('SELECT * FROM rb_sources ORDER BY created_at,id').iterate(),
  );
  writer.rows('知识库/实体.json', () =>
    db.prepare('SELECT * FROM kb_entities ORDER BY created_at,id').iterate(),
  );
  writer.rows('知识库/关系.json', () =>
    db.prepare('SELECT * FROM kb_edges ORDER BY created_at,id').iterate(),
  );
  for (const source of db.prepare('SELECT * FROM rb_sources ORDER BY created_at,id').iterate()) {
    writer.check();
    writer.text(`知识库/正文/${fileName(String(source.id))}.md`, () => {
      const lines = [`# ${source.title}`, '', `资料：${source.id}`, ''];
      for (const chunk of records(
        db,
        'SELECT * FROM rb_chunks WHERE source_id=? ORDER BY ordinal',
        source.id,
      )) {
        lines.push(
          `<!-- ${chunk.id}; page=${chunk.page ?? ''}; section=${chunk.section ?? ''} -->`,
          chunk.text,
          '',
        );
      }
      return lines.join('\n');
    });
    if (source.original_path && (source.folder_path == null || includeProjectCopies))
      await writer.copy(
        path.resolve(paths.library, String(source.original_path)),
        `知识库/原件/${fileName(String(source.id))}/${fileName(String(source.name || source.title), 255)}`,
      );
  }
  for (const item of records(db, 'SELECT * FROM rb_items ORDER BY created_at,id')) {
    writer.check();
    const base = `知识库/条目/${fileName(item.title)}-${fileName(item.id)}`;
    writer.text(`${base}.md`, itemMarkdown(item));
    writer.json(`${base}.json`, item);
  }
}
