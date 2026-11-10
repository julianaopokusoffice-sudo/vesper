import { useState } from 'react';
import { BookOpen, ChevronRight, ExternalLink, FileText } from 'lucide-react';
import type { MessageSource } from '@shared/types';
import { cn } from './ui';

/**
 * The reading list for an answer. Numbers match the [n] citations the agent
 * wrote, so a claim can be checked without scrolling the traces. Papers and
 * pages are distinguished, and every row opens the original.
 */
export function Sources({ sources, className }: { sources?: MessageSource[]; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!sources?.length) return null;

  return (
    <div className={cn('mt-3 overflow-hidden rounded-xl border border-line-soft bg-ink-950/40', className)}>
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/[0.02]"
      >
        <BookOpen size={12} className="text-accent" />
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
          sources · {sources.length}
        </span>
        <span className="hidden truncate text-[11px] text-faint sm:block">
          {sources
            .slice(0, 3)
            .map((source) => host(source.url))
            .join(' · ')}
          {sources.length > 3 ? ` +${sources.length - 3}` : ''}
        </span>
        <ChevronRight size={12} className={cn('ml-auto text-faint transition-transform', open && 'rotate-90')} />
      </button>

      {open && (
        <ol className="border-t border-line-soft">
          {sources.map((source) => (
            <li key={`${source.n}-${source.url}`} className="border-b border-line-soft last:border-b-0">
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="group flex items-start gap-2.5 px-3 py-2 transition-colors hover:bg-white/[0.03]"
              >
                <span className="mt-[1px] grid h-4 min-w-4 place-items-center rounded border border-line bg-ink-900 px-1 font-mono text-[9.5px] text-faint">
                  {source.n}
                </span>
                {source.kind === 'paper' ? (
                  <FileText size={11} className="mt-[3px] shrink-0 text-cool" />
                ) : (
                  <ExternalLink size={11} className="mt-[3px] shrink-0 text-faint" />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[12px] leading-snug text-fg-2 group-hover:text-fg">{source.title}</span>
                  <span className="block truncate font-mono text-[10px] text-faint">{host(source.url)}</span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
