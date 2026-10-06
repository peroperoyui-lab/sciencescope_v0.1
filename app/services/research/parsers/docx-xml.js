import { parseFragment } from 'parse5';

/** @param {string} text @returns {string} */
export function escapeXml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function childrenOf(node) {
  return node.childNodes ?? [];
}

function mathText(node) {
  if (node.nodeName === '#text') return node.value ?? '';
  const child = (name) => childrenOf(node).find((entry) => entry.nodeName === `m:${name}`);
  const render = (name) => mathText(child(name) ?? {});
  switch (node.nodeName) {
    case 'm:f':
      return `(${render('num')})/(${render('den')})`;
    case 'm:ssub':
      return `${render('e')}_{${render('sub')}}`;
    case 'm:ssup':
      return `${render('e')}^{${render('sup')}}`;
    case 'm:ssubsup':
      return `${render('e')}_{${render('sub')}}^{${render('sup')}}`;
    case 'm:rad':
      return `sqrt${child('deg') ? `[${render('deg')}]` : ''}(${render('e')})`;
    default:
      return childrenOf(node).map(mathText).join('');
  }
}

function equationRun(xml) {
  const text = mathText(parseFragment(xml));
  return `<w:r><w:rPr><w:rStyle w:val="ScienceScopeEquation"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

/**
 * Mammoth handles prose/layout; retain the OMML it otherwise omits as equation text.
 * @param {string} xml
 * @returns {string}
 */
export function preserveDocumentStructure(xml) {
  const pageBreak = '<w:r><w:br w:type="page"/></w:r>';
  return xml
    .replace(/<m:oMathPara\b[^>]*>[\s\S]*?<\/m:oMathPara>/gu, equationRun)
    .replace(/<m:oMath\b[^>]*>[\s\S]*?<\/m:oMath>/gu, equationRun)
    .replace(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/gu, (properties) => {
      const marker = /<w:pageBreakBefore\b([^>]*)(?:\/>|>[\s\S]*?<\/w:pageBreakBefore>)/u.exec(
        properties,
      );
      const isDisabled = marker && /w:val="(?:0|false|off)"/u.test(marker[1]);
      return marker && !isDisabled ? properties + pageBreak : properties;
    });
}

/** @param {string|undefined} xml @param {string} tag @returns {string} */
export function propertyText(xml, tag) {
  if (!xml) return '';
  const value = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'u').exec(xml)?.[1];
  if (!value) return '';
  const root = parseFragment(value);
  const textOf = (node) =>
    node.nodeName === '#text' ? node.value : childrenOf(node).map(textOf).join('');
  return textOf(root).trim();
}
