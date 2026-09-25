// LaTeX source: reads the document body, builds the section path from
// \section/\subsection, keeps display math as 'equation' blocks (LaTeX kept
// verbatim so models and KaTeX can read it), strips common markup commands and
// comments. Not a TeX engine: macros are not expanded. Title/abstract/authors
// are taken from \title, \author and the abstract environment when present.
import { decodeText } from './index.mjs';

const SECTION = /^\\(part|chapter|section|subsection|subsubsection|paragraph)\*?(?:\[[^\]]*\])?\{(.+)\}\s*$/u;
const LEVEL = { part: 1, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5 };
const MATH_ENV = /^(equation|align|gather|multline|eqnarray|displaymath|math)\*?$/u;

function stripInline(text) {
  return text
    .replace(/(^|[^\\])%.*$/gmu, '$1')
    .replace(/\\(textbf|textit|emph|underline|texttt|textsc|mathrm|text)\{([^{}]*)\}/gu, '$2')
    .replace(/\\(cite[pt]?|citep|citet|ref|eqref|label|autoref|cref)\{([^{}]*)\}/gu, (_m, cmd, arg) => (cmd.startsWith('cite') ? `[${arg}]` : cmd === 'label' ? '' : `(${arg})`))
    .replace(/\\(footnote)\{([^{}]*)\}/gu, ' ($2)')
    .replace(/\\(item)\s*/gu, '• ')
    .replace(/~/gu, ' ')
    .replace(/\\(\\|newline|par)/gu, '\n')
    .replace(/[ \t]+/gu, ' ');
}
const braced = (source, command) => { const m = new RegExp(`\\\\${command}\\*?(?:\\[[^\\]]*\\])?\\{((?:[^{}]|\\{[^{}]*\\})*)\\}`, 'u').exec(source); return m ? stripInline(m[1]).trim() : undefined; };

export const latexParser = {
  id: 'latex',
  extensions: ['.tex', '.ltx'],
  async parse(bytes) {
    const source = decodeText(bytes);
    const metadata = {};
    const title = braced(source, 'title'); if (title) metadata.title = title;
    const author = braced(source, 'author'); if (author) metadata.authors = author.split(/\\and|,|;/u).map((name) => name.replace(/\\[a-z]+/giu, '').trim()).filter(Boolean).map((literal) => ({ literal }));
    const begin = source.indexOf('\\begin{document}');
    const end = source.lastIndexOf('\\end{document}');
    const body = begin >= 0 ? source.slice(begin + 16, end > begin ? end : undefined) : source;
    const abstract = /\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/u.exec(body);
    if (abstract) metadata.abstract = stripInline(abstract[1]).trim();
    const blocks = []; const path = []; let buffer = []; let env = null; let envName = '';
    const section = () => path.filter(Boolean).join(' > ') || undefined;
    const flush = (kind = 'paragraph') => { const text = kind === 'equation' ? buffer.join('\n').trim() : stripInline(buffer.join('\n')).trim(); if (text) blocks.push({ kind, text, section: section() }); buffer = []; };
    for (const raw of body.split('\n')) {
      const line = raw.replace(/(^|[^\\])%.*$/u, '$1');
      if (env) {
        buffer.push(line);
        if (new RegExp(`\\\\end\\{${envName.replace('*', '\\*')}\\}`, 'u').test(line) || (envName === '$$' && line.trim().endsWith('$$') && buffer.length > 1) || (envName === '\\[' && line.includes('\\]'))) { flush(env); env = null; }
        continue;
      }
      const trimmed = line.trim();
      const heading = SECTION.exec(trimmed);
      if (heading) { flush(); const level = LEVEL[heading[1]]; path.length = level - 1; path[level - 1] = stripInline(heading[2]); blocks.push({ kind: 'heading', text: path[level - 1], section: section() }); continue; }
      const beginEnv = /^\\begin\{([A-Za-z*]+)\}/u.exec(trimmed);
      if (beginEnv && MATH_ENV.test(beginEnv[1])) { flush(); env = 'equation'; envName = beginEnv[1]; buffer.push(line); if (trimmed.includes(`\\end{${beginEnv[1]}}`)) { flush('equation'); env = null; } continue; }
      if (beginEnv && /^(table|figure)\*?$/u.test(beginEnv[1])) { flush(); env = 'caption'; envName = beginEnv[1]; buffer.push(line); continue; }
      if (trimmed.startsWith('\\[') || trimmed === '$$') { flush(); env = 'equation'; envName = trimmed.startsWith('\\[') ? '\\[' : '$$'; buffer.push(line); if (trimmed.startsWith('\\[') && trimmed.includes('\\]')) { flush('equation'); env = null; } continue; }
      if (/^\\(begin|end)\{(abstract|itemize|enumerate|description|center)\}/u.test(trimmed)) { flush(); continue; }
      if (/^\\(maketitle|tableofcontents|bibliographystyle|bibliography|newpage|clearpage)\b/u.test(trimmed)) continue;
      if (!trimmed) { flush(); continue; }
      buffer.push(line);
    }
    flush(env ?? 'paragraph');
    // Captions: keep only the \caption text of floats.
    for (const block of blocks) if (block.kind === 'caption') block.text = braced(block.text, 'caption') ?? stripInline(block.text.replace(/\\(begin|end)\{[^}]*\}|\\includegraphics(\[[^\]]*\])?\{[^}]*\}/gu, '')).trim();
    return { blocks: blocks.filter((block) => block.text), metadata };
  },
};
