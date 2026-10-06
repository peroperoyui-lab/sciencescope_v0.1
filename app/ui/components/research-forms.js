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
        await actions.updateResearchItem(item.id, { ...patch, expectedRevision: item.revision });
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
