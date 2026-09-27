// pdf.js worker entry: the worker is a separate global, so it needs the same
// polyfills as the page before pdf.js loads.
import './js-polyfills.mjs';
import './vendor/pdf/pdf.worker.mjs';
