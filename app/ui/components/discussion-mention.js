import { useEffect, useRef, useState } from 'preact/hooks';
import { html } from '../html.js';
import { t } from '../i18n/index.js';

/** @param {{candidates:any[],enabled:boolean,box:any,text:string,onChange:(text:string)=>void}} input */
export function useDiscussionMention({ candidates, enabled, box, text, onChange }) {
  const [mention, setMention] = useState(null);
  const [active, setActive] = useState(0);
  const menu = useRef(null);
  function update(input) {
    if (!enabled) return setMention(null);
    const before = input.value.slice(0, input.selectionStart);
    const match = before.match(/(?:^|[\s(（])@([^\s@]*)$/u);
    if (!match) return setMention(null);
    const query = match[1].toLocaleLowerCase();
    const items = candidates.filter(
      (candidate) =>
        !query ||
        candidate.name.toLocaleLowerCase().includes(query) ||
        candidate.id.toLocaleLowerCase().includes(query),
    );
    setMention({ items, start: before.length - match[1].length - 1, end: input.selectionStart });
    setActive(0);
  }
  function choose(candidate) {
    if (!candidate || !mention) return;
    const insert = '@' + candidate.name + ' ';
    // Input events can precede Preact's render; use the current textarea rather
    // than a previous render's draft when the user immediately picks a name.
    const current = box.current?.value ?? text;
    const value = current.slice(0, mention.start) + insert + current.slice(mention.end);
    // Place the caret now, not in a later frame: a deferred caret could land
    // after the user's next edit started and collapse its selection.
    const input = box.current;
    if (input) {
      input.value = value;
      input.focus();
      input.setSelectionRange(mention.start + insert.length, mention.start + insert.length);
    }
    onChange(value);
    setMention(null);
  }
  function onKey(event) {
    if (!mention || event.isComposing || event.keyCode === 229) return false;
    if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      if (mention.items.length)
        setActive(
          (position) =>
            (position + (event.key === 'ArrowDown' ? 1 : mention.items.length - 1)) %
            mention.items.length,
        );
      return true;
    }
    if (['Enter', 'Tab'].includes(event.key)) {
      event.preventDefault();
      choose(mention.items[active]);
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setMention(null);
      return true;
    }
    return false;
  }
  useEffect(() => {
    if (!enabled) setMention(null);
  }, [enabled]);
  useEffect(() => {
    if (!mention) return;
    const outside = (event) => {
      if (!menu.current?.contains(event.target) && event.target !== box.current) setMention(null);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [mention]);
  const content =
    mention &&
    html`<div class="mention-menu" ref=${menu} role="listbox" aria-label=${t('邀请专家')}>
      <div class="mention-title">${t('邀请专家回答')}</div>
      ${mention.items.map(
        (candidate, index) =>
          html`<button
            type="button"
            role="option"
            data-mention=${candidate.id}
            aria-selected=${index === active}
            onMouseDown=${(event) => {
              event.preventDefault();
              choose(candidate);
            }}
          >
            <span class="mention-avatar">${candidate.name.slice(0, 1)}</span
            ><span class="mention-name">${candidate.name}</span
            ><small>${candidate.definition.role || candidate.definition.model?.model || ''}</small>
          </button>`,
      )}${!mention.items.length && html`<div class="mention-empty">${t('没有匹配的专家')}</div>`}
    </div>`;
  return { update, onKey, content, close: () => setMention(null) };
}
