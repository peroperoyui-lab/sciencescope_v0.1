// Execution mode in the composer bar (design system ModeMenu): 「请求批准」
// (approval ask) or 常规 (approval auto).
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { ChoiceMenu } from './popover.js';

const MODES = {
  approval: { text: '请求批准', icon: 'shield-check' },
  direct: { text: '常规', icon: 'play' },
};

/**
 * @param {{mode:'approval' | 'direct',onChange:(mode:'approval' | 'direct')=>void,locked:boolean}} props
 */
export function ExecutionMode({ mode, onChange, locked }) {
  const shown = MODES[mode] ?? MODES.direct;
  return html`<${ChoiceMenu}
    label=${t('执行方式')}
    triggerClass="ss-btn ss-btn--sm ss-btn--ghost"
    disabled=${locked}
    items=${[
      {
        text: t('请求批准'),
        icon: 'shield-check',
        selected: mode === 'approval',
        description: t('运行命令、写项目文件夹和安装包之前先问你。'),
        run: () => onChange('approval'),
      },
      {
        text: t('常规'),
        icon: 'play',
        selected: mode === 'direct',
        description: t('直接执行，不逐条询问，随时可以停止。'),
        run: () => onChange('direct'),
      },
    ]}
  >
    <${Lucide} name=${shown.icon} /><span>${t(shown.text)}</span>
  <//>`;
}
