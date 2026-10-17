// Meeting model overrides never patch the Main composer's default.
// Each caller supplies its own inheritance chain and visible menu labels.
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { thinkingChoices, useModelCatalog } from '../model-catalog.js';
import { DiscussionMenu } from './discussion-menu.js';

/**
 * @param {{ current: any, own: any, running: boolean,
 * modelLabel: string, effortLabel: string, inheritLabel: string,
 * onUpdate: (model: any) => void }} props
 * @returns {import('preact').VNode}
 */
export function AssistantModel({
  current,
  own,
  running,
  modelLabel,
  effortLabel,
  inheritLabel,
  onUpdate,
}) {
  const providers = useModelCatalog();
  const choices = providers.flatMap((provider) =>
    provider.models.map((descriptor) => ({
      model: { provider: provider.id, model: descriptor.id },
      text: `${provider.name ?? provider.id} / ${descriptor.name ?? descriptor.id}`,
      efforts: thinkingChoices(descriptor),
    })),
  );
  const selected = choices.find(
    (choice) =>
      choice.model.provider === current?.provider && choice.model.model === current?.model,
  );
  const models = [
    { text: t(inheritLabel), selected: !own, run: () => onUpdate(null) },
    ...choices.map((choice) => ({
      text: choice.text,
      selected: own?.provider === choice.model.provider && own?.model === choice.model.model,
      run: () => onUpdate({ ...choice.model, effort: null }),
    })),
  ];
  const efforts = [
    {
      text: t('模型默认'),
      selected: !current?.effort,
      run: () => onUpdate({ ...current, effort: null }),
    },
    ...(selected?.efforts ?? []).map((effort) => ({
      text: effort,
      selected: current?.effort === effort,
      run: () => onUpdate({ ...current, effort }),
    })),
  ];
  return html`<${DiscussionMenu}
      label=${t(modelLabel)}
      items=${models}
      className="btn assistant-model"
      disabled=${running}
    >
      <span class="ellipsis" title=${selected?.text ?? current?.model ?? t('选择模型')}
        >${selected?.text ?? current?.model ?? t('选择模型')}</span
      ><//
    >
    <${DiscussionMenu}
      label=${t(effortLabel)}
      items=${efforts}
      className="btn tiny"
      disabled=${running || !current}
    >
      ${current?.effort ?? t('模型默认')}<//
    >`;
}
