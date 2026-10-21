import { createHash } from 'node:crypto';
import { citationFor } from '../citations.js';
import { LITERATURE_KINDS, payloadText } from '../records.js';
import { createResearchStore } from '../store.js';

const versionOf = (text) => createHash('sha256').update(text).digest('hex');

/** Canonical rows determine text, versions and eligible references; vectors never do.
 * @param {import('../../../core/index.js').Core} core
 */
export function createSemanticDocuments(core) {
  const store = createResearchStore({ db: core.db, events: core.events });

  function documents() {
    const result = [];
    for (const row of core.db.prepare('SELECT * FROM rb_sources ORDER BY id').all()) {
      const metadata = JSON.parse(String(row.metadata_json));
      const text = [
        row.title,
        ...(row.folder_path ? [row.name, row.folder_path] : []),
        payloadText(metadata),
      ]
        .filter(Boolean)
        .join('\n');
      result.push({
        ref: { type: 'source', id: String(row.id) },
        projectId: row.project_id == null ? null : String(row.project_id),
        sourceKind: String(row.kind),
        version: versionOf(text),
        text,
      });
    }
    for (const row of core.db
      .prepare(
        'SELECT c.*, s.project_id, s.kind AS source_kind FROM rb_chunks c JOIN rb_sources s ON s.id=c.source_id ORDER BY c.id',
      )
      .all()) {
      const text = String(row.text);
      result.push({
        ref: { type: 'chunk', id: String(row.id) },
        projectId: row.project_id == null ? null : String(row.project_id),
        sourceKind: String(row.source_kind),
        version: versionOf(text),
        text,
      });
    }
    for (const row of core.db
      .prepare("SELECT * FROM rb_items WHERE status NOT IN ('proposed','rejected') ORDER BY id")
      .all()) {
      const text = [row.title, row.body, payloadText(JSON.parse(String(row.payload_json)))]
        .filter(Boolean)
        .join('\n');
      result.push({
        ref: { type: 'item', id: String(row.id) },
        projectId: row.project_id == null ? null : String(row.project_id),
        visibility: String(row.visibility),
        status: String(row.status),
        version: versionOf(text),
        text,
      });
    }
    for (const row of core.db
      .prepare("SELECT * FROM kb_entities WHERE status='active' ORDER BY id")
      .all()) {
      const text = [row.name, row.name_en, ...JSON.parse(String(row.aliases_json)), row.description]
        .filter(Boolean)
        .join('\n');
      result.push({
        ref: { type: 'entity', id: String(row.id) },
        projectId: null,
        visibility: String(row.visibility),
        status: String(row.status),
        version: versionOf(text),
        text,
      });
    }
    return result;
  }

  /** @param {any} options */
  function candidates(options) {
    const projectId = options.projectId ?? null;
    const global = options.knowledge && !projectId;
    return documents().filter((document) => {
      if (
        global &&
        ['source', 'chunk'].includes(document.ref.type) &&
        document.projectId !== null &&
        !LITERATURE_KINDS.includes(document.sourceKind)
      )
        return false;
      if (
        !global &&
        !(
          document.ref.type === 'entity' &&
          projectId &&
          core.db
            .prepare('SELECT 1 FROM kb_memberships WHERE project_id=? AND ref=?')
            .get(projectId, 'entity:' + document.ref.id)
        ) &&
        document.projectId !== projectId &&
        !(projectId && options.includePersonal !== false && document.projectId === null)
      )
        return false;
      if (!['item', 'entity'].includes(document.ref.type)) return true;
      if (options.audience === 'agent' && document.visibility === 'private') return false;
      return options.includeSuperseded || document.status === 'active';
    });
  }

  /** @param {{type:string,id:string}} ref @param {number} score */
  function hit(ref, score) {
    if (ref.type === 'entity') {
      const row = core.db.prepare('SELECT * FROM kb_entities WHERE id=?').get(ref.id);
      return {
        type: ref.type,
        id: ref.id,
        projectId: null,
        title: String(row.name),
        text: String(row.description),
        citation: null,
        score,
      };
    }
    if (ref.type === 'item') {
      const item = store.getItem(ref.id);
      return {
        type: ref.type,
        id: ref.id,
        projectId: item.projectId,
        title: item.title,
        text: item.body,
        citation: `[@${item.id.replace(/^itm_/u, '').slice(0, 8)}]`,
        score,
      };
    }
    const chunk = ref.type === 'chunk' ? store.getChunk(ref.id) : null;
    const source = store.getSource(chunk?.sourceId ?? ref.id);
    return {
      type: ref.type,
      id: ref.id,
      sourceId: source.id,
      folderPath: source.folderPath,
      projectId: source.projectId,
      title: source.title,
      text: chunk?.text ?? source.metadata?.abstract ?? source.title,
      ordinal: chunk?.ordinal ?? null,
      page: chunk?.page ?? null,
      section: chunk?.section ?? null,
      citation: citationFor(source, chunk),
      score,
    };
  }

  return { documents, candidates, hit };
}
