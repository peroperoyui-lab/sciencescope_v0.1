// The main input box in the old interface's markup (`.composer`), shared by
// the welcome page and meetings. The model button chooses the default model
// from the configured providers.
import { useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';

function useModelMenu() {
  const actions = useActions();
  const settings = useAppState((state) => state.settings);
  const current = settings?.models?.default;
  const choices = (settings?.providers ?? []).flatMap((provider) =>
    provider.models.map((model) => ({
      provider: provider.id,
      model: model.id,
      text: `${provider.name ?? provider.id} · ${model.name ?? model.id}`,
    })),
  );
  const label = current
    ? (choices.find((c) => c.provider === current.provider && c.model === current.model)?.text ??
      `${current.provider} · ${current.model}`)
    : t('未连接模型');
  const open = (event) => {
    if (!choices.length) {
      event.preventDefault();
      actions.toast(t('还没有配置模型服务。'));
      return;
    }
    actions.openMenu(
      event,
      choices.map((choice) => ({
        text: choice.text,
        check: current?.provider === choice.provider && current?.model === choice.model,
        run: () =>
          actions.attempt(() =>
            actions.updateSettings({
              models: { default: { provider: choice.provider, model: choice.model } },
            }),
          ),
      })),
      t('模型'),
    );
  };
  return { label, open };
}

/**
 * @param {{ onSend: (text: string) => Promise<any>, running?: boolean,
 *   onStop?: () => void, inputRef?: any }} props
 */
export function Composer({ onSend, running = false, onStop, inputRef }) {
  const actions = useActions();
  const sendKey = useAppState((state) => state.settings?.composer?.sendKey ?? 'enter');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const ownRef = useRef(null);
  const box = inputRef ?? ownRef;
  const model = useModelMenu();

  async function send() {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    // Keep the draft until the host accepts the message.
    const sent = await actions.attempt(() => onSend(value));
    setSending(false);
    if (sent !== undefined) setText('');
  }

  return html`<div class="composer" data-composer="main">
    <textarea
      ref=${box}
      value=${text}
      placeholder=${t('输入问题或下一步工作…')}
      aria-label=${t('主输入框')}
      onInput=${(event) => setText(event.currentTarget.value)}
      onKeyDown=${(event) => {
        if (event.key !== 'Enter' || event.isComposing || event.shiftKey) return;
        const wantsModifier = sendKey === 'ctrl-enter';
        if (wantsModifier === (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          send();
        }
      }}
    ></textarea>
    <div class="composerbar">
      <span class="spacer"></span>
      <button data-v="model-menu" onClick=${model.open}>
        ${model.label} <${Icon} name="down" />
      </button>
      ${
        running
          ? html`<button
              class="sendbtn"
              data-main-stop
              aria-label=${t('停止当前回复')}
              title=${t('停止当前回复')}
              onClick=${onStop}
            >
              ■
            </button>`
          : html`<button
              class="sendbtn"
              aria-label=${t('发送')}
              disabled=${!text.trim() || sending}
              onClick=${send}
            >
              <${Icon} name="arrow" />
            </button>`
      }
    </div>
  </div>`;
}
