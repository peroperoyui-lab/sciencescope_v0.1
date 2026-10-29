// 版本比较 outside the desk (the workbench's version tree): the desk's
// side-by-side pages in a large dialog, with the originals and 另存为新版本.
import { useState } from 'preact/hooks';
import { useActions } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { VersionCompare } from './version-compare.js';

/** @param {{ versions: any[], left: string, right: string }} props */
function CompareBody({ versions, left: firstLeft, right: firstRight }) {
  const actions = useActions();
  const [left, setLeft] = useState(/** @type {string | null} */ (firstLeft));
  const [right, setRight] = useState(/** @type {string | null} */ (firstRight));
  const button = (icon, text, run, disabled = false) =>
    html`<button
      type="button"
      class="ss-btn ss-btn--ghost ss-btn--sm"
      disabled=${disabled}
      onClick=${run}
    >
      <${Lucide} name=${icon} />${text}
    </button>`;
  return html`<div class="ss-version-cmp" data-version-diff>
    <${VersionCompare}
      versions=${versions}
      left=${left}
      right=${right}
      onPick=${(nextLeft, nextRight) => {
        setLeft(nextLeft);
        setRight(nextRight);
      }}
      onExit=${actions.closeModal}
    >
      ${button(
        'external-link',
        t('打开旧原件'),
        () => actions.attempt(() => actions.openVersion(left)),
        !left,
      )}
      ${button(
        'external-link',
        t('打开新原件'),
        () => actions.attempt(() => actions.openVersion(right)),
        !right,
      )}
      ${button(
        'copy',
        t('另存为新版本'),
        () =>
          actions.attempt(async () => {
            await actions.saveVersionAsNew(left);
            actions.toast(t('已把旧版另存为新版本。'));
          }),
        !left,
      )}
    <//>
  </div>`;
}

/**
 * @param {import('../actions.js').Actions} actions
 * @param {{ versions: any[], left: string, right: string }} input
 */
export function openVersionCompare(actions, input) {
  actions.openModal(t('版本比较'), html`<${CompareBody} ...${input} />`, 'settings');
}
