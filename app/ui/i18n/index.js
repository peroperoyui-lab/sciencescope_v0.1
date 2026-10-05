// Interface language. Strings are written in Chinese in the components;
// `en.js` maps each one to English. `{name}` placeholders are filled from `values`.
import { en } from './en.js';

let language = 'zh';

/** @param {string} next 'zh' or 'en' (settings.appearance.language). */
export function setLanguage(next) {
  language = next === 'en' ? 'en' : 'zh';
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
}

export function currentLanguage() {
  return language;
}

/**
 * @param {string} text
 * @param {Record<string, string | number>} [values]
 */
export function t(text, values) {
  let result = language === 'en' ? (en[text] ?? text) : text;
  if (values) {
    for (const [key, value] of Object.entries(values)) {
      result = result.replaceAll(`{${key}}`, String(value));
    }
  }
  return result;
}

/** Short local time, or date and time when not today. @param {string} iso */
export function formatTime(iso) {
  const date = new Date(iso);
  const locale = language === 'en' ? 'en-GB' : 'zh-CN';
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString(locale, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
}
