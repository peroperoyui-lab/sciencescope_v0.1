// 导入文稿版本: files from outside become versions of a manuscript, in the
// order listed. Opened from the workbench's version tree.
import { useState } from 'preact/hooks';
import { useActions } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { Info } from './info-tip.js';
import { ModalForm } from './overlays.js';
import { Select } from './settings-kit.js';

/** @param {{ projectId: string, groups: any[], files: File[], groupId?: string | null }} props */
function ImportForm({ projectId, groups, files: initialFiles, groupId: initialGroup }) {
  const actions = useActions();
  const [files, setFiles] = useState(initialFiles);
  const [groupId, setGroupId] = useState(initialGroup ?? '');
  const [name, setName] = useState(initialFiles[0]?.name.replace(/\.[^.]+$/, '') ?? '');
  const [saving, setSaving] = useState(false);
  /** @param {number} index @param {number} direction */
  function move(index, direction) {
    const ordered = [...files];
    [ordered[index], ordered[index + direction]] = [ordered[index + direction], ordered[index]];
    setFiles(ordered);
  }
  async function submit() {
    setSaving(true);
    try {
      await actions.importVersions(projectId, files, groupId || undefined, name.trim());
      actions.closeModal();
      actions.toast(t('已导入 {n} 个版本。', { n: files.length }));
    } catch (error) {
      actions.toast(error.message);
    } finally {
      setSaving(false);
    }
  }
  const label = (group) => group.sourcePath ?? group.name;
  return html`<${ModalForm}
    onSubmit=${submit}
    submitText=${saving ? t('正在保存…') : t('导入')}
    disabled=${saving || (!groupId && !name.trim())}
  >
    <div class="ss-field">
      <span class="ss-field__label">${t('放进哪份文稿')}</span>
      <${Select}
        label=${t('版本组')}
        width="100%"
        value=${groupId}
        options=${[
          { value: '', text: t('新建一份文稿') },
          ...groups.map((group) => ({ value: group.id, text: label(group) })),
        ]}
        onChange=${setGroupId}
      />
    </div>
    ${
      !groupId &&
      html`<label class="ss-field">
        <span class="ss-field__label">${t('文稿名称')}</span>
        <span class="ss-input"
          ><input
            aria-label=${t('版本组名称')}
            value=${name}
            onInput=${(event) => setName(event.currentTarget.value)}
        /></span>
      </label>`
    }
    <div class="ss-field">
      <span class="ss-field__label"
        >${t('导入顺序')}<${Info} text=${t('按列表顺序编号；同一组的后续文件接着上一版本编号。')}
      /></span>
      <div class="ss-list ss-version-import__files">
        ${files.map(
          (file, index) =>
            html`<div class="ss-list-row" key=${file.name + index}>
              <${Lucide} name="file-text" class="ss-list-row__icon" />
              <span class="ss-list-row__main"
                ><span class="ss-list-row__title">${file.name}</span></span
              >
              <span class="ss-list-row__actions">
                <button
                  type="button"
                  class="ss-icon-btn ss-icon-btn--sm"
                  aria-label=${t('上移 {name}', { name: file.name })}
                  data-tip=${t('上移')}
                  disabled=${saving || index === 0}
                  onClick=${() => move(index, -1)}
                >
                  <${Lucide} name="chevron-up" />
                </button>
                <button
                  type="button"
                  class="ss-icon-btn ss-icon-btn--sm"
                  aria-label=${t('下移 {name}', { name: file.name })}
                  data-tip=${t('下移')}
                  disabled=${saving || index === files.length - 1}
                  onClick=${() => move(index, 1)}
                >
                  <${Lucide} name="chevron-down" />
                </button>
              </span>
            </div>`,
        )}
      </div>
    </div>
  <//>`;
}

/**
 * @param {import('../actions.js').Actions} actions
 * @param {{ projectId: string, groups: any[], files: File[], groupId?: string | null }} input
 */
export function openVersionImport(actions, input) {
  if (!input.files.length) return;
  actions.openModal(t('导入文稿版本'), html`<${ImportForm} ...${input} />`);
}
