// How a docx atom (formula, picture, field, footnote…) looks on a desk page:
// the editor and the comparison pages draw them the same way.
import { COPYABLE, MARKERS } from '../desk-blocks.js';
import { t } from '../i18n/index.js';

const ATOM_NAMES = {
  math: '公式',
  image: '图片',
  field: '引用或域',
  footnote: '脚注',
  textbox: '文本框',
  ins: '修订',
  del: '修订',
  opaque: '对象',
};

/**
 * @param {any} attrs
 * @param {((ref: any) => Promise<string>) | null} media
 * @returns {HTMLElement}
 */
export function atomElement(attrs, media) {
  const { atom, display } = attrs;
  const data = { 'data-atom': atom, 'data-attrs': JSON.stringify(attrs) };
  const element = document.createElement(
    atom === 'break' ? 'br' : atom === 'footnote' ? 'sup' : 'span',
  );
  for (const [name, value] of Object.entries(data)) element.setAttribute(name, value);
  if (atom === 'break') return element;
  if (MARKERS.has(atom)) {
    element.className = 'ss-desk-marker';
    return element;
  }
  if (COPYABLE.has(atom)) {
    element.className = atom === 'tab' ? 'ss-desk-tab' : '';
    element.textContent = display;
    return element;
  }
  const name = t(ATOM_NAMES[atom] ?? ATOM_NAMES.opaque);
  element.className = `ss-atom ss-atom--${atom}`;
  element.setAttribute('data-tip', t('{name}：编辑台保留原样，可在 Word 里修改', { name }));
  if (atom === 'footnote') return element;
  if (atom === 'image' && media) {
    element.textContent = name;
    media(attrs.ref)
      .then((url) => {
        const image = document.createElement('img');
        image.alt = name;
        image.onload = () => element.replaceChildren(image);
        image.src = url;
      })
      .catch(() => {});
    return element;
  }
  element.textContent = display && display !== '￼' ? display : name;
  return element;
}
