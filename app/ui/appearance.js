// Settings that change the window itself: language, theme, density, fonts,
// motion and scrollbars (read by the legacy styles from <html>), and the
// keyboard shortcuts.
import { setLanguage } from './i18n/index.js';

const darkQuery =
  typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
let current = null;

/** @param {any} settings */
export function applyAppearance(settings) {
  current = settings;
  const look = settings?.appearance ?? {};
  const root = document.documentElement;
  setLanguage(look.language);
  const dark = look.theme === 'dark' || (look.theme === 'system' && darkQuery?.matches);
  if (dark) root.dataset.theme = 'dark';
  else delete root.dataset.theme;
  if (look.density === 'compact') root.dataset.density = 'compact';
  else delete root.dataset.density;
  root.toggleAttribute('data-reduce-motion', Boolean(look.reduceMotion));
  root.toggleAttribute('data-show-scrollbars', Boolean(look.scrollbars));
  if (look.font) root.style.setProperty('--ss-font', `"${look.font}", var(--ss-font-default)`);
  else root.style.removeProperty('--ss-font');
  root.style.setProperty('--chat-font-size', `${look.chatFontSize ?? 16}px`);
  root.style.setProperty('--code-font-size', `${look.codeFontSize ?? 14}px`);
}

darkQuery?.addEventListener('change', () => current && applyAppearance(current));

/**
 * "Ctrl+Shift+K" for a key event, or '' for a lone modifier.
 * @param {KeyboardEvent} event
 */
export function comboOf(event) {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return '';
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [
    event.ctrlKey || event.metaKey ? 'Ctrl' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
    key,
  ]
    .filter(Boolean)
    .join('+');
}
