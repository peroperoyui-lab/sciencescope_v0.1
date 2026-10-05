// Content-Disposition for a download, with an ASCII fallback for browsers
// that ignore the UTF-8 form.
/** @param {string} name */
export function attachment(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
