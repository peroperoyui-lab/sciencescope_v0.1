import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseAgentFile } from '../../core/agent-file.js';
import { fileName } from './paths.js';
import { itemMarkdown, records } from './records.js';

/** @param {any} context */
export async function planConfiguration({ db, writer, paths, configuration }) {
  writer.json('设置.json', {
    ...configuration,
    python_environments: records(db, 'SELECT * FROM python_environments ORDER BY id'),
    python_bindings: records(db, 'SELECT * FROM python_bindings ORDER BY scope,target_id'),
  });
  writer.json('MCP.json', configuration.mcp);
  writer.json('专家/参与者.json', records(db, 'SELECT * FROM participants ORDER BY created_at,id'));
  for (const participant of records(
    db,
    "SELECT * FROM participants WHERE kind='ai' ORDER BY created_at,id",
  )) {
    const original = path.join(paths.agents, `${participant.id}.md`);
    const definitionText = await readFile(original, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    const definition = parseAgentFile(definitionText);
    const base = `专家/${fileName(definition.name || participant.name)}-${fileName(participant.id)}`;
    writer.text(`${base}.md`, definitionText);
    writer.json(`${base}.json`, { ...participant, definition });
    for (const memory of records(
      db,
      "SELECT * FROM rb_items WHERE type='memory' AND scope=? ORDER BY created_at,id",
      `expert:${participant.id}`,
    ))
      writer.text(
        `${base}/记忆/${fileName(memory.title)}-${fileName(memory.id)}.md`,
        itemMarkdown(memory),
      );
  }
  await writer.tree(paths.skills, '技能');
}
