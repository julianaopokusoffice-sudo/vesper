import { useState } from 'react';
import { AlertTriangle, ChevronDown, Download, Loader2, ShieldCheck, Terminal } from 'lucide-react';
import type { ToolTrace } from '@shared/types';
import { cn, Chip } from './ui';

export function TraceList({ traces, dense }: { traces: ToolTrace[]; dense?: boolean }) {
  if (!traces.length) return null;
  return (
    <div className={cn('flex flex-col gap-1.5', dense ? 'mt-2' : 'mt-3')}>
      {traces.map((trace) => (
        <TraceRow key={trace.id} trace={trace} />
      ))}
    </div>
  );
}

function TraceRow({ trace }: { trace: ToolTrace }) {
  const [open, setOpen] = useState(false);
  const running = trace.ok === undefined;
  const failed = trace.ok === false;
  // Generated images come back as `image://<name>` — show them inline, with a
  // save control, the moment the tool returns.
  const images = trace.output ? [...trace.output.matchAll(/image:\/\/([\w.-]+)/g)].map((m) => `/api/images/${m[1]}`) : [];

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-ink-1000/40 transition-colors',
        failed ? 'border-danger/25' : running ? 'border-accent/25' : 'border-line-soft hover:border-line',
      )}
    >
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-2.5 py-[7px] text-left">
        <span className="grid h-4 w-4 shrink-0 place-items-center">
          {running ? (
            <Loader2 size={11} className="animate-spin text-accent" />
          ) : failed ? (
            <AlertTriangle size={11} className="text-danger" />
          ) : (
            <Terminal size={11} className="text-ok/80" />
          )}
        </span>
        <span className="mono text-[11px] text-fg-2">{trace.name}</span>
        <span className="rounded border border-line bg-white/[0.03] px-1 py-[1px] font-mono text-[9px] uppercase tracking-wider text-faint">
          {trace.source}
        </span>
        {trace.approval === 'granted' && (
          <Chip tone="accent">
            <ShieldCheck size={8} /> approved
          </Chip>
        )}
        {trace.approval === 'denied' && <Chip tone="danger">denied</Chip>}
        {running && <span className="mono text-[10px] text-faint">running…</span>}
        <span className="ml-auto flex items-center gap-1.5">
          {trace.ms !== undefined && <span className="mono text-[10px] text-faint">{trace.ms < 1000 ? `${trace.ms}ms` : `${(trace.ms / 1000).toFixed(1)}s`}</span>}
          <ChevronDown size={11} className={cn('text-faint transition-transform', open && 'rotate-180')} />
        </span>
      </button>

      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-line-soft px-2.5 py-2">
          {images.map((src) => (
            <figure key={src} className="group relative overflow-hidden rounded-lg border border-line-soft bg-ink-950">
              <img src={src} alt="generated" className="max-h-[220px] w-auto max-w-full object-contain" />
              <a
                href={src}
                download={src.split('/').pop() ?? 'image.png'}
                className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-md bg-ink-1000/85 px-1.5 py-1 font-mono text-[9.5px] uppercase tracking-wider text-fg-2 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Download size={10} /> save
              </a>
            </figure>
          ))}
        </div>
      )}

      {open && (
        <div className="space-y-2 border-t border-line-soft px-2.5 py-2">
          <Block label="input" value={stringify(trace.input)} />
          {trace.output !== undefined && <Block label="output" value={trace.output} tone={failed ? 'danger' : 'default'} />}
        </div>
      )}
    </div>
  );
}

function Block({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'danger' }) {
  return (
    <div>
      <span className="label">{label}</span>
      <pre
        className={cn(
          'mono mt-1 max-h-52 overflow-auto whitespace-pre-wrap rounded-md border border-line-soft bg-ink-950/60 px-2 py-1.5 text-[10.5px] leading-relaxed',
          tone === 'danger' ? 'text-danger/90' : 'text-muted',
        )}
      >
        {value}
      </pre>
    </div>
  );
}

function stringify(value: unknown): string {
  if (value === undefined) return '—';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
