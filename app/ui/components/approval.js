// The approval card (design system ApprovalCard): in 「请求批准」 mode a shell
// command, a file write outside the data folder or a package install waits
// here for 允许 or 拒绝. 总是允许 picks a scope the server offered (this
// command, commands starting with python, this folder…) and saves it as a rule
// for the project. Once decided it folds into one timeline row.
import { useState } from 'preact/hooks';
import { useActions } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';

const ACTIONS = {
  shell: '运行命令',
  write_file: '写入文件',
  edit_file: '修改文件',
  python_env_install: '安装包',
};

const pad = (n) => String(n).padStart(2, '0');

/** What the action is, and the details under it. @param {any} args */
function described(args) {
  const summary = String(args?.summary ?? '');
  if (args?.tool === 'python_env_install') {
    try {
      return { target: JSON.parse(summary).join(' '), meta: '' };
    } catch {
      return { target: summary, meta: '' };
    }
  }
  const [target, ...rest] = summary.split('\n');
  const lines = /^-(\d+) \/ \+(\d+) lines$/.exec(rest.join(' '));
  return {
    target,
    meta: lines ? t('替换 {old} 行为 {new} 行', { old: lines[1], new: lines[2] }) : rest.join(' '),
  };
}

/** @param {{ call: any }} props */
export function ApprovalCard({ call }) {
  const actions = useActions();
  const [busy, setBusy] = useState(false);
  const { target, meta } = described(call.args);
  const scopes = call.args?.scopes ?? [];
  const decide = async (decision, scope = undefined) => {
    setBusy(true);
    await actions.attempt(() => actions.decideApproval(call, decision, scope));
    setBusy(false);
  };
  const always = (event) =>
    actions.openMenu(
      event,
      scopes.map((scope) => ({
        text: t(scope.label, scope.values),
        run: () => decide('always', { kind: scope.kind, value: scope.value }),
      })),
      t('总是允许'),
    );
  return html`<div
    class="ss-approve"
    role="group"
    aria-label=${t('需要你的批准')}
    data-approval=${call.id}
  >
    <div class="ss-approve__head">
      <${Lucide} name="shield-question-mark" /><span class="ss-approve__title"
        >${t('需要你的批准')}</span
      ><span class="ss-approve__tool">${t(ACTIONS[call.args?.tool] ?? '使用工具')}</span>
    </div>
    <div class="ss-approve__body">
      <pre class="ss-approve__cmd">${target}</pre>
      ${meta && html`<div class="ss-approve__meta">${meta}</div>`}
    </div>
    <div class="ss-approve__foot">
      <button type="button" class="ss-btn" disabled=${busy} onClick=${() => decide('reject')}>
        ${t('拒绝')}
      </button>
      ${
        scopes.length > 0 &&
        html`<button
          type="button"
          class="ss-btn"
          aria-haspopup="menu"
          disabled=${busy}
          onClick=${always}
        >
          ${t('总是允许')}<${Lucide} name="chevron-down" />
        </button>`
      }
      <button
        type="button"
        class="ss-btn ss-btn--primary"
        disabled=${busy}
        onClick=${() => decide('approve')}
      >
        ${t('允许')}
      </button>
    </div>
  </div>`;
}

/** A decided approval as one timeline row. @param {{ call: any }} props */
export function ApprovalRow({ call }) {
  if (call.status === 'pending') return html`<${ApprovalCard} call=${call} />`;
  const { target } = described(call.args);
  const ended = call.endedAt ? new Date(call.endedAt) : null;
  const time = ended ? `${pad(ended.getHours())}:${pad(ended.getMinutes())}` : '';
  const shown =
    call.status === 'approved'
      ? { icon: 'circle-check', verb: '已允许', tone: 'ss-act__row--ok' }
      : call.status === 'rejected'
        ? { icon: 'circle-x', verb: '已拒绝', tone: '' }
        : { icon: 'circle-stop', verb: '已取消', tone: 'ss-act__row--muted' };
  return html`<div
    class=${`ss-act__row ${shown.tone}`}
    data-activity="approval"
    data-status=${call.status}
  >
    <${Lucide} name=${shown.icon} /><span class="ss-act__verb">${t(shown.verb)}</span>
    <span class="ss-act__target">${target}</span>
    ${call.status !== 'cancelled' && time && html`<span class="ss-act__end">${t('你 · {time}', { time })}</span>`}
  </div>`;
}
