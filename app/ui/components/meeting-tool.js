// Tool activity is shared by Main and the secretary's separate transcript.
import { html } from '../html.js';
import { Icon } from '../icons.js';

/** @param {any} value */
function pretty(value) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/** One tool call as an activity card (`details.tool`). @param {{ call: any }} props */
export function ToolCard({ call }) {
  return html`<details class=${`tool ${call.status}`}>
    <summary>
      ${
        call.status === 'running'
          ? html`<span class="ss-thinking"><i></i></span>`
          : html`<${Icon} name=${call.status === 'failed' ? 'close' : 'check'} />`
      }
      <span class="grow">${call.preamble || call.name}</span>
      <small>${call.name}</small>
      <${Icon} name="down" />
    </summary>
    <pre>${pretty(call.args)}</pre>
    ${call.result != null && html`<pre>${pretty(call.result)}</pre>`}
  </details>`;
}
