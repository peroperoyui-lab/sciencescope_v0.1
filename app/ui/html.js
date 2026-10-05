// `html` tagged templates: Preact components without a build step.
import { h } from 'preact';
import htm from 'htm';

// htm's type declarations do not resolve as an ES module under NodeNext.
export const html = /** @type {any} */ (htm).bind(h);
