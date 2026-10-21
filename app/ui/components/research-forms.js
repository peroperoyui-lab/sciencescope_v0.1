import { useState } from 'preact/hooks';
import { useActions } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import {
  ResearchField,
  ResearchSelect,
  authorText,
  researchSubtypes,
  sourceKinds,
} from './research-fields.js';
import { entityKinds, kindLabel } from './knowledge-fields.js';

/** @param {{item:any,replace?:boolean,onSaved:()=>void}} props */
export function ResearchItemForm({ item, replace = false, onSaved }) {
  const actions = useActions();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function save(event) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const formData = new FormData(event.currentTarget);
      const values = Object.fromEntries(formData);
      const patch = {
        title: values.title,
        body: values.body,
        subtype: values.subtype,
        visibility: values.visibility,
        payload: values.payload ? JSON.parse(String(values.payload)) : (item.payload ?? {}),
      };
      if (item.id && !replace)
        await (item.type === 'memory' ? actions.updateMemory : actions.updateResearchItem)(
          item.id,
          { ...patch, expectedRevision: item.revision },
        );
      else
        await actions.createResearchItem({
          ...patch,
          type: item.type,
          projectId: item.projectId,
          scope: item.scope,
          ...(replace ? { supersedes: item.id, expectedRevision: item.revision } : {}),
        });
      actions.closeModal();
      onSaved();
    } catch (caught) {
      setError(caught.message + (caught.status === 409 ? t(' 请刷新后重试。') : ''));
    } finally {
      setPending(false);
    }
  }
  return html`<form class="rb-dialog" id="rb-item-form" onSubmit=${save}>
    <${ResearchField} label="标题" name="title" value=${item.title} required />
    <${ResearchSelect}
      label="子类型"
      name="subtype"
      value=${item.subtype}
      options=${researchSubtypes[item.type]}
    />
    <${ResearchField} label="内容" name="body" value=${item.body} textarea />
    ${['model', 'claim'].includes(item.type) && html`<${ResearchField} label="结构化内容（JSON）" name="payload" value=${JSON.stringify(item.payload ?? {}, null, 2)} textarea />`}
    <${ResearchSelect}
      label="可见性"
      name="visibility"
      value=${item.visibility}
      options=${[
        ['shared', t('共享')],
        ['private', t('仅自己')],
      ]}
    />
    <p role="alert">${error}</p>
    <button class="btn primary" type="submit" disabled=${pending}>
      ${replace ? t('保存新版本') : t('保存')}
    </button>
  </form>`;
}
/** @param {{source:any,onSaved:()=>void}} props */
export function ResearchSourceForm({ source, onSaved }) {
  const actions = useActions();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const metadata = source.metadata ?? {};
  async function save(event) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const formData = new FormData(event.currentTarget);
      const values = Object.fromEntries(formData);
      await actions.updateResearchSource(source.id, {
        title: values.title,
        kind: values.kind,
        metadata: {
          authors: String(values.authors)
            .split(';')
            .map((literal) => literal.trim())
            .filter(Boolean)
            .map((literal) => ({ literal })),
          year: values.year ? Number(values.year) : null,
          venue: values.venue || null,
          tags: String(values.tags)
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
          readStatus: values.readStatus,
        },
      });
      actions.closeModal();
      onSaved();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setPending(false);
    }
  }
  return html`<form class="rb-dialog" id="rb-source-form" onSubmit=${save}>
    <${ResearchField} label="标题" name="title" value=${source.title} required />
    <${ResearchSelect} label="类型" name="kind" value=${source.kind} options=${sourceKinds} />
    <${ResearchField} label="作者" name="authors" value=${authorText(metadata.authors)} />
    <${ResearchField} label="年份" name="year" value=${metadata.year} />
    <${ResearchField} label="期刊或来源" name="venue" value=${metadata.venue} />
    <${ResearchField} label="标签" name="tags" value=${(metadata.tags ?? []).join(', ')} />
    <${ResearchSelect}
      label="阅读状态"
      name="readStatus"
      value=${metadata.readStatus ?? 'unread'}
      options=${['unread', 'reading', 'read']}
    />
    <p role="alert">${error}</p>
    <button class="btn primary" type="submit" disabled=${pending}>${t('保存')}</button>
  </form>`;
}
/**
 * New or edited knowledge entity. A new entity in a project also joins that
 * project, in one history version.
 * @param {{entity?:any,projectId:string|null,onSaved:(entity:any)=>void}} props
 */
export function KnowledgeEntityForm({ entity = null, projectId, onSaved }) {
  const actions = useActions();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function save(event) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const fields = {
        name: String(values.name).trim(),
        kind: values.kind,
        nameEn: String(values.nameEn).trim() || null,
        aliases: String(values.aliases)
          .split(/[,，、;；]/u)
          .map((alias) => alias.trim())
          .filter(Boolean),
        description: String(values.description).trim(),
      };
      let saved;
      if (entity) saved = await actions.updateKnowledgeEntity(entity.id, fields);
      else
        ({ result: saved } = await actions.knowledgeSession(projectId, async (sessionId) => {
          const created = await actions.createKnowledgeEntity({ ...fields, sessionId });
          if (projectId)
            await actions.knowledgeMembership({
              projectId,
              ref: 'entity:' + created.id,
              sessionId,
            });
          return created;
        }));
      actions.closeModal();
      onSaved(saved);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setPending(false);
    }
  }
  const kinds =
    entity && !entityKinds.includes(entity.kind) ? [...entityKinds, entity.kind] : entityKinds;
  return html`<form class="rb-dialog" id="kb-entity-form" onSubmit=${save}>
    <${ResearchField} label="名称" name="name" value=${entity?.name ?? ''} required />
    <${ResearchSelect}
      label="种类"
      name="kind"
      value=${entity?.kind ?? 'concept'}
      options=${kinds.map((kind) => [kind, kindLabel(kind)])}
    />
    <${ResearchField} label="英文名" name="nameEn" value=${entity?.nameEn ?? ''} />
    <${ResearchField}
      label="别名（用逗号分隔）"
      name="aliases"
      value=${(entity?.aliases ?? []).join(', ')}
    />
    <${ResearchField} label="说明" name="description" value=${entity?.description ?? ''} textarea />
    <p role="alert">${error}</p>
    <button class="btn primary" type="submit" disabled=${pending}>${t('保存')}</button>
  </form>`;
}
