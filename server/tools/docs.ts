import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from '../kernel/paths.ts';
import { htmlDocument, markdownToHtml, parseBlocks, stripInline } from './markdown.ts';

export const DOC_FORMATS = ['md', 'html', 'docx', 'csv', 'json', 'txt'] as const;
export type DocFormat = (typeof DOC_FORMATS)[number];

export interface CreatedDocument {
  name: string;
  file: string;
  bytes: number;
  format: DocFormat;
  url: string;
  marker: string;
}

const MIME: Record<DocFormat, string> = {
  md: 'text/markdown;charset=utf-8',
  html: 'text/html;charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  csv: 'text/csv;charset=utf-8',
  json: 'application/json;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
};

/**
 * Writes a document into the artifact store and returns a marker the console
 * renders as a download card. Documents are deliberately separate from the
 * agent workspace: they are deliverables, not scratch files.
 */
export async function createDocument(input: {
  title: string;
  format: DocFormat;
  content: string;
  subtitle?: string;
  author?: string;
}): Promise<CreatedDocument> {
  const dir = PATHS.artifacts;
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const title = input.title.trim() || 'Untitled document';
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'document';

  const name = uniqueName(dir, slug, input.format);
  const file = join(dir, name);
  const content = input.content ?? '';

  let bytes: Buffer;
  if (input.format === 'docx') {
    bytes = buildDocx(title, content, input);
  } else if (input.format === 'html') {
    bytes = Buffer.from(htmlDocument(title, content, { subtitle: input.subtitle, author: input.author }), 'utf8');
  } else if (input.format === 'md') {
    const body = /^#\s/.test(content.trim()) ? content.trim() : `# ${title}\n\n${content.trim()}`;
    bytes = Buffer.from(body.endsWith('\n') ? body : `${body}\n`, 'utf8');
  } else if (input.format === 'json') {
    try {
      bytes = Buffer.from(`${JSON.stringify(JSON.parse(content), null, 2)}\n`, 'utf8');
    } catch {
      bytes = Buffer.from(content, 'utf8');
    }
  } else if (input.format === 'txt') {
    const plain = parseBlocks(content)
      .map((block) => {
        switch (block.kind) {
          case 'heading':
            return `\n${stripInline(block.text).toUpperCase()}\n${'-'.repeat(Math.min(60, block.text.length + 4))}`;
          case 'paragraph':
            return stripInline(block.text);
          case 'code':
            return block.text;
          case 'list':
            return block.items
              .map((item, index) => (block.ordered ? `${index + 1}. ${stripInline(item)}` : `• ${stripInline(item)}`))
              .join('\n');
          case 'quote':
            return block.text
              .split('\n')
              .map((line) => `> ${stripInline(line)}`)
              .join('\n');
          case 'rule':
            return '—'.repeat(24);
          case 'table':
            return [block.head.join('\t'), ...block.rows.map((row) => row.join('\t'))]
              .map((line) => stripInline(line))
              .join('\n');
          default:
            return '';
        }
      })
      .join('\n\n');
    bytes = Buffer.from(`${title}\n\n${plain.trim()}\n`, 'utf8');
  } else {
    bytes = Buffer.from(content, 'utf8');
  }

  writeFileSync(file, bytes, { mode: 0o644 });

  return {
    name,
    file,
    bytes: bytes.length,
    format: input.format,
    url: `/api/artifacts/${encodeURIComponent(name)}`,
    marker: `vesper://artifact/${encodeURIComponent(name)}`,
  };
}

export function artifactMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return (MIME as Record<string, string>)[ext] ?? 'application/octet-stream';
}

export function readArtifact(name: string): { buffer: Buffer; type: string } | null {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safe || safe !== name) return null;
  const file = join(PATHS.artifacts, safe);
  if (!existsSync(file)) return null;
  return { buffer: readFileSync(file), type: artifactMime(safe) };
}

export function listArtifacts(): Array<{ name: string; bytes: number; modified: number }> {
  if (!existsSync(PATHS.artifacts)) return [];
  return readdirSync(PATHS.artifacts)
    .filter((name) => !name.startsWith('.'))
    .map((name) => {
      const info = statSync(join(PATHS.artifacts, name));
      return { name, bytes: info.size, modified: info.mtimeMs };
    })
    .sort((a, b) => b.modified - a.modified)
    .slice(0, 200);
}

function uniqueName(dir: string, slug: string, ext: string): string {
  let candidate = `${slug}.${ext}`;
  let counter = 2;
  while (existsSync(join(dir, candidate))) {
    candidate = `${slug}-${counter}.${ext}`;
    counter++;
  }
  return candidate;
}

// --- docx --------------------------------------------------------------------

const escapeXml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** Runs inside a paragraph, so inline emphasis survives the trip to Word. */
function runs(text: string): string {
  const parts: string[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) parts.push(plainRun(text.slice(cursor, start)));
    const token = match[0];
    if (token.startsWith('**')) parts.push(run(token.slice(2, -2), { bold: true }));
    else if (token.startsWith('`')) parts.push(run(token.slice(1, -1), { mono: true }));
    else parts.push(run(token.slice(1, -1), { italic: true }));
    cursor = start + token.length;
  }
  if (cursor < text.length) parts.push(plainRun(text.slice(cursor)));
  return parts.join('');
}

const plainRun = (text: string) => (text ? run(text, {}) : '');

function run(text: string, opts: { bold?: boolean; italic?: boolean; mono?: boolean }): string {
  const props = [
    opts.mono ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" />' : '',
    opts.bold ? '<w:b />' : '',
    opts.italic ? '<w:i />' : '',
  ].join('');
  const size = opts.mono ? '<w:sz w:val="19" />' : '';
  return `<w:r>${props || size ? `<w:rPr>${props}${size}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function paragraph(text: string, style?: string, extraProps = ''): string {
  const props = `${style ? `<w:pStyle w:val="${style}" />` : ''}${extraProps}`;
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${runs(text)}</w:p>`;
}

function docxBody(title: string, markdown: string, meta: { subtitle?: string; author?: string }): string {
  const blocks = parseBlocks(markdown);
  const out: string[] = [paragraph(title, 'Title')];
  if (meta.subtitle) out.push(paragraph(meta.subtitle, 'Subtitle'));
  const byline = [new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), meta.author]
    .filter(Boolean)
    .join(' · ');
  out.push(paragraph(byline, 'Meta'));

  for (const block of blocks) {
    switch (block.kind) {
      case 'heading': {
        const level = Math.min(3, Math.max(1, block.level));
        out.push(paragraph(block.text, `Heading${level}`));
        break;
      }
      case 'paragraph':
        out.push(paragraph(block.text, 'Body'));
        break;
      case 'code':
        for (const line of block.text.split('\n')) out.push(paragraph(line || ' ', 'Code'));
        break;
      case 'list':
        block.items.forEach((item, index) =>
          out.push(paragraph(`${block.ordered ? `${index + 1}.` : '•'} ${item}`, 'Body', '<w:ind w:left="360" w:hanging="180" />')),
        );
        break;
      case 'quote':
        for (const line of block.text.split('\n')) out.push(paragraph(line, 'Quote'));
        break;
      case 'rule':
        out.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="CFCCC4" /></w:pBdr></w:pPr></w:p>');
        break;
      case 'table':
        out.push(docxTable(block.head, block.rows));
        break;
      default:
        break;
    }
  }
  return out.join('');
}

function docxTable(head: string[], rows: string[][]): string {
  const cell = (text: string, header: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto" />${header ? '<w:shd w:val="clear" w:fill="F2F1EE" />' : ''}</w:tcPr>${paragraph(
      text,
      header ? 'TableHead' : 'Body',
    )}</w:tc>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct" /><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:color="D9D6CF" />`)
    .join('')}</w:tblBorders></w:tblPr><w:tblGrid>${head
    .map(() => '<w:gridCol w:w="2400" />')
    .join('')}</w:tblGrid><w:tr>${head.map((cellText) => cell(cellText, true)).join('')}</w:tr>${rows
    .map((row) => `<w:tr>${row.map((cellText) => cell(cellText, false)).join('')}</w:tr>`)
    .join('')}</w:tbl><w:p />`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia" /><w:sz w:val="23" /><w:szCs w:val="23" /></w:rPr></w:rPrDefault>
  <w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="288" w:lineRule="auto" /></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal" /></w:style>
  <w:style w:type="paragraph" w:styleId="Body"><w:name w:val="Body" /><w:basedOn w:val="Normal" /></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title" /><w:basedOn w:val="Normal" />
    <w:pPr><w:spacing w:after="80" /></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" /><w:b /><w:sz w:val="52" /></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle" /><w:basedOn w:val="Normal" />
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" /><w:color w:val="5A5A66" /><w:sz w:val="26" /></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Meta"><w:name w:val="Meta" /><w:basedOn w:val="Normal" />
    <w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" /><w:color w:val="7A7A86" /><w:sz w:val="17" /></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1" /><w:basedOn w:val="Normal" />
    <w:pPr><w:spacing w:before="360" w:after="120" /><w:outlineLvl w:val="0" /></w:pPr>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" /><w:b /><w:sz w:val="36" /></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2" /><w:basedOn w:val="Normal" />
    <w:pPr><w:spacing w:before="300" w:after="100" /><w:outlineLvl w:val="1" /></w:pPr>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" /><w:b /><w:sz w:val="28" /></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3" /><w:basedOn w:val="Normal" />
    <w:pPr><w:spacing w:before="240" w:after="80" /><w:outlineLvl w:val="2" /></w:pPr>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" /><w:b /><w:sz w:val="24" /></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="TableHead"><w:name w:val="Table Head" /><w:basedOn w:val="Normal" />
    <w:pPr><w:spacing w:after="0" /></w:pPr><w:rPr><w:b /><w:sz w:val="19" /></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code" /><w:basedOn w:val="Normal" />
    <w:pPr><w:spacing w:after="0" /><w:shd w:val="clear" w:fill="F6F5F2" /></w:pPr>
    <w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" /><w:sz w:val="19" /></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote" /><w:basedOn w:val="Normal" />
    <w:pPr><w:ind w:left="480" /><w:pBdr><w:left w:val="single" w:sz="12" w:color="CFCCC4" w:space="8" /></w:pBdr></w:pPr>
    <w:rPr><w:i /><w:color w:val="4D4D57" /></w:rPr></w:style>
</w:styles>`;

function buildDocx(title: string, markdown: string, meta: { subtitle?: string; author?: string }): Buffer {
  const created = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${docxBody(
    stripInline(title),
    markdown,
    meta,
  )}<w:sectPr><w:pgSz w:w="11906" w:h="16838" /><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" /></w:sectPr></w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="xml" ContentType="application/xml" />
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" />
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml" />
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml" />
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml" />
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml" />
</Relationships>`;

  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml" />
</Relationships>`;

  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(title)}</dc:title>
  <dc:creator>${escapeXml(meta.author ?? 'Vesper')}</dc:creator>
  <cp:lastModifiedBy>Vesper</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>
</cp:coreProperties>`;

  return storedZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rootRels, 'utf8') },
    { name: 'docProps/core.xml', data: Buffer.from(core, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(document, 'utf8') },
    { name: 'word/styles.xml', data: Buffer.from(STYLES, 'utf8') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(documentRels, 'utf8') },
  ]);
}

/** ZIP with stored (uncompressed) entries — valid for every reader, no zlib. */
function storedZip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const now = new Date();
  const time = ((now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)) & 0xffff;
  const date = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, file.data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(date, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(file.data.length, 20);
    entry.writeUInt32LE(file.data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt16LE(0, 30);
    entry.writeUInt16LE(0, 32);
    entry.writeUInt16LE(0, 34);
    entry.writeUInt16LE(0, 36);
    entry.writeUInt32LE(0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);

    offset += local.length + name.length + file.data.length;
  }

  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, ...central, end]);
}

let crcTable: Uint32Array | null = null;

function crc32(buffer: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) crc = crcTable[(crc ^ buffer[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export { markdownToHtml };
