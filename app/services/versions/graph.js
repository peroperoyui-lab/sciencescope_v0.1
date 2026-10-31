// Graph metadata stays in SQLite. Tier names also live in settings; compensate
// the captured rows if the ordinary workspace edit fails, without a new
// cross-store transaction or changes to workspace history.
import { AppError } from '../../core/errors.js';
import { nowIso } from '../../core/ids.js';

const NOTE_READ_CONCURRENCY = 4;

/**
 * @param {import('../../core/index.js').Core} core
 * @param {(work:()=>Promise<any>)=>Promise<any>} serial
 */
export function createVersionGraph(core, serial) {
  const { db, versionCatalog: catalog } = core;
  async function graph(groupId) {
    const group = catalog.group(groupId);
    const rows = db
      .prepare(
        `SELECT id,number,parent_id,deleted_at,branch,tier,label,description,is_key,title,
         original_name,origin,created_at FROM manuscript_versions WHERE group_id=? ORDER BY number`,
      )
      .all(groupId);
    const visible = rows.filter((row) => !row.deleted_at);
    const instructions = new Map();
    for (const entry of db
      .prepare(
        `WITH distinct_instructions AS (
         SELECT version_id,instruction,min(rowid) AS first_row FROM desk_changes
         WHERE version_id IN (SELECT value FROM json_each(?)) AND trim(instruction)<>''
         GROUP BY version_id,instruction
       ), ranked AS (
         SELECT version_id,instruction,
           row_number() OVER (PARTITION BY version_id ORDER BY first_row) AS position
         FROM distinct_instructions
       ) SELECT version_id,instruction FROM ranked WHERE position<=10
       ORDER BY version_id,position`,
      )
      .all(JSON.stringify(visible.map((row) => row.id)))) {
      if (!instructions.has(entry.version_id)) instructions.set(entry.version_id, []);
      instructions.get(entry.version_id).push(String(entry.instruction));
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    function visibleParent(row) {
      const seen = new Set([row.id]);
      let ancestor = byId.get(row.parent_id);
      while (ancestor && !seen.has(ancestor.id)) {
        if (!ancestor.deleted_at) return String(ancestor.id);
        seen.add(ancestor.id);
        ancestor = byId.get(ancestor.parent_id);
      }
      return null;
    }
    const nodes = new Array(visible.length);
    let next = 0;
    let failed = false;
    let failure;
    async function readNext() {
      while (!failed && next < visible.length) {
        const index = next++;
        const row = visible[index];
        try {
          const notes = await core.workspace.read({
            resource: 'versions',
            key: `${group.projectId}/${row.id}`,
          });
          nodes[index] = {
            id: String(row.id),
            number: Number(row.number),
            parentId: visibleParent(row),
            branch: String(row.branch),
            tier: String(row.tier),
            label: String(row.label),
            description: String(row.description),
            key: Boolean(row.is_key),
            title: String(row.title),
            displayTitle: String(row.title || row.original_name),
            origin: String(row.origin),
            createdAt: String(row.created_at),
            notesExcerpt: Array.from(notes.text ?? '')
              .slice(0, 200)
              .join(''),
            instructions: instructions.get(row.id) ?? [],
          };
        } catch (error) {
          if (!failed) failure = error;
          failed = true;
        }
      }
    }
    // Finish in-flight workspace reads before reporting an error; their revision
    // detection must not outlive the request that started them.
    await Promise.all(
      Array.from({ length: Math.min(NOTE_READ_CONCURRENCY, visible.length) }, readNext),
    );
    if (failed) throw failure;
    return { group, nodes };
  }
  function updateMetadata(id, changes, actorId = 'person_user') {
    return serial(async () => {
      const version = catalog.get(id);
      const next = { ...version };
      for (const field of ['title', 'label', 'tier', 'branch']) {
        if (changes[field] === undefined) continue;
        if (typeof changes[field] !== 'string')
          throw new AppError('INVALID_VERSION_METADATA', 'Version metadata must be text.');
        next[field] = changes[field];
      }
      if (changes.description !== undefined) {
        if (typeof changes.description !== 'string')
          throw new AppError('INVALID_VERSION_METADATA', 'Version description must be text.');
        next.description = changes.description.trim();
        if (Array.from(next.description).length > 2000)
          throw new AppError(
            'VERSION_DESCRIPTION_TOO_LONG',
            'Version description must contain at most 2,000 characters.',
          );
      }
      if (changes.key !== undefined) {
        if (typeof changes.key !== 'boolean')
          throw new AppError('INVALID_VERSION_METADATA', 'Version key must be a boolean.');
        next.key = changes.key;
      }
      if (changes.tier !== undefined && next.tier) {
        const settings = await core.workspace.read({ resource: 'settings', key: 'app' });
        if (!settings.value.desk.tiers.includes(next.tier))
          throw new AppError('INVALID_TIER', 'Choose a tier from the editing desk settings.');
      }
      db.transaction(() => {
        if (next.branch !== version.branch) {
          if (
            db
              .prepare('SELECT 1 FROM manuscript_versions WHERE group_id=? AND branch=?')
              .get(version.groupId, next.branch)
          )
            throw new AppError('BRANCH_EXISTS', 'This group already has a branch with that name.');
          db.prepare('UPDATE manuscript_versions SET branch=? WHERE group_id=? AND branch=?').run(
            next.branch,
            version.groupId,
            version.branch,
          );
        }
        db.prepare(
          'UPDATE manuscript_versions SET title=?,tier=?,label=?,description=?,is_key=? WHERE id=?',
        ).run(next.title, next.tier, next.label, next.description, Number(next.key), id);
        db.prepare('UPDATE version_groups SET updated_at=? WHERE id=?').run(
          nowIso(),
          version.groupId,
        );
        let action = 'metadata';
        if (next.description !== version.description) action = 'marked';
        else if (next.key !== version.key) action = 'key-changed';
        catalog.changed(version.projectId, action, id, actorId);
      });
      return catalog.get(id);
    });
  }
  function renameTier(from, to, actorId = 'person_user') {
    return serial(async () => {
      const target = { resource: 'settings', key: 'app' };
      const before = await core.workspace.read(target);
      const tiers = before.value.desk.tiers;
      if (!tiers.includes(from) || typeof to !== 'string' || !to.trim())
        throw new AppError('INVALID_TIER', 'Choose an existing tier and enter a new name.');
      if (from === to) return { tiers, updated: 0 };
      if (tiers.includes(to))
        throw new AppError('TIER_EXISTS', 'A tier with that name already exists.');
      const affected = db
        .prepare(
          `SELECT v.id,v.group_id,g.project_id FROM manuscript_versions v
         JOIN version_groups g ON g.id=v.group_id WHERE v.tier=?`,
        )
        .all(from);
      db.transaction(() => {
        db.prepare('UPDATE manuscript_versions SET tier=? WHERE tier=?').run(to, from);
      });
      const updatedTiers = tiers.map((tier) => (tier === from ? to : tier));
      try {
        await core.workspace.edit(
          {
            ...target,
            op: 'patch',
            args: { changes: { desk: { tiers: updatedTiers } } },
            expectedRevisionId: before.revisionId,
          },
          { actorId },
        );
      } catch (error) {
        // Restore only this operation's rows, not pre-existing raw tier names
        // or versions created while the settings file was being saved.
        db.transaction(() => {
          const restore = db.prepare('UPDATE manuscript_versions SET tier=? WHERE id=? AND tier=?');
          for (const row of affected) restore.run(from, row.id, to);
        });
        throw new AppError(
          'TIER_RENAME_FAILED',
          `Could not save the tier settings; version tiers were restored. ${error.message}`,
        );
      }
      db.transaction(() => {
        const groups = new Map(affected.map((row) => [row.group_id, row.project_id]));
        for (const [groupId, projectId] of groups) {
          db.prepare('UPDATE version_groups SET updated_at=? WHERE id=?').run(nowIso(), groupId);
          catalog.changed(String(projectId), 'tier-renamed', String(groupId), actorId);
        }
      });
      return { tiers: updatedTiers, updated: affected.length };
    });
  }
  return { graph, updateMetadata, renameTier };
}
