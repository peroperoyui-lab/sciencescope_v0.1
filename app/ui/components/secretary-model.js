// The secretary's model is a meeting override, never a patch to the Main
// composer default. Inheritance remains visible and explicit.
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { DiscussionMenu } from './discussion-menu.js';

/**
 * @param {{ meeting: any, mainMeetingId: string, running: boolean }} props
 * @returns {import('preact').VNode}
 */
export function SecretaryModel({ meeting, mainMeetingId, running }) {
  const actions = useActions();
  const settings = useAppState((state) => state.settings);
  const definitions = useAppState((state) => state.participantDefinitions);
  const main = useAppState((state) => state.meetings.find((entry) => entry.id === mainMeetingId));
  const own = meeting.policy.model;
  const current =
    own ??
    definitions.agent_secretary?.definition.model ??
    main?.policy.model ??
    definitions.agent_main?.definition.model ??
    settings?.models?.default;
  const choices = (settings?.providers ?? []).flatMap((provider) =>
    provider.models.map((descriptor) => ({
      model: { provider: provider.id, model: descriptor.id },
      text: `${provider.name ?? provider.id} / ${descriptor.name ?? descriptor.id}`,
      efforts: descriptor.efforts ?? [],
    })),
  );
  const selected = choices.find(
    (choice) =>
      choice.model.provider === current?.provider && choice.model.model === current?.model,
  );
  const update = (model) =>
    actions.attempt(() =>
      actions.updateMeeting(meeting.id, { policy: { ...meeting.policy, model } }),
    );
  const label = selected?.text ?? current?.model ?? t('选择模型');
  const models = [
    { text: t('使用秘书或主对话模型'), selected: !own, run: () => update(null) },
    ...choices.map((choice) => ({
      text: choice.text,
      selected: own?.provider === choice.model.provider && own?.model === choice.model.model,
      run: () => update({ ...choice.model, effort: null }),
    })),
  ];
  const efforts = [
    {
      text: t('模型默认'),
      selected: !current?.effort,
      run: () => update({ ...current, effort: null }),
    },
    ...(selected?.efforts ?? []).map((effort) => ({
      text: effort,
      selected: current?.effort === effort,
      run: () => update({ ...current, effort }),
    })),
  ];
  return html`<${DiscussionMenu}
      label=${t('秘书模型')}
      items=${models}
      className="btn assistant-model"
      disabled=${running}
      >${label}<//
    >
    <${DiscussionMenu}
      label=${t('秘书思考强度')}
      items=${efforts}
      className="btn tiny"
      disabled=${running || !current}
      >${current?.effort ?? t('模型默认')}<//
    >`;
}
