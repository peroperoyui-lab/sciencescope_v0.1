import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Completed model steps are durable, including thinking and tool receipts.
 * A missing or corrupt record must reach the caller, which rebuilds from the
 * canonical meeting instead of silently pretending this is a resumed session.
 * @param {string} home
 */
export function sessionStore(home) {
  const folder = path.join(home, 'pi', 'sessions');
  const file = (id) => path.join(folder, `${id}.json`);
  return {
    async read(id) {
      const record = JSON.parse(await readFile(file(id), 'utf8'));
      if (record.schema !== 1 || !Array.isArray(record.messages))
        throw new Error('Invalid pi session');
      return record.messages;
    },
    async write(id, messages) {
      await mkdir(folder, { recursive: true });
      const temporary = file(id) + `.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify({ schema: 1, messages }), 'utf8');
      await rename(temporary, file(id));
    },
  };
}
