// The secretary's model is a meeting override, never a patch to the Main
// composer default. Inheritance remains visible and explicit.
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { AssistantModel } from './assistant-model.js';

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
  return html`<${AssistantModel}
    current=${current}
    own=${own}
    providers=${settings?.providers ?? []}
    running=${running}
    modelLabel="秘书模型"
    effortLabel="秘书思考强度"
    inheritLabel="使用秘书或主对话模型"
    onUpdate=${(model) => actions.attempt(() => actions.updateMeeting(meeting.id, { policy: { ...meeting.policy, model } }))}
  />`;
}
