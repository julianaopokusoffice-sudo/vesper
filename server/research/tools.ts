import { store } from '../kernel/store.ts';
import { readPaper, searchPapers } from './papers.ts';
import { saveLibraryEntry } from './library.ts';
import { formatCitations } from './citations.ts';
import type { NativeTool } from '../tools/native.ts';
import type { CitationStyle, LibraryEntry, LibraryStatus, PaperHit, PaperSource } from '../../shared/types.ts';

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const SOURCES: (PaperSource | 'all')[] = ['all', 'arxiv', 'semanticscholar', 'pubmed', 'crossref'];
const STYLES: CitationStyle[] = ['bibtex', 'apa', 'mla', 'chicago', 'ris'];
const STATUSES: LibraryStatus[] = ['inbox', 'reading', 'read'];

/**
 * Research tools. Search and read are read-only and run straight away; saving
 * to the library writes one row in the user's own local database and is
 * undoable from the Library screen, so it does not interrupt a literature pass
 * with a dialog. Nothing here touches the network of an external service on
 * the user's behalf — the sources are public and attributed.
 */
export const RESEARCH_TOOLS: NativeTool[] = [
  {
    name: 'search_papers',
    description:
      'Search the scholarly literature across arXiv, Semantic Scholar, PubMed and Crossref. Returns titles, authors, year, venue, citation counts, DOI and links. Use it for any question that turns on published work; follow up with read_paper for the papers that matter.',
    parameters: obj(
      {
        query: { type: 'string', description: 'Search terms, e.g. "retrieval augmented generation evaluation"' },
        source: {
          type: 'string',
          enum: SOURCES,
          description: 'all (default) · arxiv · semanticscholar · pubmed · crossref',
        },
        limit: { type: 'number', description: 'Results per source, default 8, max 25' },
        year_from: { type: 'number', description: 'Only papers from this year onward, when the index knows the year' },
      },
      ['query'],
    ),
    async run(args, ctx) {
      const source = String(args.source ?? 'all') as PaperSource | 'all';
      if (!SOURCES.includes(source)) throw new Error(`Unknown source "${source}". Use one of: ${SOURCES.join(', ')}`);
      const result = await searchPapers({
        query: String(args.query ?? ''),
        sources: source === 'all' ? undefined : [source],
        limit: Number(args.limit) || 8,
        yearFrom: args.year_from ? Number(args.year_from) : undefined,
      });
      if (!result.hits.length) {
        return `No papers found for "${args.query}".${result.warnings.length ? `\nWarnings: ${result.warnings.join('; ')}` : ''}`;
      }
      for (const hit of result.hits.slice(0, 12)) {
        ctx.emitEvent?.({
          type: 'source',
          agentId: ctx.agent.id,
          source: { title: `${hit.title}${hit.year ? ` (${hit.year})` : ''}`, url: hit.url, kind: 'paper' },
        });
      }
      return [
        `${result.hits.length} papers for "${args.query}" (${source}):`,
        ...result.hits.map(formatHit),
        result.warnings.length ? `\nSome sources failed: ${result.warnings.join('; ')}` : '',
        '\nUse read_paper(url) to read a PDF, and library_save to keep one. Cite only papers you actually read.',
      ]
        .filter(Boolean)
        .join('\n');
    },
  },
  {
    name: 'read_paper',
    description:
      'Download a paper PDF (or an HTML landing page) and return its extracted text, capped at 120,000 characters. Use the PDF link from search_papers when one is available.',
    parameters: obj(
      {
        url: { type: 'string', description: 'Absolute http(s) URL to a PDF or article page' },
        max_chars: { type: 'number', description: 'Optional cap, default 120000' },
      },
      ['url'],
    ),
    async run(args, ctx) {
      const url = String(args.url ?? '');
      const paper = await readPaper(url);
      const cap = Math.min(Math.max(Number(args.max_chars) || 120_000, 2_000), 200_000);
      const text = paper.text.slice(0, cap);
      ctx.emitEvent?.({
        type: 'source',
        agentId: ctx.agent.id,
        source: {
          title: paper.title || new URL(url).hostname,
          url: paper.url,
          kind: /pdf/i.test(paper.url) || paper.pages > 0 ? 'paper' : 'page',
        },
      });
      return [
        `Read ${paper.url}${paper.pages ? ` — ${paper.pages} pages` : ''} (${paper.chars.toLocaleString()} chars extracted${text.length < paper.text.length ? `, showing ${text.length.toLocaleString()}` : ''}).`,
        paper.title ? `Title: ${paper.title}` : '',
        '',
        text,
      ]
        .filter((line) => line !== undefined)
        .join('\n');
    },
  },
  {
    name: 'library_save',
    description:
      'Save a paper to the user’s research library, or update the entry that already exists (deduplicated by DOI, then title). Pass a DOI alone and the metadata is resolved from Crossref. This is the user’s personal library: it is local, visible in the Library screen, and can be deleted there.',
    parameters: obj(
      {
        title: { type: 'string', description: 'Paper title (can be omitted when a DOI is given)' },
        authors: { type: 'array', items: { type: 'string' }, description: 'Author names' },
        year: { type: 'number', description: 'Publication year' },
        venue: { type: 'string', description: 'Journal, conference or preprint server' },
        doi: { type: 'string', description: 'DOI, with or without the https://doi.org/ prefix' },
        url: { type: 'string', description: 'Landing page' },
        pdf: { type: 'string', description: 'Direct PDF link' },
        abstract: { type: 'string', description: 'Abstract' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Topic tags, e.g. ["interpretability"]' },
        note: { type: 'string', description: 'Why it matters, what to remember, what to challenge' },
        status: { type: 'string', enum: STATUSES, description: 'inbox · reading · read' },
        source: { type: 'string', description: 'Where it came from: arxiv, pubmed, semanticscholar, manual' },
      },
      ['title'],
    ),
    async run(args) {
      const { entry, created } = await saveLibraryEntry(args as Record<string, unknown>);
      return created
        ? `Saved “${entry.title}” to the library (${entry.status}) — ${entry.tags.length ? `#${entry.tags.join(' #')}` : 'no tags yet'}.`
        : `Updated “${entry.title}” in the library (${entry.status}).`;
    },
  },
  {
    name: 'library_search',
    description:
      'Search the user’s saved research library by title, author, abstract, note or tag. Returns the entry ids needed by library_cite. Use it before re-searching the web — the answer may already be on the shelf.',
    parameters: obj(
      {
        query: { type: 'string', description: 'Words to look for; leave empty to list everything' },
        status: { type: 'string', enum: STATUSES, description: 'Filter by reading status' },
        tag: { type: 'string', description: 'Filter by a single tag' },
        limit: { type: 'number', description: 'Default 20, max 50' },
      },
      [],
    ),
    async run(args) {
      const entries = store().listLibrary({
        query: stringOr(args.query),
        status: STATUSES.includes(args.status) ? args.status : undefined,
        tag: stringOr(args.tag),
        limit: Math.min(Number(args.limit) || 20, 50),
      });
      if (!entries.length) return 'The library has no matching entries.';
      return [
        `${entries.length} library ${entries.length === 1 ? 'entry' : 'entries'}:`,
        ...entries.map(
          (entry) =>
            `- id: ${entry.id}\n  ${entry.authors.slice(0, 4).join(', ')}${entry.authors.length > 4 ? ' et al.' : ''} (${entry.year ?? 'n.d.'}) — ${entry.title}\n  ${entry.venue ?? ''}${entry.doi ? ` · doi:${entry.doi}` : ''} · ${entry.status}${entry.tags.length ? ` · #${entry.tags.join(' #')}` : ''}${entry.note ? `\n  note: ${entry.note.replace(/\s+/g, ' ').slice(0, 240)}` : ''}`,
        ),
        'Cite with library_cite(ids, style) — never from memory.',
      ].join('\n');
    },
  },
  {
    name: 'library_cite',
    description:
      'Format citations for library entries in BibTeX, APA, MLA, Chicago or RIS. Pass ids from library_search/library_save, or a query to cite the best matches. Returns the exact text to paste — do not retype it.',
    parameters: obj(
      {
        ids: { type: 'array', items: { type: 'string' }, description: 'Library entry ids' },
        query: { type: 'string', description: 'Used when ids are not given: cite the best matching entries' },
        style: { type: 'string', enum: STYLES, description: 'bibtex · apa · mla · chicago · ris (default apa)' },
        limit: { type: 'number', description: 'Max entries when searching by query, default 5' },
      },
      [],
    ),
    async run(args) {
      const db = store();
      const style = (STYLES.includes(args.style) ? args.style : 'apa') as CitationStyle;
      let entries: LibraryEntry[] = [];
      if (Array.isArray(args.ids) && args.ids.length) {
        entries = args.ids
          .map((id: unknown) => db.getLibraryEntry(String(id)))
          .filter((entry: LibraryEntry | null): entry is LibraryEntry => !!entry);
        if (!entries.length) throw new Error('None of those ids exist in the library. Use library_search to get current ids.');
      } else {
        entries = db.listLibrary({ query: stringOr(args.query), limit: Math.min(Number(args.limit) || 5, 20) });
        if (!entries.length) throw new Error('No library entry matches that query. Search or save a paper first.');
      }
      return formatCitations(entries, style);
    },
  },
];

function formatHit(hit: PaperHit): string {
  const authors = hit.authors.slice(0, 4).join(', ') + (hit.authors.length > 4 ? ', et al.' : '');
  return [
    `- ${hit.title}`,
    `  ${authors || 'unknown authors'}${hit.year ? ` · ${hit.year}` : ''}${hit.venue ? ` · ${hit.venue}` : ''}${hit.citations != null ? ` · ${hit.citations} citations` : ''}`,
    `  ${hit.url}${hit.doi ? ` · doi:${hit.doi}` : ''}`,
    hit.pdf ? `  pdf: ${hit.pdf}` : '',
    hit.abstract ? `  ${hit.abstract.replace(/\s+/g, ' ').slice(0, 320)}…` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function stringOr(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

