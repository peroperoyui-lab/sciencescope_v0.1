// Draft edits are individual operations so another window, a late upload, or
// a send acknowledgement cannot replace newer selections.
import { randomUUID } from 'node:crypto';
import { AppError } from '../../core/errors.js';
import { imageAttachments, imageMime } from './images.js';

/**
 * @param {{core:import('../../core/index.js').Core, research:ReturnType<typeof import('../research/index.js').createResearch>}} dependencies
 */
export function createResearchInput({ core, research }) {
  const images = imageAttachments(core);
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
    if (ref.type === 'image') return images.get(ref.id);
    if (ref.type === 'version-notes') {
      const version = core.versionCatalog.get(ref.id);
      return {
        type: 'version-notes',
        id: version.id,
        title: `${version.name} · 版本说明`,
        key: `${version.projectId}/${version.id}`,
        text: ref.text ?? '',
        reference: { schema: 1, kind: 'version', id: version.id, projectId: version.projectId },
      };
    }
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
      } else if (operation.op === 'mark-add') {
        value.marks.push({ ...operation.mark, id: randomUUID(), selectionId: randomUUID() });
      } else if (operation.op === 'mark-edit') {
        value.marks = value.marks.map((mark) =>
          mark.id === operation.id
            ? { ...mark, comment: operation.comment, selectionId: randomUUID() }
            : mark,
        );
      } else if (operation.op === 'mark-remove') {
        value.marks = value.marks.filter((mark) => mark.id !== operation.id);
      } else if (operation.op === 'marks-clear') {
        value.marks = [];
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
      } else if (operation.op === 'restore') {
        for (const field of ['materials', 'marks'])
          for (const entry of operation.input[field] ?? [])
            if (
              !value[field].some((old) =>
                field === 'marks' ? old.id === entry.id : old.selectionId === entry.selectionId,
              )
            )
              value[field].push(entry);
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
  // HTTP acceptance and model completion are separate events. A provider
  // failure restores the submitted selections without replacing newer drafts.
  const unsubscribe = core.events.subscribe((event) => {
    if (
      event.type !== 'turn.ended' ||
      event.payload.status !== 'failed' ||
      !event.payload.triggerMessageId
    )
      return;
    const message = core.messages.get(event.payload.triggerMessageId);
    if (message.researchInput?.materials.length || message.researchInput?.marks.length)
      change(message.meetingId, { op: 'restore', input: message.researchInput });
  });
  async function attach(owner, { name, base64, projectId }) {
    const bytes = Buffer.from(base64, 'base64');
    const entry = imageMime(name)
      ? await images.save(name, bytes)
      : { type: 'source', ...(await research.importSource({ name, bytes, projectId })) };
    return change(owner, { op: 'add', material: entry });
  }
  return { draft, change, capture, attach, image: images.content, close: unsubscribe };
}
