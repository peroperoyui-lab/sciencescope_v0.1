// The legacy secretary preferences form. Changes are queued in order so rapid
// edits keep the latest rules, while a status message exposes persistence errors.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { InfoTip } from './info-tip.js';

const SUMMARY_HELP =
  '任务秘书在下列时机更新对话纪要。总结越少，专家和秘书收到的纪要之后原文越长；每 n 个新 token 用于触发总结，不会静默截断原文。';
const WORKBENCH_HELP =
  '导图、计划、日志有大量你的参与，非必要不开启。直接更新只追加或标记，不改写你的内容，可撤销。';
const DEFAULT_SUMMARY = {
  afterDiscussion: true,
  everyMessages: { enabled: true, n: 20 },
  everyTokens: { enabled: true, n: 30000 },
  onEnterProject: true,
  onLeaveProject: true,
  saveMarkdown: true,
  workbench: { map: 'off', plans: 'off', log: 'off' },
};
const TARGETS = [
  ['map', '导图'],
  ['plans', '计划'],
  ['log', '日志'],
];

/**
 * @returns {import('preact').VNode}
 */
export function SecretarySettings() {
  const actions = useActions();
  const settings = useAppState((state) => state.settings);
  const [saved, setSaved] = useState(settings?.summary ?? DEFAULT_SUMMARY);
  const loaded = useRef(Boolean(settings));
  useEffect(() => {
    if (!settings || loaded.current) return;
    loaded.current = true;
    setSaved(settings.summary ?? DEFAULT_SUMMARY);
  }, [settings]);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const saves = useRef(Promise.resolve());
  const latest = useRef(0);

  function change(event) {
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const fields = form.elements;
    const summary = {
      afterDiscussion: fields.afterDiscussion.checked,
      everyMessages: { enabled: fields.messagesEnabled.checked, n: Number(fields.messagesN.value) },
      everyTokens: { enabled: fields.tokensEnabled.checked, n: Number(fields.tokensN.value) },
      onEnterProject: fields.onEnterProject.checked,
      onLeaveProject: fields.onLeaveProject.checked,
      saveMarkdown: fields.saveMarkdown.checked,
      workbench: Object.fromEntries(TARGETS.map(([key]) => [key, fields[key].value])),
    };
    setSaved(summary);
    const ticket = ++latest.current;
    setError('');
    setFeedback('正在保存自动总结设置…');
    saves.current = saves.current
      .catch(() => {})
      .then(async () => {
        try {
          await actions.updateSettings({ summary });
          if (ticket === latest.current) setFeedback('自动总结设置已保存。');
        } catch (failure) {
          if (ticket === latest.current) {
            setFeedback('');
            setError(failure.message);
          }
        }
      });
  }

  return html`<section data-secretary-preferences>
    <form data-summary-settings onSubmit=${(event) => event.preventDefault()} onChange=${change}>
      <h2>${t('自动总结')}<${InfoTip} text=${t(SUMMARY_HELP)} /></h2>
      <fieldset disabled=${!settings}>
        <label
          ><input type="checkbox" name="afterDiscussion" checked=${saved.afterDiscussion} />
          ${t('有序讨论结束后')}</label
        >
        <label
          ><input
            type="checkbox"
            name="messagesEnabled"
            checked=${saved.everyMessages.enabled}
            aria-label=${t('按消息数自动总结')}
          />
          ${t('每')}
          <input
            type="number"
            name="messagesN"
            min="1"
            step="1"
            required
            value=${saved.everyMessages.n}
            onInput=${(event) => setSaved({ ...saved, everyMessages: { ...saved.everyMessages, n: event.currentTarget.value } })}
            aria-label=${t('主对话消息间隔')}
          />
          ${t('条主对话消息')}</label
        >
        <label
          ><input
            type="checkbox"
            name="tokensEnabled"
            checked=${saved.everyTokens.enabled}
            aria-label=${t('按 token 数自动总结')}
          />
          ${t('每')}
          <input
            type="number"
            name="tokensN"
            min="1"
            step="1"
            required
            value=${saved.everyTokens.n}
            onInput=${(event) => setSaved({ ...saved, everyTokens: { ...saved.everyTokens, n: event.currentTarget.value } })}
            aria-label=${t('新 token 间隔')}
          />
          ${t('个新 token')}</label
        >
        <label
          ><input type="checkbox" name="onEnterProject" checked=${saved.onEnterProject} />
          ${t('进入项目时')}</label
        >
        <label
          ><input type="checkbox" name="onLeaveProject" checked=${saved.onLeaveProject} />
          ${t('离开项目时')}</label
        >
        <label
          ><input type="checkbox" name="saveMarkdown" checked=${saved.saveMarkdown} />
          ${t('同时保存为工作文件夹中的 Markdown 文件')}
          <${InfoTip}
            text=${t('保存在工作文件夹的 minutes/ 下；在文件里的修改不会读回，请在对话纪要窗口中编辑。')}
          />
        </label>
        <h3>${t('随总结更新工作站')}<${InfoTip} text=${t(WORKBENCH_HELP)} /></h3>
        ${TARGETS.map(
          ([key, label]) =>
            html`<label key=${key}
              >${t(label)}
              <select
                name=${key}
                value=${saved.workbench[key]}
                aria-label=${t('{name}自动更新', { name: t(label) })}
              >
                <option value="off">${t('关闭自动更新')}</option>
                <option value="apply">${t('直接更新')}</option>
              </select>
            </label>`,
        )}
      </fieldset>
      <p data-summary-feedback role="status">${error || t(feedback)}</p>
    </form>
  </section>`;
}
