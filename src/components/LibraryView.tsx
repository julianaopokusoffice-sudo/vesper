import { useEffect, useMemo, useState } from 'react';
import {
  BookMarked,
  BookOpen,
  Check,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Plus,
  Quote,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { CitationStyle, LibraryEntry, LibraryStatus, PaperHit, PaperSource } from '@shared/types';
import { api, type LibraryStats } from '@/lib/api';
import { useStore } from '@/lib/store';
import { copyText } from '@/lib/download';
import { relativeTime } from '@/lib/format';
import { Button, Chip, PageHeader, cn, inputClass } from './ui';

const STATUSES: LibraryStatus[] = ['inbox', 'reading', 'read'];
const STYLES: CitationStyle[] = ['apa', 'bibtex', 'mla', 'chicago', 'ris'];
const SOURCES: (PaperSource | 'all')[] = ['all', 'arxiv', 'semanticscholar', 'pubmed', 'crossref'];
const EMPTY_STATS: LibraryStats = { total: 0, reading: 0, read: 0, inbox: 0 };

/**
 * The researcher's shelf. Literature search is keyless (arXiv, Semantic
 * Scholar, PubMed, Crossref) so the screen is useful before any API key is
 * configured; citations are generated from stored metadata, never retyped by a
 * model. Agents write here too, which is why the note field matters more than
 * the abstract: it is the part that says why the paper earned a place.
 */
export function LibraryView() {
  const toast = useStore((state) => state.toast);
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [stats, setStats] = useState<LibraryStats>(EMPTY_STATS);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<LibraryStatus | 'all'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [source, setSource] = useState<PaperSource | 'all'>('all');
  const [results, setResults] = useState<PaperHit[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [exportStyle, setExportStyle] = useState<CitationStyle>('bibtex');

  const load = async () => {
    try {
      const data = await api.library();
      setEntries(data.entries);
      setStats(data.stats);
      setSelected((current) => current && data.entries.some((entry) => entry.id === current) ? current : data.entries[0]?.id ?? null);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not load the library');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (status !== 'all' && entry.status !== status) return false;
      if (!q) return true;
      return `${entry.title} ${entry.authors.join(' ')} ${entry.venue ?? ''} ${entry.tags.join(' ')} ${entry.note} ${entry.abstract ?? ''}`
        .toLowerCase()
        .includes(q);
    });
  }, [entries, query, status]);

  const current = entries.find((entry) => entry.id === selected) ?? null;

  useEffect(() => {
    setNote(current?.note ?? '');
    setTags(current?.tags.join(', ') ?? '');
  }, [current?.id, current?.note, current?.tags]);

  const patch = async (id: string, body: Partial<LibraryEntry>) => {
    try {
      const result = await api.patchLibrary(id, body);
      setEntries((list) => list.map((entry) => (entry.id === id ? result.entry : entry)));
      setStats(result.stats);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not update the entry');
    }
  };

  const saveNote = async () => {
    if (!current || note === current.note) return;
    await patch(current.id, { note });
  };

  const saveTags = async () => {
    if (!current) return;
    const next = tags
      .split(',')
      .map((tag) => tag.trim().replace(/^#/, ''))
      .filter(Boolean);
    if (next.join('|') === current.tags.join('|')) return;
    await patch(current.id, { tags: next });
  };

  const remove = async (id: string) => {
    if (!window.confirm('Remove this entry from the library?')) return;
    try {
      const result = await api.deleteLibrary(id);
      setEntries((list) => list.filter((entry) => entry.id !== id));
      setStats(result.stats);
      setSelected(null);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not delete the entry');
    }
  };

  const cite = async (entry: LibraryEntry, style: CitationStyle) => {
    try {
      const result = await api.citeLibrary(entry.id, style);
      copyText(result.citation);
      toast('success', `${style.toUpperCase()} citation copied`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not format the citation');
    }
  };

  const runSearch = async () => {
    const text = searchQuery.trim();
    if (!text) return;
    setSearching(true);
    setWarnings([]);
    try {
      const found = await api.searchPapers({ query: text, source, limit: 8 });
      setResults(found.hits);
      setWarnings(found.warnings);
      if (!found.hits.length) toast('info', 'No papers matched that query.');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const saveHit = async (hit: PaperHit) => {
    setSavingId(hit.id);
    try {
      const result = await api.saveLibrary({
        title: hit.title,
        authors: hit.authors,
        year: hit.year,
        venue: hit.venue,
        doi: hit.doi,
        url: hit.url,
        pdf: hit.pdf,
        abstract: hit.abstract,
        source: hit.source,
        citations: hit.citations,
      });
      await load();
      setStats(result.stats);
      setSelected(result.entry.id);
      toast('success', result.created ? 'Saved to the library' : 'Already in the library — entry updated');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not save the paper');
    } finally {
      setSavingId(null);
    }
  };

  const exportLibrary = () => {
    const link = document.createElement('a');
    link.href = api.libraryExportUrl(exportStyle);
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast('success', `Exported as ${exportStyle.toUpperCase()}`);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 py-5 sm:px-8">
        <PageHeader
          title="Library"
          meta={<Chip tone={stats.total ? 'accent' : 'neutral'}>{stats.total}</Chip>}
          subtitle="Papers you kept, with the note that says why. Search arXiv, PubMed, Semantic Scholar and Crossref without a key; citations are generated from stored metadata so they never drift."
          actions={
            <>
              <div className="flex items-center gap-1 rounded-lg border border-line bg-ink-950/60 p-0.5">
                <select
                  value={exportStyle}
                  onChange={(event) => setExportStyle(event.target.value as CitationStyle)}
                  className="bg-transparent px-1.5 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-2 outline-none"
                  aria-label="Citation style"
                >
                  {STYLES.map((style) => (
                    <option key={style} value={style} className="bg-ink-900">
                      {style}
                    </option>
                  ))}
                </select>
                <Button variant="ghost" size="xs" onClick={exportLibrary} disabled={!entries.length}>
                  <Download size={11} /> export
                </Button>
              </div>
              <Button variant="primary" size="sm" onClick={() => setSearchOpen((open) => !open)}>
                {searchOpen ? <X size={12} /> : <Search size={12} />}
                {searchOpen ? 'Close' : 'Find papers'}
              </Button>
            </>
          }
        />

        {searchOpen && (
          <div className="mt-4 rounded-xl border border-line bg-ink-950/50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="focus-ring flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-line bg-ink-1000/60 px-2.5 py-1.5">
                <Search size={13} className="text-faint" />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && void runSearch()}
                  placeholder="retrieval augmented generation evaluation"
                  autoFocus
                  className="w-full bg-transparent text-[12.5px] text-fg outline-none placeholder:text-faint/75"
                />
              </div>
              <select
                value={source}
                onChange={(event) => setSource(event.target.value as PaperSource | 'all')}
                className="rounded-lg border border-line bg-ink-950/70 px-2 py-1.5 font-mono text-[10.5px] uppercase tracking-wider text-fg-2 outline-none"
                aria-label="Paper source"
              >
                {SOURCES.map((value) => (
                  <option key={value} value={value} className="bg-ink-900">
                    {value}
                  </option>
                ))}
              </select>
              <Button variant="subtle" size="sm" onClick={runSearch} disabled={searching || !searchQuery.trim()}>
                {searching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} Search
              </Button>
            </div>

            {warnings.length > 0 && (
              <p className="mt-2 font-mono text-[10px] leading-relaxed text-accent/80">
                {warnings.join(' · ')}
              </p>
            )}

            {results.length > 0 && (
              <ul className="mt-3 max-h-[300px] divide-y divide-line-soft overflow-y-auto rounded-lg border border-line-soft">
                {results.map((hit) => (
                  <li key={`${hit.source}-${hit.id}`} className="flex items-start gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] leading-snug text-fg">{hit.title}</p>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-faint">
                        {hit.authors.slice(0, 3).join(', ')}
                        {hit.authors.length > 3 ? ' et al.' : ''} · {hit.year ?? 'n.d.'}
                        {hit.venue ? ` · ${hit.venue}` : ''} · {hit.source}
                        {hit.citations != null ? ` · ${hit.citations} cited` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <a
                        href={hit.pdf ?? hit.url}
                        target="_blank"
                        rel="noreferrer"
                        className="grid h-7 w-7 place-items-center rounded-md text-faint hover:bg-white/5 hover:text-fg"
                        title="Open"
                      >
                        <ExternalLink size={12} />
                      </a>
                      <Button variant="outline" size="xs" onClick={() => void saveHit(hit)} disabled={savingId === hit.id}>
                        {savingId === hit.id ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />} save
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-4 grid grid-cols-4 gap-2">
          <Stat label="papers" value={stats.total} />
          <Stat label="inbox" value={stats.inbox} />
          <Stat label="reading" value={stats.reading} />
          <Stat label="read" value={stats.read} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="focus-ring flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-line bg-ink-1000/40 px-2.5 py-1.5">
            <Search size={13} className="text-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by title, author, tag or note"
              className="w-full bg-transparent text-[12px] outline-none placeholder:text-faint/80"
            />
          </div>
          <div className="flex items-center gap-1">
            <FilterChip active={status === 'all'} onClick={() => setStatus('all')}>
              all
            </FilterChip>
            {STATUSES.map((value) => (
              <FilterChip key={value} active={status === value} onClick={() => setStatus(value)}>
                {value}
              </FilterChip>
            ))}
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 border-t border-line-soft md:grid-cols-[320px_1fr]">
        <div className="max-h-[260px] overflow-y-auto border-b border-line-soft md:max-h-none md:border-b-0 md:border-r">
          {loading ? (
            <div className="flex items-center gap-2 px-4 py-8 font-mono text-[10.5px] uppercase tracking-wider text-faint">
              <Loader2 size={12} className="animate-spin" /> loading shelf
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <BookMarked size={22} className="mx-auto text-faint" />
              <p className="mt-3 font-serif text-[18px] text-fg">{entries.length ? 'Nothing matches' : 'Your shelf is empty'}</p>
              <p className="mx-auto mt-1 max-w-[34ch] text-[11.5px] leading-relaxed text-muted">
                {entries.length
                  ? 'Clear the filter or switch status.'
                  : 'Search the literature, or ask an agent for a reading list — it saves the papers it reads.'}
              </p>
              <Button variant="subtle" size="sm" className="mt-3" onClick={() => setSearchOpen(true)}>
                <Search size={11} /> Find papers
              </Button>
            </div>
          ) : (
            <ul className="p-1.5">
              {filtered.map((entry) => (
                <li key={entry.id}>
                  <button
                    onClick={() => setSelected(entry.id)}
                    className={cn(
                      'w-full rounded-lg px-2.5 py-2 text-left transition-colors',
                      entry.id === selected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]',
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={cn('h-[5px] w-[5px] shrink-0 rounded-full', dot(entry.status))} />
                      <span className="truncate font-mono text-[9.5px] uppercase tracking-[0.08em] text-faint">
                        {entry.year ?? 'n.d.'} · {entry.venue ?? entry.source}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-fg">{entry.title}</p>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-faint">
                      {entry.authors[0] ?? 'unknown'}
                      {entry.authors.length > 1 ? ' et al.' : ''}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto">
          {!current ? (
            <div className="grid h-full min-h-[240px] place-items-center px-6 text-center">
              <div>
                <BookOpen size={24} className="mx-auto text-faint" />
                <p className="mt-3 font-serif text-[20px] text-fg">Pick a paper</p>
                <p className="mx-auto mt-1 max-w-[38ch] text-[12px] leading-relaxed text-muted">
                  Notes, status, tags and citations live here. The abstract stays as it was published.
                </p>
              </div>
            </div>
          ) : (
            <article className="px-5 py-5 sm:px-7">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-serif text-[23px] leading-[1.2] text-fg">{current.title}</h3>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
                    {current.authors.join(', ') || 'Unknown authors'}
                    {current.year ? ` · ${current.year}` : ''}
                    {current.venue ? ` · ${current.venue}` : ''}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {current.tags.map((tag) => (
                      <Chip key={tag} tone="cool">
                        #{tag}
                      </Chip>
                    ))}
                    {current.doi && (
                      <a
                        href={`https://doi.org/${current.doi}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[10px] text-faint underline-offset-2 hover:text-fg-2 hover:underline"
                      >
                        doi:{current.doi}
                      </a>
                    )}
                    {current.citations != null && <Chip tone="neutral">{current.citations} cited</Chip>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {(current.pdf || current.url) && (
                    <a
                      href={current.pdf ?? current.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[11.5px] text-fg-2 hover:border-line-strong hover:text-fg"
                    >
                      <FileText size={12} /> read
                    </a>
                  )}
                  <Button variant="danger" size="sm" onClick={() => void remove(current.id)}>
                    <Trash2 size={12} />
                  </Button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="label">status</span>
                <div className="flex items-center gap-1">
                  {STATUSES.map((value) => (
                    <FilterChip key={value} active={current.status === value} onClick={() => void patch(current.id, { status: value })}>
                      {value}
                    </FilterChip>
                  ))}
                </div>
                <span className="ml-auto font-mono text-[10px] text-faint">updated {relativeTime(current.updatedAt)}</span>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_240px]">
                <div>
                  <label className="label">my note</label>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    onBlur={() => void saveNote()}
                    rows={5}
                    placeholder="Why this matters, what to check, what it gets wrong…"
                    className={cn(inputClass, 'mt-1.5 resize-y text-[12.5px] leading-relaxed')}
                  />
                  <label className="label mt-4 block">tags</label>
                  <input
                    value={tags}
                    onChange={(event) => setTags(event.target.value)}
                    onBlur={() => void saveTags()}
                    placeholder="interpretability, evaluation, methods"
                    className={cn(inputClass, 'mt-1.5 text-[12.5px]')}
                  />
                </div>

                <div className="rounded-xl border border-line-soft bg-ink-950/40 p-3">
                  <div className="flex items-center gap-1.5">
                    <Quote size={12} className="text-accent" />
                    <span className="label">cite</span>
                  </div>
                  <div className="mt-2 grid gap-1">
                    {STYLES.map((style) => (
                      <button
                        key={style}
                        onClick={() => void cite(current, style)}
                        className="flex items-center justify-between rounded-md px-2 py-1 font-mono text-[10.5px] uppercase tracking-wider text-fg-2 hover:bg-white/5 hover:text-fg"
                      >
                        {style}
                        <Check size={10} className="text-faint" />
                      </button>
                    ))}
                  </div>
                  {current.abstract && (
                    <details className="mt-3 border-t border-line-soft pt-2">
                      <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wider text-faint">
                        abstract
                      </summary>
                      <p className="mt-1.5 max-h-[220px] overflow-y-auto text-[11.5px] leading-relaxed text-muted">
                        {current.abstract}
                      </p>
                    </details>
                  )}
                </div>
              </div>
            </article>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line-soft bg-ink-950/30 px-3 py-2">
      <p className="font-mono text-[9.5px] uppercase tracking-[0.09em] text-faint">{label}</p>
      <p className="mt-0.5 font-serif text-[20px] leading-none text-fg">{value}</p>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-md border px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.08em] transition-colors',
        active ? 'border-accent/35 bg-accent/10 text-accent' : 'border-line bg-transparent text-muted hover:text-fg-2',
      )}
    >
      {children}
    </button>
  );
}

function dot(status: LibraryStatus): string {
  return status === 'read' ? 'bg-ok' : status === 'reading' ? 'bg-accent' : 'bg-faint';
}
