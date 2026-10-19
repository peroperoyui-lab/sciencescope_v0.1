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
  // A presented file the answer names by path shows inline: the image from
  // ScienceScope's copy (click to preview), a link that opens the file.
  const openFile = (event) => {
    const ref = event.target.closest?.('[data-deliverable-ref]');
    if (!ref) return;
    event.preventDefault();
    const id = ref.dataset.deliverableRef;
    if (ref.tagName === 'IMG') actions.openPreview({ kind: 'deliverable', id });
    else actions.attempt(() => actions.openDeliverable(id));
  };
  return html`<div
    ref=${root}
    class="message-text rendered-markdown"
    onClick=${openFile}
    onKeyDown=${(event) => event.key === 'Enter' && openFile(event)}
    dangerouslySetInnerHTML=${{
      __html: withFiles(renderMarkdown(text), message.deliverables, actions.deliverableContent),
    }}
  ></div>`;
}

/** @param {string} value */
function normalPath(value) {
  let path = value;
  try {
    path = decodeURI(value);
  } catch {
    // Keep a path that is not valid percent-encoding as written.
  }
  return path.replaceAll('\\', '/').replace(/^\.\//u, '');
}

/**
 * The presented file a Markdown path names: the same path, a path ending in
 * it, or else the same file name. Web and data URLs are left alone.
 * @param {string | null} ref @param {any[]} files
 */
function fileFor(ref, files) {
  if (!ref || (/^[a-z][a-z0-9+.-]*:/iu.test(ref) && !/^[a-z]:[\\/]/iu.test(ref))) return null;
  const path = normalPath(ref);
  const name = path.split('/').pop();
  return (
    files.find((file) => {
      const source = normalPath(file.sourcePath);
      return source === path || source.endsWith(`/${path}`);
    }) ?? files.find((file) => file.name === name)
  );
}

/**
 * @param {string} markup sanitised HTML
 * @param {any[] | undefined} files the answer's presented files
 * @param {(id: string) => string} contentUrl
 */
function withFiles(markup, files, contentUrl) {
  if (!files?.length) return markup;
  const box = document.createElement('template');
  box.innerHTML = markup;
  for (const element of box.content.querySelectorAll('img[src], a[href]')) {
    const image = element.tagName === 'IMG';
    const file = fileFor(element.getAttribute(image ? 'src' : 'href'), files);
    if (!file) continue;
    element.setAttribute('data-deliverable-ref', file.id);
    if (image) {
      element.setAttribute('src', contentUrl(file.id));
      element.setAttribute('class', 'ss-inline-figure');
      if (!element.getAttribute('alt')) element.setAttribute('alt', file.description || file.name);
    } else {
      element.removeAttribute('href');
      element.setAttribute('class', 'ss-inline-file');
      element.setAttribute('role', 'button');
      element.setAttribute('tabindex', '0');
      element.setAttribute('title', file.description || file.name);
    }
  }
  return box.innerHTML;
}
