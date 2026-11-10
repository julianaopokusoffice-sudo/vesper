/**
 * A small, dependency-free Markdown reader. It exists so the document tool can
 * turn what a model writes into a real .docx or a styled .html without pulling
 * a pandoc-sized dependency into a local-first app. It covers the syntax models
 * actually emit: headings, emphasis, code, lists, quotes, rules, links, images
 * and pipe tables.
 */

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'rule' }
  | { kind: 'table'; head: string[]; rows: string[][] };

export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;

    if (!line.trim()) {
      index++;
      continue;
    }

    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      index++;
      while (index < lines.length && !/^```/.test(lines[index]!)) {
        body.push(lines[index]!);
        index++;
      }
      index++;
      blocks.push({ kind: 'code', lang: fence[1] ?? '', text: body.join('\n') });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]!.trim() });
      index++;
      continue;
    }

    if (/^(---|\*\*\*|___)\s*$/.test(line)) {
      blocks.push({ kind: 'rule' });
      index++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index]!)) {
        quote.push(lines[index]!.replace(/^>\s?/, ''));
        index++;
      }
      blocks.push({ kind: 'quote', text: quote.join('\n').trim() });
      continue;
    }

    if (/^\|.*\|\s*$/.test(line) && /^\|[\s:|-]+\|\s*$/.test(lines[index + 1] ?? '')) {
      const head = splitRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && /^\|.*\|\s*$/.test(lines[index]!)) {
        rows.push(splitRow(lines[index]!));
        index++;
      }
      blocks.push({ kind: 'table', head, rows });
      continue;
    }

    const bullet = /^([-*+]|\d+[.)])\s+/;
    if (bullet.test(line)) {
      const ordered = /^\d/.test(line.trim());
      const items: string[] = [];
      while (index < lines.length && bullet.test(lines[index]!) && /^\d/.test(lines[index]!.trim()) === ordered) {
        items.push(lines[index]!.replace(bullet, '').trim());
        index++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index]!.trim() &&
      !/^(#{1,6}\s|```|>|\s*[-*+]\s+|\s*\d+[.)]\s+|\|)/.test(lines[index]!) &&
      !/^(---|\*\*\*|___)\s*$/.test(lines[index]!)
    ) {
      paragraph.push(lines[index]!.trim());
      index++;
    }
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    else index++;
  }

  return blocks;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** Drops inline markup for formats that cannot carry it (docx runs handle their own). */
export function stripInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function inlineHtml(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2" />')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
}

export function markdownToHtml(markdown: string): string {
  const blocks = parseBlocks(markdown);
  return blocks
    .map((block) => {
      switch (block.kind) {
        case 'heading':
          return `<h${block.level}>${inlineHtml(block.text)}</h${block.level}>`;
        case 'paragraph':
          return `<p>${inlineHtml(block.text)}</p>`;
        case 'code':
          return `<pre><code${block.lang ? ` class="language-${escapeHtml(block.lang)}"` : ''}>${escapeHtml(block.text)}</code></pre>`;
        case 'list': {
          const tag = block.ordered ? 'ol' : 'ul';
          return `<${tag}>${block.items.map((item) => `<li>${inlineHtml(item)}</li>`).join('')}</${tag}>`;
        }
        case 'quote':
          return `<blockquote>${block.text
            .split('\n')
            .map((line) => `<p>${inlineHtml(line)}</p>`)
            .join('')}</blockquote>`;
        case 'rule':
          return '<hr />';
        case 'table':
          return [
            '<table><thead><tr>',
            ...block.head.map((cell) => `<th>${inlineHtml(cell)}</th>`),
            '</tr></thead><tbody>',
            ...block.rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineHtml(cell)}</td>`).join('')}</tr>`),
            '</tbody></table>',
          ].join('');
        default:
          return '';
      }
    })
    .join('\n');
}

/** A styled, print-ready page: open it, hit print, get a PDF. */
export function htmlDocument(title: string, markdown: string, meta: { subtitle?: string; author?: string } = {}): string {
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0 auto; max-width: 760px; padding: 56px 28px 96px; color: #191920; background: #ffffff;
    font: 16px/1.65 'Iowan Old Style', 'Palatino Linotype', Georgia, serif; }
  header { border-bottom: 2px solid #191920; padding-bottom: 14px; margin-bottom: 30px; }
  h1.doc { font: 600 30px/1.2 'Helvetica Neue', Arial, sans-serif; letter-spacing: -0.02em; margin: 0 0 6px; }
  .meta { font: 12px/1.4 ui-monospace, Menlo, monospace; color: #6b6b78; display: flex; gap: 14px; flex-wrap: wrap; }
  h1, h2, h3, h4 { font-family: 'Helvetica Neue', Arial, sans-serif; line-height: 1.25; letter-spacing: -0.01em; }
  h1 { font-size: 26px; margin: 34px 0 10px; } h2 { font-size: 21px; margin: 30px 0 8px; }
  h3 { font-size: 17px; margin: 24px 0 6px; } h4, h5, h6 { font-size: 15px; margin: 20px 0 6px; }
  p { margin: 0 0 12px; }
  a { color: #8a5a00; }
  code { font: 13px/1.5 ui-monospace, Menlo, monospace; background: #f2f1ee; padding: 1px 4px; border-radius: 4px; }
  pre { background: #f7f6f3; border: 1px solid #e4e2dc; border-radius: 8px; padding: 14px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 16px 0; padding: 2px 16px; border-left: 3px solid #cfcdc6; color: #4d4d57; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 14px; }
  th, td { border-bottom: 1px solid #e4e2dc; padding: 8px 10px; text-align: left; }
  th { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
  img { max-width: 100%; height: auto; border-radius: 6px; }
  hr { border: 0; border-top: 1px solid #e4e2dc; margin: 26px 0; }
  @media print {
    body { padding: 0; max-width: none; font-size: 11.5pt; }
    a { color: inherit; text-decoration: none; }
    pre, table, blockquote { break-inside: avoid; }
    h1, h2, h3 { break-after: avoid; }
  }
</style></head><body>
<header>
  <h1 class="doc">${escapeHtml(title)}</h1>
  <div class="meta"><span>${escapeHtml(date)}</span>${meta.subtitle ? `<span>${escapeHtml(meta.subtitle)}</span>` : ''}${meta.author ? `<span>${escapeHtml(meta.author)}</span>` : ''}</div>
</header>
<main>${markdownToHtml(markdown)}</main>
</body></html>`;
}
