// The version comparison page: the same side-by-side pages as the editing
// desk (version-compare.js); restoring copies the old original into a new
// numbered version.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { navigate } from '../route.js';
import { MainHead } from './mainhead.js';
import { VersionCompare } from './version-compare.js';

/**
 * @param {{projectId:string,id:string}} props
 */
export function VersionDiff({ projectId, id }) {
  const actions = useActions();
  const project = useAppState((state) => state.projects.find((entry) => entry.id === projectId));
  const changed = useAppState((state) => state.versionsVersion);
  const [versions, setVersions] = useState([]);
  const [current, setCurrent] = useState(id);
  const [baseline, setBaseline] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    actions
      .versionGroups(projectId)
      .then((groups) => {
        if (!active) return;
        const group = groups.find((entry) => entry.versions.some((version) => version.id === id));
        setVersions(group?.versions ?? []);
        if (!loaded) {
          const version = group?.versions.find((entry) => entry.id === id);
          setBaseline(version?.baselineId ?? version?.parentId ?? null);
          setLoaded(true);
        }
      })
      .catch((error) => actions.toast(error.message));
    return () => {
      active = false;
    };
  }, [projectId, id, changed]);
  function restore() {
    actions.openModal(
      t('另存为新版本'),
      html`<div>
        <p>${t('复制旧版原件成为新的版本；已有版本和说明保持可查看。')}</p>
        <div class="row">
          <button class="btn" onClick=${actions.closeModal}>${t('取消')}</button
          ><button
            class="btn primary"
            disabled=${busy}
            onClick=${async () => {
              setBusy(true);
              await actions.attempt(async () => {
                const saved = await actions.saveVersionAsNew(baseline);
                actions.closeModal();
                navigate({ view: 'version-diff', id: `${projectId}/${saved.versions[0].id}` });
              });
              setBusy(false);
            }}
          >
            ${t('确认另存')}
          </button>
        </div>
      </div>`,
    );
  }
  const button = (icon, text, run, disabled = false) =>
    html`<button
      type="button"
      class="ss-btn ss-btn--ghost ss-btn--sm"
      disabled=${disabled}
      onClick=${run}
    >
      <${Lucide} name=${icon} />${text}
    </button>`;
  return html`<main class="main" data-version-diff>
    <${MainHead} crumb=${project?.name ?? ''} title=${t('版本比较')}>
      ${button('external-link', t('打开旧原件'), () => actions.attempt(() => actions.openVersion(baseline)), !baseline)}
      ${button('external-link', t('打开新原件'), () => actions.attempt(() => actions.openVersion(current)))}
      ${button('copy', t('另存为新版本'), restore, !baseline)}
      ${button('file-text', t('版本说明'), () => navigate({ view: 'version-notes', id: `${projectId}/${current}` }))}
    <//>
    ${
      loaded &&
      html`<${VersionCompare}
        versions=${versions}
        left=${baseline}
        right=${current}
        onPick=${(left, right) => {
          setBaseline(left);
          setCurrent(right);
        }}
      />`
    }
  </main>`;
}
