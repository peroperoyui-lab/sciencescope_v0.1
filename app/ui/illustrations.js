// Spot illustrations for the welcome page and empty states (design system
// Illustrations). Line drawings on a 160 x 120 grid in the Lucide stroke
// style; every colour is a class styled from tokens in components.css, so the
// drawings follow the light and dark themes. The gallery card is generated
// from these strings (docs/design/system/build/art.mjs).
import { html } from './html.js';

const STAR = (x, y, r) =>
  `M${x} ${y - r}C${x + r * 0.12} ${y - r * 0.12} ${x + r * 0.12} ${y - r * 0.12} ${x + r} ${y}` +
  `C${x + r * 0.12} ${y + r * 0.12} ${x + r * 0.12} ${y + r * 0.12} ${x} ${y + r}` +
  `C${x - r * 0.12} ${y + r * 0.12} ${x - r * 0.12} ${y + r * 0.12} ${x - r} ${y}` +
  `C${x - r * 0.12} ${y - r * 0.12} ${x - r * 0.12} ${y - r * 0.12} ${x} ${y - r}Z`;

const svg = (body) =>
  `<svg class="ss-art" viewBox="0 0 160 120" aria-hidden="true" focusable="false">${body}</svg>`;

export const ART = {
  // A meeting: three experts around an open notebook, the main expert in green.
  welcome: svg(`
    <ellipse class="ss-art__ground" cx="80" cy="104" rx="58" ry="6"/>
    <path class="ss-art__dash" d="M47 55Q56 60 62 66M113 55Q104 60 98 66M80 40V48"/>
    <path class="ss-art__paper ss-art__line" d="M42 98V66Q61 60 80 66Q99 60 118 66V98Q99 92 80 98Q61 92 42 98Z"/>
    <path class="ss-art__line" d="M80 66V98M50 74Q60 71 72 73M50 81Q60 78 72 80M50 88Q58 86 66 87M88 73Q100 71 110 74M88 80Q100 78 110 81"/>
    <circle class="ss-art__paper ss-art__line" cx="40" cy="36" r="5"/>
    <path class="ss-art__paper ss-art__line" d="M31 51q9-11 18 0"/>
    <circle class="ss-art__soft ss-art__accent-line" cx="80" cy="20" r="5.5"/>
    <path class="ss-art__soft ss-art__accent-line" d="M70 36q10-12 20 0"/>
    <circle class="ss-art__paper ss-art__line" cx="120" cy="36" r="5"/>
    <path class="ss-art__paper ss-art__line" d="M111 51q9-11 18 0"/>
    <path class="ss-art__accent" d="${STAR(80, 56, 6)}"/>`),

  // The knowledge base: papers linked through one entity.
  knowledge: svg(`
    <ellipse class="ss-art__ground" cx="80" cy="106" rx="56" ry="5"/>
    <path class="ss-art__dash" d="M46 56Q60 48 72 46M114 52Q100 46 88 46M80 54V68"/>
    <g transform="rotate(-6 38 60)"><rect class="ss-art__paper ss-art__line" x="24" y="40" width="30" height="40" rx="3"/>
      <path class="ss-art__line" d="M30 50h18M30 56h18M30 62h12"/></g>
    <g transform="rotate(6 122 56)"><rect class="ss-art__paper ss-art__line" x="107" y="36" width="30" height="40" rx="3"/>
      <path class="ss-art__line" d="M113 46h18M113 52h18M113 58h12"/></g>
    <rect class="ss-art__paper ss-art__line" x="64" y="68" width="32" height="34" rx="3"/>
    <path class="ss-art__line" d="M70 77h20M70 83h20M70 89h13"/>
    <circle class="ss-art__soft ss-art__accent-line" cx="80" cy="44" r="11"/>
    <path class="ss-art__accent" d="${STAR(80, 44, 6)}"/>`),

  // The editing desk: a page with one revised line and a small version graph.
  desk: svg(`
    <ellipse class="ss-art__ground" cx="76" cy="108" rx="52" ry="5"/>
    <rect class="ss-art__paper ss-art__line" x="40" y="14" width="64" height="88" rx="3"/>
    <rect class="ss-art__soft" x="47" y="49" width="46" height="8" rx="2"/>
    <path class="ss-art__line" d="M48 26h40M48 34h48M48 42h44M48 53h38M48 64h48M48 72h42M48 80h46M48 88h30"/>
    <path class="ss-art__accent-line" d="M89 48v10"/>
    <path class="ss-art__line" d="M122 30v24M122 54q0 12 14 18"/>
    <circle class="ss-art__paper ss-art__line" cx="122" cy="26" r="4"/>
    <circle class="ss-art__paper ss-art__line" cx="122" cy="54" r="4"/>
    <circle class="ss-art__soft ss-art__accent-line" cx="138" cy="74" r="5"/>`),

  // An empty project folder waiting for files.
  folder: svg(`
    <ellipse class="ss-art__ground" cx="80" cy="104" rx="56" ry="6"/>
    <rect class="ss-art__dash" x="62" y="22" width="36" height="44" rx="3"/>
    <path class="ss-art__dash" d="M70 34h20M70 41h20M70 48h12"/>
    <path class="ss-art__paper ss-art__line" d="M34 98V44a4 4 0 0 1 4-4h22l7 8h55a4 4 0 0 1 4 4v46Z"/>
    <path class="ss-art__soft ss-art__line" d="M30 58a4 4 0 0 1 4-4h92a4 4 0 0 1 4 4l-4 40H34Z"/>
    <path class="ss-art__accent" d="${STAR(80, 76, 7)}"/>`),
};

/** @param {{ name: keyof typeof ART }} props */
export function Illustration({ name }) {
  return html`<span class="ss-empty__art" dangerouslySetInnerHTML=${{ __html: ART[name] }}></span>`;
}
