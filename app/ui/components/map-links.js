// The old node-link dialog: choose two endpoints, optionally draw an arrow,
// and remove a link through the same map editing session.
import { useState } from 'preact/hooks';
import { useActions } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';

/** @param {{map:any,selected?:string,edit:(op:string,args:any)=>Promise<any>}} props */
export function MapLinks({ map, selected, edit }) {
  const actions = useActions();
  const [from, setFrom] = useState(selected ?? map.nodes[0]?.id ?? '');
  const [to, setTo] = useState(map.nodes.find((node) => node.id !== from)?.id ?? '');
  const [directed, setDirected] = useState(true);
  const [busy, setBusy] = useState(false);
  const label = (id) => map.nodes.find((node) => node.id === id)?.text ?? '';
  async function change(op, args) {
    setBusy(true);
    const result = await edit(op, args);
    setBusy(false);
    if (result) actions.closeModal();
  }
  return html`<form
    onSubmit=${(event) => {
      event.preventDefault();
      change('addEdge', { edge: { from, to, directed } });
    }}
  >
    <div class="field">
      <label class="label" for="map-link-from">${t('起点')}</label
      ><select
        id="map-link-from"
        value=${from}
        onChange=${(event) => setFrom(event.currentTarget.value)}
      >
        ${map.nodes.map((node) => html`<option value=${node.id}>${node.text}</option>`)}
      </select>
    </div>
    <div class="field">
      <label class="label" for="map-link-to">${t('终点')}</label
      ><select id="map-link-to" value=${to} onChange=${(event) => setTo(event.currentTarget.value)}>
        ${map.nodes.map((node) => html`<option value=${node.id}>${node.text}</option>`)}
      </select>
    </div>
    <label class="checkrow"
      ><input
        type="checkbox"
        checked=${directed}
        onChange=${(event) => setDirected(event.currentTarget.checked)}
      />${t('有向连线')}</label
    >
    <div class="saverow">
      <button type="submit" class="btn primary" disabled=${busy || !from || !to || from === to}>
        ${t('添加连线')}
      </button>
    </div>
    <div class="divider"></div>
    ${(map.edges ?? []).map((edge) => html`<div class="listrow" key=${edge.id}><span class="grow">${label(edge.from)} ${edge.directed ? '→' : '—'} ${label(edge.to)}</span><button type="button" class="btn tiny" disabled=${busy} onClick=${() => change('removeEdge', { id: edge.id })}>${t('移除')}</button></div>`)}
  </form>`;
}
