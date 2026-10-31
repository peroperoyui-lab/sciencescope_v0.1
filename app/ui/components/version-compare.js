// Two versions side by side (U3; gallery PageDeskCompare): old page left, new
// page right, with what only the old one has in red and what the new one adds
// or reformats in pale yellow. The pages scroll together while the lock in the
// gap between them is closed. The editing desk and the version page share it.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions } from '../context.js';
import { compareModel, scrollMap } from '../desk-compare.js';
import { html } from '../html.js';
import { formatTime, t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { Select } from './settings-kit.js';

/** "v7 · 主线" @param {any} version */
export const versionText = (version) =>
  `v${version.number} · ${version.title || version.label || version.branch || t('主线')}`;

/** @param {HTMLElement} column @param {Element} element */
const topIn = (column, element) =>
  element.getBoundingClientRect().top - column.getBoundingClientRect().top + column.scrollTop;

/**
 * @param {{ versions: any[], left: string | null, right: string | null,
 *   onPick: (left: string | null, right: string | null) => void, onExit?: () => void,
 *   tag?: string, children?: any }} props
 * `versions` are one group's versions, newest first; `left` is the baseline.
 * `children` go in the bar before 退出比较.
 */
export function VersionCompare({ versions, left, right, onPick, onExit, tag = 'div', children }) {
  const actions = useActions();
  const [result, setResult] = useState(/** @type {any} */ (null));
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(true);
  const [current, setCurrent] = useState(-1);
  const [total, setTotal] = useState(0);
  // TeX shows its rendered pages, or the source on request.
  const [texSource, setTexSource] = useState(false);
  const columns = [useRef(/** @type {HTMLElement | null} */ (null)), useRef(null)];
  const pages = [useRef(/** @type {HTMLElement | null} */ (null)), useRef(null)];
  const view = useRef(/** @type {any} */ (null));
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const same = !!left && left === right;
  const ready = result && (result.diff?.status === 'ready' || result.diff?.status === 'unchanged');

  useEffect(() => {
    if (!left || !right || same) {
      setResult(null);
      return undefined;
    }
    let active = true;
    setResult(null);
    setError('');
    setCurrent(-1);
    actions
      .diffVersions(right, left)
      .then((value) => active && setResult(value))
      .catch((failure) => active && setError(failure.message));
    return () => {
      active = false;
    };
  }, [left, right]);

  // Draw both pages and work out how their scroll positions line up.
  useEffect(() => {
    if (!ready) return undefined;
    let active = true;
    let observer = null;
    // Word pictures come from each version's original file.
    const urls = [];
    /** @param {string} id */
    const media = (id) =>
      result.format === 'docx'
        ? (/** @type {any} */ ref) =>
            actions.versionMedia(id, ref).then((url) => {
              urls.push(url);
              return url;
            })
        : null;
    (async () => {
      const texPage = result.format === 'tex' && !texSource;
      const [{ renderComparePage }, { renderTexComparePage }] = await Promise.all([
        import('../readers/desk-compare-page.js'),
        texPage ? import('../readers/tex-compare-page.js') : /** @type {any} */ ({}),
      ]);
      if (!active || !pages[0].current || !pages[1].current) return;
      const model = compareModel(result);
      const source = result.format === 'md' || result.format === 'tex';
      for (const page of pages) page.current.classList.toggle('ss-page--tex', texPage);
      const elements = texPage
        ? [
            renderTexComparePage(pages[0].current, result.old.blocks, model.old),
            renderTexComparePage(pages[1].current, result.new.blocks, model.new),
          ]
        : [
            renderComparePage(pages[0].current, result.old.blocks, model.old, {
              source,
              media: media(left),
            }),
            renderComparePage(pages[1].current, result.new.blocks, model.new, {
              source,
              media: media(right),
            }),
          ];
      const measure = () => {
        const [a, b] = columns.map((ref) => ref.current);
        if (!a || !b) return;
        /** @type {[number, number][]} */
        const points = [[0, 0]];
        for (const [o, n] of model.anchors) {
          const first = elements[0][o];
          const second = elements[1][n];
          /** @type {[number, number]} */
          const top = [topIn(a, first), topIn(b, second)];
          points.push(top, [top[0] + first.offsetHeight, top[1] + second.offsetHeight]);
        }
        points.push([a.scrollHeight, b.scrollHeight]);
        view.current.map = scrollMap(points);
      };
      view.current = { model, elements, map: scrollMap([]), echo: [null, null], measure };
      setTotal(model.stops.length);
      measure();
      observer = new ResizeObserver(() => view.current?.measure());
      observer.observe(pages[0].current);
      observer.observe(pages[1].current);
    })().catch((failure) => active && setError(failure.message));
    return () => {
      active = false;
      observer?.disconnect();
      for (const url of urls) URL.revokeObjectURL(url);
      view.current = null;
      setTotal(0);
    };
  }, [result, texSource]);

  /** Scroll `to` so it matches `from`, a third of the way down the view. @param {0 | 1} from */
  const follow = (from) => {
    const state = view.current;
    const source = columns[from].current;
    const target = columns[1 - from].current;
    if (!state || !source || !target) return;
    const line = source.clientHeight / 3;
    const y = source.scrollTop + line;
    const mapped = from === 0 ? state.map.toRight(y) : state.map.toLeft(y);
    target.scrollTop = mapped - line;
    state.echo[1 - from] = target.scrollTop;
  };
  /** @param {0 | 1} side */
  const onScroll = (side) => () => {
    const state = view.current;
    if (!state) return;
    const column = columns[side].current;
    // Our own scroll of this page comes back as an event; only the reader's counts.
    if (state.echo[side] != null && Math.abs(column.scrollTop - state.echo[side]) < 2) {
      state.echo[side] = null;
      return;
    }
    state.echo[side] = null;
    if (lockedRef.current) follow(side);
  };

  /** Mark 处 `index` on both pages and bring it into view. @param {number} index */
  const show = (index) => {
    const state = view.current;
    if (!state) return;
    for (const page of pages)
      for (const node of page.current?.querySelectorAll('.ss-diff-cur') ?? [])
        node.classList.remove('ss-diff-cur');
    const stop = state.model.stops[index];
    [0, 1].forEach((side) => {
      const marked = [...(pages[side].current?.querySelectorAll(`[data-stops~="${index}"]`) ?? [])];
      for (const node of marked) node.classList.add('ss-diff-cur');
      const block = side === 0 ? stop.old : stop.new;
      const anchor = marked[0] ?? (block == null ? null : state.elements[side][block]);
      const column = columns[side].current;
      if (!anchor || !column) return;
      column.scrollTop = topIn(column, anchor) - column.clientHeight / 3;
      state.echo[side] = column.scrollTop;
    });
    setCurrent(index);
  };
  /** @param {1 | -1} direction */
  const step = (direction) => {
    if (!total) return;
    show(current < 0 ? (direction > 0 ? 0 : total - 1) : (current + direction + total) % total);
  };
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const key = (event) => {
      if (event.key !== 'F7') return;
      event.preventDefault();
      stepRef.current(event.shiftKey ? -1 : 1);
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);

  const toggleLock = () => {
    setLocked(!locked);
    // Locking again lines the right page up with the left one.
    if (!locked) follow(0);
  };

  // Key versions (重点) come first, the rest keep their order.
  const options = [
    ...versions.filter((version) => version.key),
    ...versions.filter((version) => !version.key),
  ].map((version) => ({
    value: version.id,
    text: versionText(version),
    description: version.key
      ? `${t('重点')} · ${formatTime(version.createdAt)}`
      : formatTime(version.createdAt),
  }));
  const byId = (id) => versions.find((version) => version.id === id);
  const leftVersion = byId(left);
  const rightVersion = byId(right);
  const ordered = leftVersion && rightVersion && leftVersion.number < rightVersion.number;
  const label = (version, word) =>
    version &&
    html`<div class="ss-cmp__label">
      <b>${ordered ? `${word} · ` : ''}${versionText(version)}</b>${formatTime(version.createdAt)}
    </div>`;
  const counts = result?.diff?.counts;
  const status = result?.diff?.status;
  let message = null;
  if (same) message = [t('两边是同一个版本'), t('在上面换一个版本再比较。')];
  else if (!left || !right) message = [t('选两个版本比较'), ''];
  else if (error) message = [t('比较没有完成'), error];
  else if (!result) message = null;
  else if (!ready) message = [t('这两版读不出正文'), t('可以分别用系统程序打开原件对照。')];

  return html`<${tag} class="ss-cmp" data-compare=${status ?? (error ? 'error' : 'loading')}>
    <div class="ss-cmp__bar" role="toolbar" aria-label=${t('比较')}>
      <${Lucide} name="git-compare" />
      <${Select}
        label=${t('左边的版本')}
        small
        width=${184}
        value=${left}
        options=${options}
        placeholder=${t('选择版本')}
        onChange=${(value) => onPick(value, right)}
      />
      <button
        type="button"
        class="ss-icon-btn"
        aria-label=${t('交换两侧')}
        data-tip=${t('交换两侧')}
        onClick=${() => onPick(right, left)}
      >
        <${Lucide} name="arrow-left-right" />
      </button>
      <${Select}
        label=${t('右边的版本')}
        small
        width=${184}
        value=${right}
        options=${options}
        placeholder=${t('选择版本')}
        onChange=${(value) => onPick(left, value)}
      />
      ${
        result?.format === 'tex' &&
        html`<div class="ss-seg ss-seg--sm" role="group" aria-label=${t('比较的样子')}>
          <button
            type="button"
            aria-pressed=${String(!texSource)}
            onClick=${() => setTexSource(false)}
          >
            ${t('页面')}
          </button>
          <button
            type="button"
            aria-pressed=${String(texSource)}
            onClick=${() => setTexSource(true)}
          >
            ${t('源码')}
          </button>
        </div>`
      }
      <span class="ss-cmp__spacer"></span>
      ${
        ready &&
        (status === 'unchanged'
          ? html`<span class="ss-cmp__counts">${t('两版内容相同')}</span>`
          : html`<span
              class="ss-cmp__counts"
              data-tip=${result.diff.limited ? t('改动很多，有些段落按位置对齐') : undefined}
            >
              ${counts.deleted > 0 && html`<span class="ss-diff-del">${t('删 {n} 处', { n: counts.deleted })}</span>`}
              ${counts.inserted > 0 && html`<span class="ss-rev-ins">${t('增 {n} 处', { n: counts.inserted })}</span>`}
              ${counts.format > 0 && html`<span class="ss-diff-fmt">${t('格式 {n} 处', { n: counts.format })}</span>`}
            </span>`)
      }
      <button
        type="button"
        class="ss-icon-btn"
        aria-label=${t('上一处')}
        data-tip=${t('上一处')}
        data-kbd="Shift F7"
        disabled=${!total}
        onClick=${() => step(-1)}
      >
        <${Lucide} name="chevron-up" />
      </button>
      <span class="ss-cmp__pos" aria-live="polite"
        >${total ? `${current < 0 ? '–' : current + 1} / ${total}` : '0 / 0'}</span
      >
      <button
        type="button"
        class="ss-icon-btn"
        aria-label=${t('下一处')}
        data-tip=${t('下一处')}
        data-kbd="F7"
        disabled=${!total}
        onClick=${() => step(1)}
      >
        <${Lucide} name="chevron-down" />
      </button>
      ${children}
      ${
        onExit &&
        html`<button type="button" class="ss-btn ss-btn--sm" onClick=${onExit}>
          <${Lucide} name="x" />${t('退出比较')}
        </button>`
      }
    </div>
    <div class="ss-cmp__pages">
      ${
        ready
          ? html`<div class="ss-cmp__col" ref=${columns[0]} onScroll=${onScroll(0)}>
                ${label(leftVersion, t('旧'))}
                <article class="ss-page" ref=${pages[0]} aria-label=${t('左页')}></article>
              </div>
              <div class="ss-cmp__gutter">
                <button
                  type="button"
                  class="ss-cmp__lock"
                  aria-pressed=${String(locked)}
                  aria-label=${locked ? t('解锁，两页各自滚动') : t('锁定，两页同步滚动')}
                  data-tip=${locked ? t('解锁，两页各自滚动') : t('锁定，两页同步滚动')}
                  onClick=${toggleLock}
                >
                  <${Lucide} name=${locked ? 'lock' : 'lock-open'} small />
                </button>
              </div>
              <div class="ss-cmp__col" ref=${columns[1]} onScroll=${onScroll(1)}>
                ${label(rightVersion, t('新'))}
                <article class="ss-page" ref=${pages[1]} aria-label=${t('右页')}></article>
              </div>`
          : html`<div class="ss-empty ss-cmp__state">
              <div class="ss-empty__icon">
                ${
                  message
                    ? html`<${Lucide} name=${error ? 'circle-alert' : 'git-compare'} />`
                    : html`<span class="ss-spin"></span>`
                }
              </div>
              <div class="ss-empty__title">${message ? message[0] : t('正在比较…')}</div>
              ${message?.[1] && html`<div class="ss-empty__text">${message[1]}</div>`}
            </div>`
      }
    </div>
  <//>`;
}
