import { randomUUID } from 'node:crypto';
import { store } from '../kernel/store.ts';
import { paperByDoi } from './papers.ts';
import type { LibraryEntry, LibraryStatus, PaperHit } from '../../shared/types.ts';

/**
 * One place where a library row is built, whether it comes from the API form,
 * the agent's `library_save` tool, or a DOI import. Deduplication is by DOI and
 * then by normalised title: saving the same paper twice updates the note and
 * tags instead of creating a second card.
 */

const STATUSES: LibraryStatus[] = ['inbox', 'reading', 'read'];

export interface LibraryInput {
  title?: string;
  authors?: string[] | string;
  year?: number | string;
  venue?: string;
  doi?: string;
  url?: string;
  pdf?: string;
  abstract?: string;
  tags?: string[] | string;
  note?: string;
  status?: string;
  source?: string;
  citations?: number;
}

export async function saveLibraryEntry(input: LibraryInput): Promise<{ entry: LibraryEntry; created: boolean }> {
  const db = store();
  const doi = typeof input.doi === 'string' ? input.doi.trim().replace(/^https?:\/\/doi\.org\//i, '') : '';
  let seed: PaperHit | null = null;
  if (doi && !input.title) {
    seed = await paperByDoi(doi);
  }

  const title = String(input.title ?? seed?.title ?? '').trim();
  if (!title) throw new Error('A library entry needs a title.');

  const existing = db.findLibraryDuplicate({ doi: doi || seed?.doi, title });
  const now = Date.now();
  const entry: LibraryEntry = {
    id: existing?.id ?? randomUUID(),
    title,
    authors: toStringArray(input.authors) ?? seed?.authors ?? existing?.authors ?? [],
    year: toNumber(input.year) ?? seed?.year ?? existing?.year,
    venue: toText(input.venue) ?? seed?.venue ?? existing?.venue,
    doi: doi || seed?.doi || existing?.doi,
    url: toText(input.url) ?? seed?.url ?? existing?.url,
    pdf: toText(input.pdf) ?? seed?.pdf ?? existing?.pdf,
    abstract: toText(input.abstract) ?? seed?.abstract ?? existing?.abstract,
    tags: unique([...(existing?.tags ?? []), ...(toStringArray(input.tags) ?? [])]),
    note: toText(input.note) ?? existing?.note ?? '',
    status: (STATUSES.includes(input.status as LibraryStatus) ? input.status : existing?.status ?? 'inbox') as LibraryStatus,
    source: toText(input.source) ?? seed?.source ?? existing?.source ?? 'manual',
    citations: toNumber(input.citations) ?? seed?.citations ?? existing?.citations,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  db.saveLibraryEntry(entry);
  return { entry, created: !existing };
}

export function patchLibraryEntry(id: string, patch: LibraryInput): LibraryEntry {
  const db = store();
  const current = db.getLibraryEntry(id);
  if (!current) throw new Error('No such library entry');
  const next: LibraryEntry = {
    ...current,
    title: toText(patch.title) ?? current.title,
    authors: toStringArray(patch.authors) ?? current.authors,
    year: toNumber(patch.year) ?? current.year,
    venue: toText(patch.venue) ?? current.venue,
    doi: toText(patch.doi) ?? current.doi,
    url: toText(patch.url) ?? current.url,
    pdf: toText(patch.pdf) ?? current.pdf,
    abstract: toText(patch.abstract) ?? current.abstract,
    tags: toStringArray(patch.tags) ?? current.tags,
    note: patch.note !== undefined ? String(patch.note) : current.note,
    status: (STATUSES.includes(patch.status as LibraryStatus) ? patch.status : current.status) as LibraryStatus,
    updatedAt: Date.now(),
  };
  return db.saveLibraryEntry(next);
}

function toText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function toStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const list = value.map((entry) => String(entry).trim()).filter(Boolean);
    return list.length ? list : undefined;
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/[;,]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
