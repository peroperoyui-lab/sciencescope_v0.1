import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { DiscussionMenu } from './discussion-menu.js';

/**
 * @param {{mode:string,onChange:(mode:string)=>void,ordered:boolean,locked:boolean}} props
 */
export function ExecutionMode({ mode, onChange, ordered, locked }) {
  return html`<${DiscussionMenu}
    label=${t('执行方式')}
    className="execution-mode"
    disabled=${locked}
    items=${[
      {
        text: t('常规'),
        selected: mode === 'direct',
        description: t('每条消息回答一次。'),
        run: () => onChange('direct'),
      },
      {
        text: t('自动化'),
        selected: mode === 'autonomous' && !ordered,
        disabled: ordered,
        description: t(
          ordered
            ? '有序讨论时不能使用自动化，请先切换到工作模式。'
            : '围绕目标连续工作，可暂停、继续或结束；关闭程序后不会继续执行。',
        ),
        run: () => onChange('autonomous'),
      },
    ]}
    >${mode === 'autonomous' && !ordered ? t('自动化') : t('常规')}<//
  >`;
}
