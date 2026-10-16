// Execution mode in the composer bar (design system ModeMenu). 「请求批准」
// waits for task P1b behind FEATURES.approval.
import { FEATURES } from '../features.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { ChoiceMenu } from './popover.js';

const MODES = {
  approval: { text: '请求批准', icon: 'shield-check' },
  direct: { text: '常规', icon: 'play' },
  autonomous: { text: '自动化', icon: 'zap' },
};

/**
 * @param {{mode:string,onChange:(mode:string)=>void,ordered:boolean,locked:boolean}} props
 */
export function ExecutionMode({ mode, onChange, ordered, locked }) {
  const current = mode === 'autonomous' && ordered ? 'direct' : mode;
  const shown = MODES[current] ?? MODES.direct;
  const auto = current === 'autonomous';
  return html`<${ChoiceMenu}
    label=${t('执行方式')}
    triggerClass=${`ss-btn ss-btn--sm ${auto ? 'ss-btn--auto' : 'ss-btn--ghost'}`}
    disabled=${locked}
    items=${[
      ...(FEATURES.approval
        ? [
            {
              text: t('请求批准'),
              icon: 'shield-check',
              selected: current === 'approval',
              description: t('运行命令、写项目文件夹和安装包之前先问你。'),
              run: () => onChange('approval'),
            },
          ]
        : []),
      {
        text: t('常规'),
        icon: 'play',
        selected: current === 'direct',
        description: t('直接执行，不逐条询问，随时可以停止。'),
        run: () => onChange('direct'),
      },
      {
        text: t('自动化'),
        icon: 'zap',
        auto: true,
        selected: auto,
        disabled: ordered,
        description: t(
          ordered
            ? '有序讨论时不能使用自动化，请先切换到工作模式。'
            : '围绕目标连续工作，直到完成或你停止；关闭程序后不会继续执行。',
        ),
        run: () => onChange('autonomous'),
      },
    ]}
  >
    <${Lucide} name=${shown.icon} /><span>${t(shown.text)}</span>
  <//>`;
}
