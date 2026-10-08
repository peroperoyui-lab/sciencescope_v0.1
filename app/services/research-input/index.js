// Draft edits are individual operations so another window, a late upload, or
// a send acknowledgement cannot replace newer selections.
import { randomUUID } from 'node:crypto';
import { AppError } from '../../core/errors.js';

/**
 * @param {{core:import('../../core/index.js').Core, research:ReturnType<typeof import('../research/index.js').createResearch>}} dependencies
 */
export function createResearchInput({ core, research }) {
  const empty = () => ({ materials: [], marks: [] });
  function draft(ownerId) {
    const row = core.db
      .prepare('SELECT input_json,version FROM research_input_drafts WHERE owner_id=?')
      .get(ownerId);
    return row
      ? { ...JSON.parse(String(row.input_json)), version: Number(row.version) }
      : { ...empty(), version: 0 };
  }
  function material(ref) {
    if (ref.type === 'item') {
      const { item } = research.read({ type: 'item', id: ref.id, audience: 'agent' });
      return {
        type: 'item',
        id: item.id,
        title: item.title,
        text: item.body,
        payload: item.payload,
      };
    }
    const source = research.store.getSource(ref.id);
    return {
      type: 'source',
      id: source.id,
      title: source.title,
      name: source.name,
      pages: source.pages,
      label: source.label,
      projectId: source.projectId,
      contentStatus: source.contentStatus,
    };
  }
  function change(ownerId, operation) {
    return core.db.transaction(() => {
      const value = draft(ownerId);
      if (operation.op === 'add') {
        const entry = material(operation.material);
        if (!value.materials.some((old) => old.id === entry.id))
          value.materials.push({ ...entry, selectionId: randomUUID() });
      } else if (operation.op === 'remove') {
        value.materials = value.materials.filter(
          (entry) => entry.selectionId !== operation.selectionId,
        );
      } else if (operation.op === 'consume') {
        for (const field of ['materials', 'marks'])
          value[field] = value[field].filter(
            (entry) =>
              !operation.input[field].some((sent) => sent.selectionId === entry.selectionId),
          );
      } else throw new AppError('INVALID_INPUT_OPERATION', '无法更新本次材料。');
      value.version += 1;
      core.db
        .prepare(
          'INSERT INTO research_input_drafts(owner_id,input_json,version) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET input_json=excluded.input_json,version=excluded.version',
        )
        .run(ownerId, JSON.stringify(value), value.version);
      core.events.record('research.input.changed', { ownerId, value });
      return value;
    });
  }
  function capture(input = empty()) {
    return {
      materials: (input.materials ?? []).map((entry) => ({
        ...material(entry),
        selectionId: entry.selectionId,
      })),
      marks: structuredClone(input.marks ?? []),
    };
  }
  return { draft, change, capture };
}
