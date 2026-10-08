import { useEffect, useRef } from 'preact/hooks';
import { useActions } from '../context.js';
import { html } from '../html.js';
import { renderMarkdown } from '../markdown.js';

/**
 * @param {{message:any,text:string}} props
 */
export function CitedMarkdown({ message, text }) {
  const actions = useActions();
  const root = useRef(null);
  useEffect(() => {
    let active = true;
    if (message.status === 'streaming') return;
    actions
      .messageCitations(message.id)
      .then((labels) => {
        if (!active) return;
        const targets = new Map(
          labels
            .filter((label) => label.parseStatus === 'parsed' && label.targets.length)
            .map((label) => [label.raw, label.targets]),
        );
        const walker = document.createTreeWalker(root.current, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const node of nodes) {
          if (node.parentElement.closest('code,pre,a,button')) continue;
          let remaining = node.textContent;
          const fragment = document.createDocumentFragment();
          while (remaining) {
            const match = [...targets.keys()]
              .map((raw) => ({ raw, at: remaining.indexOf(raw) }))
              .filter((entry) => entry.at >= 0)
              .sort((a, b) => a.at - b.at)[0];
            if (!match) {
              fragment.append(remaining);
              break;
            }
            fragment.append(remaining.slice(0, match.at));
            const link = document.createElement('button');
            link.className = 'research-citation';
            link.textContent = match.raw;
            link.onclick = (event) => {
              const values = targets.get(match.raw);
              if (values.length === 1)
                actions.openPreview({ ...values[0], owner: message.meetingId });
              else
                actions.openMenu(
                  event,
                  values.map((target) => ({
                    text: target.id,
                    run: () => actions.openPreview({ ...target, owner: message.meetingId }),
                  })),
                );
            };
            fragment.append(link);
            remaining = remaining.slice(match.at + match.raw.length);
          }
          node.parentNode.replaceChild(fragment, node);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [text, message.status]);
  return html`<div
    ref=${root}
    class="message-text rendered-markdown"
    dangerouslySetInnerHTML=${{ __html: renderMarkdown(text) }}
  ></div>`;
}
