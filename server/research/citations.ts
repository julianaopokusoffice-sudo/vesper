import type { CitationStyle, LibraryEntry } from '../../shared/types.ts';

/**
 * Citation formatting, deterministic and dependency-free.
 *
 * The rule for every style: never invent a field. Missing authors, venue, year
 * or DOI simply disappear instead of becoming "[n.d.]" noise, because a wrong
 * citation is worse than a sparse one. BibTeX is the exception — a few fields
 * are required to parse, so it gets placeholders the user can see and fix.
 */

const STYLES: CitationStyle[] = ['bibtex', 'apa', 'mla', 'chicago', 'ris'];

export function isCitationStyle(value: string): value is CitationStyle {
  return (STYLES as string[]).includes(value);
}

export function citationStyles(): CitationStyle[] {
  return [...STYLES];
}

export function citationKey(entry: LibraryEntry): string {
  const first = entry.authors[0] ?? 'unknown';
  const family = familyName(first)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const year = entry.year ?? 'nd';
  const word = entry.title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .find((token) => token.length > 3);
  return `${family || 'anon'}${year}${word ? word.slice(0, 12) : ''}`;
}

export function formatCitation(entry: LibraryEntry, style: CitationStyle): string {
  switch (style) {
    case 'bibtex':
      return formatBibtex(entry);
    case 'apa':
      return formatApa(entry);
    case 'mla':
      return formatMla(entry);
    case 'chicago':
      return formatChicago(entry);
    case 'ris':
      return formatRis(entry);
    default:
      return formatApa(entry);
  }
}

export function formatCitations(entries: LibraryEntry[], style: CitationStyle): string {
  const formatted = entries.map((entry) => formatCitation(entry, style));
  return style === 'ris' || style === 'bibtex' ? formatted.join('\n\n') : formatted.join('\n\n');
}

/** Plain-text export for the library screen / download button. */
export function exportLibrary(entries: LibraryEntry[], style: CitationStyle): string {
  const header = `% ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} — exported from Vesper, ${new Date()
    .toISOString()
    .slice(0, 10)} — ${style.toUpperCase()}\n\n`;
  return header + formatCitations(entries, style) + '\n';
}

function formatApa(entry: LibraryEntry): string {
  const authors = apaAuthors(entry.authors);
  const year = entry.year ? `(${entry.year}).` : '';
  const title = entry.title.replace(/\.$/, '') + '.';
  const venue = entry.venue ? `${entry.venue.replace(/\.$/, '')}.` : '';
  const link = doiOrUrl(entry, 'https://doi.org/');
  return joinSentence([authors, year, title, venue, link]);
}

function formatMla(entry: LibraryEntry): string {
  const authors = mlaAuthors(entry.authors);
  const title = `"${entry.title.replace(/^"|"$/g, '').replace(/\.$/, '')}."`;
  const venue = entry.venue ? entry.venue.replace(/\.$/, '') : '';
  const year = entry.year ? String(entry.year) : '';
  const where = [venue, year].filter(Boolean).join(', ');
  const link = entry.doi ? `https://doi.org/${entry.doi}` : entry.url ?? '';
  return joinSentence([authors, title, where ? `${where}.` : '', link]);
}

function formatChicago(entry: LibraryEntry): string {
  const authors = chicagoAuthors(entry.authors);
  const title = `"${entry.title.replace(/^"|"$/g, '').replace(/\.$/, '')}."`;
  const venue = entry.venue ? entry.venue.replace(/\.$/, '') : '';
  const year = entry.year ? String(entry.year) : 'n.d.';
  const where = venue ? `${venue} (${year}).` : `(${year}).`;
  const link = entry.doi ? `https://doi.org/${entry.doi}.` : entry.url ? `${entry.url}.` : '';
  return joinSentence([authors, title, where, link]);
}

function formatBibtex(entry: LibraryEntry): string {
  const type = entry.venue ? 'article' : 'misc';
  const fields: [string, string | undefined][] = [
    ['title', entry.title],
    ['author', entry.authors.length ? entry.authors.map(bibName).join(' and ') : 'Unknown'],
    ['year', entry.year ? String(entry.year) : undefined],
    ['journal', entry.venue],
    ['doi', entry.doi],
    ['url', entry.url],
  ];
  const body = fields
    .filter(([, value]) => value?.trim())
    .map(([key, value]) => `  ${key} = {${(value as string).replace(/[{}]/g, '')}},`)
    .join('\n');
  return `@${type}{${citationKey(entry)},\n${body}\n}`;
}

function formatRis(entry: LibraryEntry): string {
  const lines = ['TY  - JOUR'];
  if (entry.authors.length) for (const author of entry.authors) lines.push(`AU  - ${author}`);
  lines.push(`TI  - ${entry.title}`);
  if (entry.year) lines.push(`PY  - ${entry.year}`);
  if (entry.venue) lines.push(`JO  - ${entry.venue}`);
  if (entry.doi) lines.push(`DO  - ${entry.doi}`);
  if (entry.url) lines.push(`UR  - ${entry.url}`);
  if (entry.abstract) lines.push(`AB  - ${entry.abstract.replace(/\s+/g, ' ').slice(0, 2000)}`);
  lines.push('ER  - ');
  return lines.join('\n');
}

function joinSentence(parts: (string | undefined)[]): string {
  return parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([.,])/g, '$1')
    .replace(/\.\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function doiOrUrl(entry: LibraryEntry, doiPrefix: string): string {
  if (entry.doi) return `${doiPrefix}${entry.doi}`;
  return entry.url ?? '';
}

function apaAuthors(authors: string[]): string {
  if (!authors.length) return '';
  const formatted = authors.map((author) => {
    const { family, given } = splitName(author);
    if (!family) return author;
    const initials = (given ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => `${part[0]!.toUpperCase()}.`)
      .join(' ');
    return initials ? `${family}, ${initials}` : family;
  });
  if (formatted.length === 1) return `${formatted[0]}.`;
  if (formatted.length === 2) return `${formatted[0]}, & ${formatted[1]}.`;
  if (formatted.length <= 20) return `${formatted.slice(0, -1).join(', ')}, & ${formatted.at(-1)}.`;
  return `${formatted.slice(0, 19).join(', ')}, … ${formatted.at(-1)}.`;
}

function mlaAuthors(authors: string[]): string {
  if (!authors.length) return '';
  const first = authors[0]!;
  const { family, given } = splitName(first);
  const lead = given && family ? `${family}, ${given}` : first;
  if (authors.length === 1) return `${lead}.`;
  if (authors.length === 2) return `${lead}, and ${authors[1]}.`;
  return `${lead}, et al.`;
}

function chicagoAuthors(authors: string[]): string {
  if (!authors.length) return '';
  const first = authors[0]!;
  const { family, given } = splitName(first);
  const lead = given && family ? `${family}, ${given}` : first;
  if (authors.length === 1) return `${lead}.`;
  if (authors.length === 2) return `${lead}, and ${authors[1]}.`;
  return `${lead}, et al.`;
}

function splitName(name: string): { family?: string; given?: string } {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (!clean) return {};
  if (clean.includes(',')) {
    const [family, given] = clean.split(',', 2);
    return { family: family?.trim(), given: given?.trim() };
  }
  const parts = clean.split(' ');
  if (parts.length === 1) return { family: parts[0] };
  return { family: parts.at(-1), given: parts.slice(0, -1).join(' ') };
}

function familyName(name: string): string {
  return splitName(name).family ?? name;
}

function bibName(name: string): string {
  const { family, given } = splitName(name);
  if (!family) return name;
  return given ? `${family}, ${given}` : family;
}
