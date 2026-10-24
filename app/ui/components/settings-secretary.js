// Settings → 任务秘书 (design system PageSettingsSecretary): the role, when
// minutes are written, what else is updated with them, memory consolidation
// and the manuscript version note template. Every change applies at once.
import { useEffect } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { RoleRow } from './settings-roles.js';
import {
  AutoText,
  ModelSelect,
  Row,
  Section,
  Seg,
  Select,
  Switch,
  Head,
  numberOptions,
  useSetting,
} from './settings-kit.js';

const TARGETS = [
  ['map', '研究导图'],
  ['plans', '计划'],
  ['log', '日志'],
  ['versions', '稿件版本说明'],
];
// The same default as the settings file; a template literal because it is data, not interface text.
const DEFAULT_TEMPLATE = `# 版本说明
## 比较对象
## 实际文件变化
## 秘书的解释：与当前研究的关系
## 待用户决定的建议
## 相关导图节点与文件`;

/** "约 3 万字" for 30000 tokens (a Chinese character is about one token). @param {number} n */
const wordsOf = (n) =>
  n >= 10000
    ? t('约 {n} 万字', { n: +(n / 10000).toFixed(1), k: Math.round(n / 1000) })
    : t('约 {n} 字', { n });
/** "10 万 token". @param {number} n */
const tokensOf = (n) =>
  n >= 10000
    ? t('{n} 万 token', { n: +(n / 10000).toFixed(1), k: Math.round(n / 1000) })
    : `${n} token`;

/** The built-in role's row, opening its detail page. @param {{ id: string }} props */
export function BuiltInRole({ id }) {
  const actions = useActions();
  const participant = useAppState((state) => state.participantDefinitions?.[id]);
  useEffect(() => {
    if (!participant) void actions.attempt(() => actions.loadParticipantDefinitions());
  }, []);
  return html`<${Section} title=${t('角色')}>
    ${participant?.definition && html`<div class="ss-list"><${RoleRow} participant=${participant} /></div>`}
  <//>`;
}

export function SecretaryPage() {
  const [summary, writeSummary] = useSetting((settings) => settings.summary);
  const [memory, writeMemory] = useSetting((settings) => settings.memory);
  const [template, writeTemplate] = useSetting((settings) => settings.versionNotes?.template);
  if (!summary || !memory) return null;
  /** @param {Record<string, any>} changes */
  const set = (changes) => writeSummary({ summary: changes });
  const setMemory = (changes) => writeMemory({ memory: changes });
  return html`<div class="ss-settings__inner" data-settings="secretary">
    <${Head}
      title=${t('任务秘书')}
      desc=${t('每个对话一位任务秘书，整理纪要、跟进进度、起草下一步。')}
    />
    <${BuiltInRole} id="agent_secretary" />
    <${Section}
      title=${t('什么时候整理纪要')}
      tip=${t('整理得越少，纪要后面接着的原文就越长；什么都不会被截掉。')}
      attrs=${{ 'data-summary-settings': '' }}
    >
      <${Row} label=${t('有序讨论结束后')}>
        <${Switch}
          label=${t('有序讨论结束后')}
          checked=${summary.afterDiscussion}
          onChange=${(afterDiscussion) => set({ afterDiscussion })}
        />
      <//>
      <${Row} label=${t('对话每多')}>
        <${Switch}
          label=${t('按消息数整理')}
          checked=${summary.everyMessages.enabled}
          onChange=${(enabled) => set({ everyMessages: { enabled } })}
        />
        <${Select}
          label=${t('消息间隔')}
          small
          width=${120}
          disabled=${!summary.everyMessages.enabled}
          value=${summary.everyMessages.n}
          options=${numberOptions([10, 20, 30, 50], (n) => t('{n} 条消息', { n }), summary.everyMessages.n)}
          onChange=${(n) => set({ everyMessages: { n } })}
        />
      <//>
      <${Row} label=${t('内容每多')} desc=${t('中文大约一个字算一个 token')}>
        <${Switch}
          label=${t('按长度整理')}
          checked=${summary.everyTokens.enabled}
          onChange=${(enabled) => set({ everyTokens: { enabled } })}
        />
        <${Select}
          label=${t('长度间隔')}
          small
          width=${120}
          disabled=${!summary.everyTokens.enabled}
          value=${summary.everyTokens.n}
          options=${numberOptions([10000, 20000, 30000, 50000, 80000], wordsOf, summary.everyTokens.n)}
          onChange=${(n) => set({ everyTokens: { n } })}
        />
      <//>
      <${Row} label=${t('进入项目时')}>
        <${Switch}
          label=${t('进入项目时')}
          checked=${summary.onEnterProject}
          onChange=${(onEnterProject) => set({ onEnterProject })}
        />
      <//>
      <${Row} label=${t('离开项目时')}>
        <${Switch}
          label=${t('离开项目时')}
          checked=${summary.onLeaveProject}
          onChange=${(onLeaveProject) => set({ onLeaveProject })}
        />
      <//>
    <//>
    <${Section}
      title=${t('整理纪要时顺便更新')}
      tip=${t('直接更新只追加或标记，不改写你写的内容，每次都能撤销。导图、计划和日志里你写得多，没必要就别开。')}
    >
      ${TARGETS.map(
        ([key, label]) =>
          html`<${Row} key=${key} label=${t(label)}>
            <${Seg}
              label=${t('{name}自动更新', { name: t(label) })}
              value=${summary.workbench?.[key] ?? 'off'}
              options=${[
                ['off', t('不更新')],
                ['apply', t('直接更新')],
              ]}
              onChange=${(value) => set({ workbench: { [key]: value } })}
            />
          <//>`,
      )}
    <//>
    <${Section}
      title=${t('记忆整理')}
      tip=${t('空闲时只看纪要的变化和对应原文，整理出候选记忆。网页和文献里的内容标为外部来源。')}
      attrs=${{ 'data-memory-consolidation-settings': '' }}
    >
      <${Row} label=${t('空闲时整理候选记忆')} desc=${t('整理出的记忆先进收件箱，你确认后才生效')}>
        <${Switch}
          label=${t('空闲时整理候选记忆')}
          checked=${memory.enabled}
          onChange=${(enabled) => setMemory({ enabled })}
        />
      <//>
      <${Row} label=${t('空闲多久后')}>
        <${Select}
          label=${t('空闲多久后')}
          small
          width=${120}
          disabled=${!memory.enabled}
          value=${memory.idleMinutes}
          options=${numberOptions([5, 10, 20, 30, 60], (n) => t('{n} 分钟', { n }), memory.idleMinutes)}
          onChange=${(idleMinutes) => setMemory({ idleMinutes })}
        />
      <//>
      <${Row}
        label=${t('整理用的模型')}
        desc=${t('会产生用量。选定的模型用不了时会报错，不会自己换模型')}
      >
        <${ModelSelect}
          label=${t('整理用的模型')}
          width=${200}
          value=${memory.model}
          emptyText=${t('跟随任务秘书')}
          onChange=${(model) => setMemory({ model })}
        />
      <//>
      <${Row} label=${t('每次最多用')} desc=${t('输入和输出合计，用完就停，下次接着整理')}>
        <${Select}
          label=${t('每次最多用')}
          small
          width=${120}
          value=${memory.tokenLimit ?? 0}
          options=${[
            ...numberOptions([50000, 100000, 200000, 500000], tokensOf, memory.tokenLimit),
            { value: 0, text: t('不限制') },
          ]}
          onChange=${(limit) => setMemory({ tokenLimit: limit || null })}
        />
      <//>
    <//>
    <${Section}
      title=${t('稿件版本说明模板')}
      tip=${t('任务秘书写稿件版本说明时，按这几个标题分段。')}
      extra=${html`<button
        type="button"
        class="ss-linkbtn"
        onClick=${() => writeTemplate({ versionNotes: { template: DEFAULT_TEMPLATE } })}
      >
        ${t('恢复默认')}
      </button>`}
    >
      <${AutoText}
        multiline
        label=${t('稿件版本说明模板')}
        value=${template ?? ''}
        attrs=${{ style: 'min-height:120px' }}
        onSave=${(text) => writeTemplate({ versionNotes: { template: text } })}
      />
    <//>
  </div>`;
}
