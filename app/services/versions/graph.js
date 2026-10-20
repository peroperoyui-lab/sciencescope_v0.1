// Graph metadata stays in SQLite. Tier names also live in settings; compensate
// the captured rows if the ordinary workspace edit fails, without a new
// cross-store transaction or changes to workspace history.
import { AppError } from '../../core/errors.js';
import { nowIso } from '../../core/ids.js';

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
        'SELECT id,parent_id,deleted_at FROM manuscript_versions WHERE group_id=? ORDER BY number',
      )
      .all(groupId);
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
    const nodes = [];
    for (const row of rows.filter((entry) => !entry.deleted_at)) {
      const version = catalog.get(row.id);
      const notes = await core.workspace.read({
        resource: 'versions',
        key: `${group.projectId}/${version.id}`,
      });
      const instructions = db
        .prepare(
          `SELECT instruction FROM desk_changes WHERE version_id=? AND trim(instruction)<>''
         GROUP BY instruction ORDER BY min(rowid) LIMIT 10`,
        )
        .all(version.id)
        .map((entry) => String(entry.instruction));
      nodes.push({
        id: version.id,
        number: version.number,
        parentId: visibleParent(row),
        branch: version.branch,
        tier: version.tier,
        label: version.label,
        title: version.title,
        displayTitle: version.title || version.name,
        origin: version.origin,
        createdAt: version.createdAt,
        notesExcerpt: Array.from(notes.text ?? '')
          .slice(0, 200)
          .join(''),
        instructions,
      });
    }
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
        db.prepare('UPDATE manuscript_versions SET title=?,tier=?,label=? WHERE id=?').run(
          next.title,
          next.tier,
          next.label,
          id,
        );
        db.prepare('UPDATE version_groups SET updated_at=? WHERE id=?').run(
          nowIso(),
          version.groupId,
        );
        catalog.changed(version.projectId, 'metadata', id, actorId);
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
