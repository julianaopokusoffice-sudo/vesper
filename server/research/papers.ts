import { extractText, getDocumentProxy } from 'unpdf';
import type { PaperHit, PaperSource } from '../../shared/types.ts';

/**
 * Literature search and reading.
 *
 * Every source here is public and keyless. That is deliberate: a researcher's
 * library should work on a plane, and an agent should not fail because the user
 * has not bought a scholarly-search API. arXiv, Semantic Scholar and Crossref
 * are polite about light use; PubMed needs no key at all for esearch/esummary.
 *
 * Failures are per-source. If Semantic Scholar rate-limits, the arXiv and
 * PubMed results still come back, with a warning attached.
 */

const UA = 'Mozilla/5.0 (compatible; Vesper/1.0; research)';
const TIMEOUT_MS = 20_000;

export interface PaperSearchResult {
  hits: PaperHit[];
  warnings: string[];
}

export async function searchPapers(input: {
  query: string;
  sources?: PaperSource[];
  limit?: number;
  yearFrom?: number;
}): Promise<PaperSearchResult> {
  const query = input.query.trim();
  if (!query) throw new Error('Give the search a query.');
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 25);
  const sources = input.sources?.length
    ? input.sources
    : (['arxiv', 'semanticscholar', 'pubmed', 'crossref'] as PaperSource[]);

  const warnings: string[] = [];
  const batches = await Promise.all(
    sources.map(async (source) => {
      try {
        const hits = await searchSource(source, query, limit);
        return hits;
      } catch (err) {
        warnings.push(`${source}: ${err instanceof Error ? err.message : String(err)}`);
        return [] as PaperHit[];
      }
    }),
  );

  const merged = dedupe(batches.flat());
  const filtered = input.yearFrom ? merged.filter((hit) => !hit.year || hit.year >= input.yearFrom!) : merged;

  // Keep the requested order, but put the best-cited work first inside it.
  filtered.sort((a, b) => (b.citations ?? 0) - (a.citations ?? 0));
  return { hits: filtered.slice(0, limit * Math.min(sources.length, 2)), warnings };
}

async function searchSource(source: PaperSource, query: string, limit: number): Promise<PaperHit[]> {
  switch (source) {
    case 'arxiv':
      return searchArxiv(query, limit);
    case 'pubmed':
      return searchPubMed(query, limit);
    case 'semanticscholar':
      return searchSemanticScholar(query, limit);
    case 'crossref':
      return searchCrossref(query, limit);
    default:
      throw new Error(`Unknown source "${String(source)}"`);
  }
}

function dedupe(hits: PaperHit[]): PaperHit[] {
  const seen = new Set<string>();
  const out: PaperHit[] = [];
  for (const hit of hits) {
    const key = (hit.doi ?? '').toLowerCase() || normalizeTitle(hit.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

async function get(url: string, accept = 'application/json'): Promise<Response> {
  const response = await fetch(url, {
    headers: { 'user-agent': UA, accept },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

// --- arXiv -------------------------------------------------------------------

async function searchArxiv(query: string, limit: number): Promise<PaperHit[]> {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(
    query,
  )}&start=0&max_results=${limit}&sortBy=relevance`;
  const xml = await (await get(url, 'application/atom+xml')).text();
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  return entries.map((entry) => {
    const id = text(entry, 'id');
    const arxivId = id.replace(/^https?:\/\/arxiv\.org\/abs\//, '').replace(/v\d+$/, '');
    const pdf = entry.match(/<link[^>]+title="pdf"[^>]*href="([^"]+)"/)?.[1];
    const published = text(entry, 'published');
    const doi = text(entry, 'arxiv:doi') || undefined;
    return {
      source: 'arxiv' as const,
      id: arxivId,
      title: clean(text(entry, 'title')),
      authors: [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)].map((m) =>
        clean(m[1]!),
      ),
      year: published ? Number(published.slice(0, 4)) : undefined,
      venue: text(entry, 'arxiv:journal_ref') || 'arXiv preprint',
      abstract: clean(text(entry, 'summary')).slice(0, 1200),
      url: id || `https://arxiv.org/abs/${arxivId}`,
      pdf: pdf || `https://arxiv.org/pdf/${arxivId}`,
      doi,
    };
  });
}

// --- PubMed ------------------------------------------------------------------

async function searchPubMed(query: string, limit: number): Promise<PaperHit[]> {
  const esearch = (await (
    await get(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${limit}&term=${encodeURIComponent(
        query,
      )}`,
    )
  ).json()) as { esearchresult?: { idlist?: string[] } };
  const ids = esearch.esearchresult?.idlist ?? [];
  if (!ids.length) return [];

  const summary = (await (
    await get(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`,
    )
  ).json()) as { result?: Record<string, any> };
  const result = summary.result ?? {};
  return ids
    .map((id) => result[id])
    .filter(Boolean)
    .map((row: any) => ({
      source: 'pubmed' as const,
      id: String(row.uid),
      title: clean(String(row.title ?? '')).replace(/\.$/, ''),
      authors: (row.authors ?? []).map((a: any) => String(a.name ?? '')).filter(Boolean),
      year: Number(String(row.pubdate ?? '').slice(0, 4)) || undefined,
      venue: String(row.fulljournalname ?? row.source ?? ''),
      url: `https://pubmed.ncbi.nlm.nih.gov/${row.uid}/`,
      doi: (row.articleids ?? []).find((entry: any) => entry.idtype === 'doi')?.value,
    }));
}

// --- Semantic Scholar --------------------------------------------------------

async function searchSemanticScholar(query: string, limit: number): Promise<PaperHit[]> {
  const fields = 'title,authors,year,venue,abstract,externalIds,openAccessPdf,citationCount,url';
  const json = (await (
    await get(
      `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`,
    )
  ).json()) as { data?: any[] };
  return (json.data ?? []).map((row) => ({
    source: 'semanticscholar' as const,
    id: String(row.paperId ?? ''),
    title: clean(String(row.title ?? '')),
    authors: (row.authors ?? []).map((a: any) => String(a.name ?? '')).filter(Boolean),
    year: row.year ?? undefined,
    venue: row.venue ?? undefined,
    abstract: row.abstract ? clean(String(row.abstract)).slice(0, 1200) : undefined,
    url: String(row.url ?? ''),
    pdf: row.openAccessPdf?.url ?? undefined,
    doi: row.externalIds?.DOI ?? undefined,
    citations: row.citationCount ?? undefined,
  }));
}

// --- Crossref ----------------------------------------------------------------

const CROSSREF_FIELDS = 'DOI,title,author,issued,container-title,abstract,URL,is-referenced-by-count';

async function searchCrossref(query: string, limit: number): Promise<PaperHit[]> {
  const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(
    query,
  )}&rows=${limit}&select=${CROSSREF_FIELDS}`;
  const json = (await (await get(url)).json()) as { message?: { items?: any[] } };
  return (json.message?.items ?? []).map((row) => ({
    source: 'crossref' as const,
    id: String(row.DOI ?? ''),
    title: clean(String(row.title?.[0] ?? '')),
    authors: (row.author ?? []).map(
      (a: any) => [a.given, a.family].filter(Boolean).join(' ') || String(a.name ?? ''),
    ),
    year: row.issued?.['date-parts']?.[0]?.[0] ?? undefined,
    venue: String(row['container-title']?.[0] ?? ''),
    abstract: row.abstract ? clean(stripTags(String(row.abstract))).slice(0, 1200) : undefined,
    url: String(row.URL ?? (row.DOI ? `https://doi.org/${row.DOI}` : '')),
    doi: row.DOI ?? undefined,
    citations: row['is-referenced-by-count'] ?? undefined,
  }));
}

/** Resolve a single DOI through Crossref, for importing a citation by hand. */
export async function paperByDoi(input: string): Promise<PaperHit> {
  const doi = input.trim().replace(/^https?:\/\/doi\.org\//i, '');
  const json = (await (await get(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)).json()) as {
    message?: any;
  };
  const row = json.message;
  if (!row) throw new Error(`No Crossref record for ${doi}`);
  return {
    source: 'crossref',
    id: String(row.DOI),
    title: clean(String(row.title?.[0] ?? doi)),
    authors: (row.author ?? []).map((a: any) => [a.given, a.family].filter(Boolean).join(' ')),
    year: row.issued?.['date-parts']?.[0]?.[0] ?? undefined,
    venue: String(row['container-title']?.[0] ?? ''),
    abstract: row.abstract ? clean(stripTags(String(row.abstract))).slice(0, 2000) : undefined,
    url: `https://doi.org/${row.DOI}`,
    doi: String(row.DOI),
    citations: row['is-referenced-by-count'] ?? undefined,
  };
}

// --- reading -----------------------------------------------------------------

export interface PaperText {
  url: string;
  title?: string;
  pages: number;
  chars: number;
  text: string;
}

const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_TEXT_CHARS = 120_000;

/**
 * Download a paper and return its text. PDFs go through unpdf (a pdf.js build
 * that runs in Node without a worker); HTML landing pages are stripped. The
 * result is capped so a 300-page thesis cannot swallow the context window.
 */
export async function readPaper(input: string): Promise<PaperText> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http(s) URLs can be read.');
  if (isPrivateHost(url.hostname)) throw new Error('Refusing to fetch a private or loopback address.');

  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': UA, accept: 'application/pdf,text/html;q=0.9,*/*;q=0.5' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

  const type = (response.headers.get('content-type') ?? '').toLowerCase();
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_PDF_BYTES) throw new Error(`File is ${Math.round(declared / 1_048_576)} MB — larger than the 30 MB limit.`);

  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > MAX_PDF_BYTES) throw new Error('File is larger than the 30 MB limit.');

  const looksPdf = type.includes('pdf') || /\.pdf($|\?)/i.test(url.href) || startsWithPdfMagic(buffer);
  if (looksPdf) {
    try {
      const pdf = await getDocumentProxy(buffer);
      const { text, totalPages } = await extractText(pdf, { mergePages: true });
      const merged = normaliseWhitespace(text);
      return {
        url: response.url || url.href,
        pages: totalPages,
        chars: merged.length,
        text: merged.slice(0, MAX_TEXT_CHARS),
      };
    } catch (err) {
      throw new Error(`Could not extract text from the PDF: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const body = await new Response(buffer).text();
  const text = type.includes('html') || /<html/i.test(body) ? htmlToText(body) : body;
  const metaTitle = body.match(/<meta[^>]+name="citation_title"[^>]+content="([^"]+)"/i)?.[1] ?? body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return {
    url: response.url || url.href,
    title: metaTitle ? clean(stripTags(metaTitle)) : undefined,
    pages: 0,
    chars: text.length,
    text: text.slice(0, MAX_TEXT_CHARS),
  };
}

function startsWithPdfMagic(buffer: Uint8Array): boolean {
  return buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46; // %PDF
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0' || h === '[::1]' || h === '::1') return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h.endsWith('.internal') || h.endsWith('.local')) return true;
  return false;
}

function text(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return match ? clean(decodeEntities(match[1]!)) : '';
}

function clean(value: string): string {
  return normaliseWhitespace(decodeEntities(value.replace(/<[^>]+>/g, ' ')));
}

function normaliseWhitespace(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ');
}

export function htmlToText(html: string): string {
  return normaliseWhitespace(
    decodeEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
        .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
        .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' '),
    ),
  );
}
