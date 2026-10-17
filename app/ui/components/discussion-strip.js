import { useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { InfoTip } from './info-tip.js';
import { DiscussionMenu } from './discussion-menu.js';
import { ChoiceMenu } from './popover.js';
import { useDiscussion } from './discussion-state.js';
import { isToolCall } from './timeline.js';

/** @param {{meetingId:string,running:boolean}} props */
export function DiscussionStrip({ meetingId, running }) {
  const { experts, reviewers, policy, save, inOrder } = useDiscussion(meetingId);
  const turns = useAppState((state) =>
    Object.values(state.running).filter(
      (turn) =>
        turn.meetingId === meetingId &&
        state.messages[meetingId]?.some((message) => message.turnId === turn.id),
    ),
  );
  const calls = useAppState((state) => state.toolCalls);
  const messages = useAppState((state) => state.messages[meetingId] ?? []);
  const reviewer = reviewers.find((expert) => expert.id === policy.reviewer);
  const stateOf = (id) => {
    const turn = turns.find((entry) => entry.participantId === id);
    if (!turn) return null;
    return calls[turn.id]?.some((call) => call.status === 'running' && isToolCall(call))
      ? 'tool'
      : messages.find((message) => message.turnId === turn.id)?.refs?.discussion?.phase ===
          'waiting'
        ? 'waiting'
        : 'running';
  };
  const items = [
    {
      text: t('不设审核'),
      selected: !policy.reviewer,
      description: t('专家各自作答后本轮结束。'),
      run: () => save({ reviewer: null }),
    },
    ...reviewers.flatMap((expert, index) => {
      const heading =
        expert.definition.panel === 'reviewer' &&
        (index === 0 || reviewers[index - 1].definition.panel !== 'reviewer');
      return [
        ...(heading ? [{ heading: true, text: t('独立审核') }] : []),
        {
          text: expert.name,
          selected: policy.reviewer === expert.id,
          description:
            expert.definition.panel === 'reviewer'
              ? t('只在讨论最后审核各专家的回答，不参与作答。')
              : t(
                  '其他专家全部完成后，核查各回复的事实、依据、方法和结论并总结；该专家本轮不单独作答。',
                ),
          run: () =>
            save({
              reviewer: expert.id,
              order: inOrder((policy.order ?? []).filter((id) => id !== expert.id)),
            }),
        },
      ];
    }),
  ];
  let order = 0;
  return html`<div class="panelhead discussion-strip" data-discussion-strip>
    <div class="row">
      <small
        >${t('发言顺序')}<${InfoTip}
          text=${t('所选专家读取同一份前文后并行独立作答，按顺序展示。审核结论须经采纳才进入后续上下文。')} /></small
      >${experts
        .filter((expert) => expert.id !== policy.reviewer)
        .map((expert) => {
          const selected = (policy.order ?? []).includes(expert.id);
          const state = stateOf(expert.id);
          return html`<button
            type="button"
            class="panel-chip"
            data-panel-toggle=${expert.id}
            aria-pressed=${selected}
            disabled=${running}
            title=${expert.definition.role ?? expert.name}
            onClick=${() => save({ order: inOrder(selected ? (policy.order ?? []).filter((id) => id !== expert.id) : [...(policy.order ?? []), expert.id]) })}
          >
            <b>${selected ? ++order : '–'}</b
            ><span>${expert.name}</span
            >${state && html`<i data-state=${state} aria-label=${t({ running: '作答中', tool: '使用工具', waiting: '等待中' }[state])}></i>`}
          </button>`;
        })}${!experts.length && html`<small>${t('名册为空')}</small>`}<span class="spacer"></span
      ><${DiscussionMenu}
        label=${t('审核专家')}
        className="panel-chip reviewer-chip"
        disabled=${running}
        items=${items}
        ><span>${t('审核：')}</span><span>${reviewer?.name ?? t('无')}</span><//
      >
    </div>
  </div>`;
}

/** @param {{meetingId?:string,running:boolean}} props */
export function DiscussionMode({ meetingId, running }) {
  const { experts, policy, ordered, save } = useDiscussion(meetingId);
  const goalActive = useAppState((state) =>
    ['running', 'paused', 'blocked'].includes(state.goals[meetingId]?.status),
  );
  if (!meetingId) return null;
  const items = [
    {
      text: t('工作'),
      selected: !ordered,
      description: t('主专家持续处理当前任务；输入 @专家名 可邀请专家回答。'),
      run: () => save({ mode: 'direct' }),
    },
    {
      text: t('有序讨论'),
      selected: ordered,
      description: t('所选专家读取同一份前文后并行独立作答，按顺序展示；可设审核专家在最后核查。'),
      run: () =>
        save({
          mode: 'round',
          order: (policy.order ?? experts.map((expert) => expert.id)).filter(
            (id) => id !== policy.reviewer,
          ),
          reviewer: policy.reviewer ?? null,
        }),
    },
  ];
  return html`<${ChoiceMenu}
    label=${t('工作方式')}
    items=${items}
    disabled=${running || goalActive}
    attrs=${{ 'data-v': 'mode-menu' }}
  >
    <span>${ordered ? t('有序讨论') : t('工作')}</span>
  <//>`;
}
