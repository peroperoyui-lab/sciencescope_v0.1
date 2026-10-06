import { decodeText, sectionPath } from './text-utils.js';

const SECTION =
  /^\\(part|chapter|section|subsection|subsubsection|paragraph)\*?(?:\[[^\]]*\])?\{(.+)\}\s*$/u;
const LEVELS = { part: 1, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5 };
const MATH_ENVIRONMENT = /^(equation|align|gather|multline|eqnarray|displaymath|math)\*?$/u;

function stripMarkup(text) {
  return text
    .replace(/(^|[^\\])%.*$/gmu, '$1')
    .replace(/\\(?:textbf|textit|emph|underline|texttt|textsc|mathrm|text)\{([^{}]*)\}/gu, '$1')
    .replace(/\\(cite[pt]?|ref|eqref|label|autoref|cref)\{([^{}]*)\}/gu, (_, command, value) => {
      if (command.startsWith('cite')) return `[${value}]`;
      return command === 'label' ? '' : `(${value})`;
    })
    .replace(/\\footnote\{([^{}]*)\}/gu, ' ($1)')
    .replace(/\\item\s*/gu, '• ')
    .replace(/~/gu, ' ')
    .replace(/\\(?:\\|newline|par)/gu, '\n')
    .replace(/[ \t]+/gu, ' ');
}

function commandValue(source, command) {
  const expression = new RegExp(
    `\\\\${command}\\*?(?:\\[[^\\]]*\\])?\\{((?:[^{}]|\\{[^{}]*\\})*)\\}`,
    'u',
  );
  const value = expression.exec(source)?.[1];
  return value === undefined ? undefined : stripMarkup(value).trim();
}

/** @type {import('./types.js').DocumentParser} */
export const latexParser = {
  id: 'latex',
  extensions: ['.tex', '.ltx'],
  async parse(bytes) {
    const source = decodeText(bytes);
    /** @type {import('./types.js').Metadata} */
    const metadata = {};
    const title = commandValue(source, 'title');
    if (title) metadata.title = title;
    const author = commandValue(source, 'author');
    if (author)
      metadata.authors = author
        .split(/\\and|,|;/u)
        .map((value) => value.replace(/\\[a-z]+/giu, '').trim())
        .filter(Boolean)
        .map((literal) => ({ literal }));
    const start = source.indexOf('\\begin{document}');
    const end = source.lastIndexOf('\\end{document}');
    const body = start < 0 ? source : source.slice(start + 16, end > start ? end : undefined);
    const abstract = /\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/u.exec(body);
    if (abstract) metadata.abstract = stripMarkup(abstract[1]).trim();
    const blocks = [];
    const headings = [];
    let lines = [];
    let environment = null;
    let environmentKind = 'paragraph';
    const flush = (kind = 'paragraph') => {
      const content = lines.join('\n').trim();
      let text = kind === 'equation' ? content : stripMarkup(content).trim();
      if (kind === 'caption')
        text =
          commandValue(content, 'caption') ??
          text
            .replace(/\\(?:begin|end)\{[^}]*\}|\\includegraphics(?:\[[^\]]*\])?\{[^}]*\}/gu, '')
            .trim();
      if (text) blocks.push({ kind, text, section: sectionPath(headings) });
      lines = [];
    };
    const closesEnvironment = (line) => {
      if (environment === '$$') return line.trim().endsWith('$$');
      if (environment === '\\[') return line.includes('\\]');
      return line.includes(`\\end{${environment}}`);
    };
    for (const raw of body.split('\n')) {
      const line = raw.replace(/(^|[^\\])%.*$/u, '$1');
      const trimmed = line.trim();
      if (environment) {
        lines.push(line);
        if (closesEnvironment(line)) {
          flush(environmentKind);
          environment = null;
        }
        continue;
      }
      const heading = SECTION.exec(trimmed);
      if (heading) {
        flush();
        const level = LEVELS[heading[1]];
        headings.length = level - 1;
        headings[level - 1] = stripMarkup(heading[2]);
        blocks.push({ kind: 'heading', text: headings[level - 1], section: sectionPath(headings) });
        continue;
      }
      const opening = /^\\begin\{([A-Za-z*]+)\}/u.exec(trimmed)?.[1];
      const isMath = opening && MATH_ENVIRONMENT.test(opening);
      const isFloat = opening && /^(table|figure)\*?$/u.test(opening);
      if (isMath || isFloat || trimmed.startsWith('\\[') || trimmed.startsWith('$$')) {
        flush();
        environment = opening ?? (trimmed.startsWith('\\[') ? '\\[' : '$$');
        environmentKind = isFloat ? 'caption' : 'equation';
        lines.push(line);
        if (trimmed !== '$$' && closesEnvironment(line)) {
          flush(environmentKind);
          environment = null;
        }
        continue;
      }
      if (/^\\(?:begin|end)\{(?:abstract|itemize|enumerate|description|center)\}/u.test(trimmed)) {
        flush();
        continue;
      }
      if (
        /^\\(?:maketitle|tableofcontents|bibliographystyle|bibliography|newpage|clearpage)\b/u.test(
          trimmed,
        )
      )
        continue;
      if (!trimmed) flush();
      else lines.push(line);
    }
    flush(environment ? environmentKind : 'paragraph');
    return { blocks, metadata };
  },
};
