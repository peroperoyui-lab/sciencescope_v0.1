// The formula editor of the tex desk (design system PageDeskTex): a MathLive
// field, a palette of templates and the LaTeX that will be written back.
// Applying replaces the formula's source as one ordinary change; labels and
// the whitespace around the formula stay as they were.
import { useEffect, useRef, useState } from 'preact/hooks';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { formulaLatex } from '../tex-render.js';

const WIDTH = 468;

// [label shown, what it inserts, name]; #@ takes the selection, #? is an empty slot.
const PALETTE = [
  [html`<span class="ss-frac"><span>□</span><span>□</span></span>`, '\\frac{#@}{#?}', '分式'],
  [html`□<sup>□</sup>`, '#@^{#?}', '上标'],
  [html`□<sub>□</sub>`, '#@_{#?}', '下标'],
  ['√□', '\\sqrt{#0}', '根号'],
  ['∑', '\\sum_{#?}^{#?}', '求和'],
  ['∫', '\\int_{#?}^{#?}', '积分'],
  ['( )', '\\left(#0\\right)', '圆括号'],
  ['[ ]', '\\left[#0\\right]', '方括号'],
  ['min', '\\min', 'min'],
  ['≤', '\\le', '小于等于'],
  ['α', '\\alpha', 'alpha'],
  ['β', '\\beta', 'beta'],
  ['θ', '\\theta', 'theta'],
  ['σ', '\\sigma', 'sigma'],
  ['∞', '\\infty', '无穷'],
  ['±', '\\pm', '正负'],
  ['×', '\\times', '乘'],
  ['→', '\\to', '箭头'],
  ['⋯', '\\cdots', '省略号'],
  ['▦', '\\begin{pmatrix}#?&#?\\\\#?&#?\\end{pmatrix}', '矩阵'],
];

let ready = null;
/** Load MathLive once; its fonts are KaTeX's, already served for the page. */
function loadMathLive() {
  ready ??= import('mathlive').then((/** @type {any} */ module) => {
    const Field = module.MathfieldElement;
    Field.fontsDirectory = '/vendor/katex/fonts';
    Field.soundsDirectory = null;
    return module;
  });
  return ready;
}

/**
 * @param {{ formula: { source: string, number: string, line: number, rect: DOMRect, insert?: boolean },
 *   onApply: (latex: string) => void, onClose: () => void }} props
 */
export function DeskFormula({ formula, onApply, onClose }) {
  const host = useRef(/** @type {HTMLElement | null} */ (null));
  const box = useRef(/** @type {HTMLElement | null} */ (null));
  const field = useRef(/** @type {any} */ (null));
  const initial = useRef('');
  const [latex, setLatex] = useState(formulaLatex(formula.source));
  const [failed, setFailed] = useState('');
  const [position, setPosition] = useState({
    left: formula.rect.left,
    top: formula.rect.bottom + 6,
  });

  useEffect(() => {
    let active = true;
    loadMathLive()
      .then(() => {
        if (!active || !host.current) return;
        const element = /** @type {any} */ (document.createElement('math-field'));
        element.mathVirtualKeyboardPolicy = 'manual';
        element.setAttribute('aria-label', t('公式'));
        host.current.replaceChildren(element);
        element.menuItems = [];
        element.value = formulaLatex(formula.source);
        initial.current = element.value;
        element.addEventListener('input', () => setLatex(element.value));
        field.current = element;
        requestAnimationFrame(() => element.focus());
      })
      .catch((failure) => active && setFailed(failure.message));
    return () => {
      active = false;
    };
  }, []);

  // Below the formula when there is room, else above it; always on screen.
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const height = node.offsetHeight;
    const below = formula.rect.bottom + 6;
    const top =
      below + height <= innerHeight - 8 ? below : Math.max(8, formula.rect.top - height - 6);
    setPosition({ left: Math.max(8, Math.min(formula.rect.left, innerWidth - WIDTH - 8)), top });
  }, [failed]);

  const apply = () => {
    const value = field.current?.value ?? latex;
    if (!formula.insert && value === initial.current) onClose();
    else if (!value.trim()) onClose();
    else onApply(value);
  };
  const insert = (template) => {
    field.current?.executeCommand(['insert', template, { selectionMode: 'placeholder' }]);
    field.current?.focus();
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      apply();
    }
  };
  const title = formula.insert
    ? t('插入公式')
    : formula.number
      ? t('编辑公式（{n}）', { n: formula.number })
      : t('编辑公式');
  return html`<div
    class="ss-pop ss-mathedit"
    role="dialog"
    aria-label=${title}
    ref=${box}
    style=${{ left: `${position.left}px`, top: `${position.top}px` }}
    onKeyDown=${onKeyDown}
  >
    <div class="ss-pop__head">
      <${Lucide} name="radical" /><span>${title}</span>
      <button
        type="button"
        class="ss-icon-btn"
        aria-label=${t('关闭')}
        data-tip=${t('关闭')}
        data-kbd="Esc"
        onClick=${onClose}
      >
        <${Lucide} name="x" />
      </button>
    </div>
    <div class="ss-pop__body">
      <div class="ss-mathedit__field" ref=${host}>
        ${failed ? html`<span class="ss-muted">${t('公式编辑器没能加载：{message}', { message: failed })}</span>` : html`<span class="ss-spin"></span>`}
      </div>
      <div class="ss-mathedit__pal" aria-label=${t('模板')}>
        ${PALETTE.map(
          ([label, template, name]) =>
            html`<button
              type="button"
              aria-label=${t(name)}
              data-tip=${t(name)}
              disabled=${!!failed}
              onClick=${() => insert(template)}
            >
              ${label}
            </button>`,
        )}
      </div>
      <div class="ss-pop__section">
        <div
          class="ss-mathedit__src"
          data-tip=${formula.insert ? t('插入到光标处') : t('写回源码第 {n} 行', { n: formula.line })}
        >
          ${latex || ' '}
        </div>
      </div>
    </div>
    <div class="ss-pop__foot">
      <span class="ss-muted ss-mathedit__hint"
        >${t('直接输入 {frac}、^、_ 也可以', { frac: '\\frac' })}</span
      >
      <span class="ss-mathedit__actions">
        <button type="button" class="ss-btn ss-btn--sm ss-btn--ghost" onClick=${onClose}>
          ${t('取消')}
        </button>
        <button
          type="button"
          class="ss-btn ss-btn--sm ss-btn--primary"
          data-kbd="Ctrl Enter"
          disabled=${!!failed}
          onClick=${apply}
        >
          ${t('应用')}
        </button>
      </span>
    </div>
  </div>`;
}
