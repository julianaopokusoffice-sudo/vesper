import { useState } from 'react';
import { Check, Download, FileText, Loader2 } from 'lucide-react';
import { downloadBlob } from '../../lib/download';

const PREFIX = 'vesper://artifact/';

export function isArtifactHref(href: string | undefined): boolean {
  return Boolean(href?.startsWith(PREFIX));
}

/**
 * `vesper://artifact/<name>` is how a document arrives from the server without
 * the server needing to know its own public origin. Over the mesh, the phone
 * resolves the same relative path through the laptop it is paired with.
 */
export function ArtifactLink({ href, children }: { href: string; children: React.ReactNode }) {
  const name = decodeURIComponent(href.slice(PREFIX.length));
  const url = `/api/artifacts/${encodeURIComponent(name)}`;
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');
  const ext = name.split('.').pop()?.toUpperCase() ?? 'FILE';

  const save = async () => {
    setState('busy');
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(String(response.status));
      downloadBlob(await response.blob(), name);
      setState('done');
    } catch {
      setState('failed');
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    setTimeout(() => setState('idle'), 1800);
  };

  return (
    <button
      type="button"
      onClick={() => void save()}
      className="not-prose my-2 flex w-full max-w-[420px] items-center gap-2.5 rounded-xl border border-line bg-ink-950/50 px-3 py-2 text-left transition-colors hover:border-accent/40 hover:bg-ink-950"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line-soft bg-white/[0.03] text-accent/90">
        <FileText size={14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] text-fg-2">{children}</span>
        <span className="font-mono text-[9.5px] uppercase tracking-wider text-faint">{ext} · download</span>
      </span>
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-faint">
        {state === 'busy' ? (
          <Loader2 size={13} className="animate-spin text-accent" />
        ) : state === 'done' ? (
          <Check size={13} className="text-ok" />
        ) : (
          <Download size={13} />
        )}
      </span>
    </button>
  );
}
