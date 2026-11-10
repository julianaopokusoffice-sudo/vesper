import { useEffect, useMemo, useState } from 'react';
import { Columns2, Copy, Maximize2, Minimize2, Move3d, Sparkles, X } from 'lucide-react';
import { parseSpec, type ChartSpec, type SceneSpec } from '../../shared/visuals';
import { copyText } from '../lib/download';
import { Chart, chartIcon } from './visuals/Chart';
import { Compare } from './visuals/Compare';
import { Scene3D } from './visuals/Scene3D';
import { HtmlArtifact } from './visuals/HtmlArtifact';

const VISUAL_LANGS = new Set(['chart', 'scene', '3d', 'three', 'html', 'artifact', 'svg', 'compare']);

export function isVisualLang(lang: string | undefined): boolean {
  return Boolean(lang && VISUAL_LANGS.has(lang));
}

/**
 * The frame every visual shares: a quiet header naming what it is, a body you
 * can touch, and an expand control for when the user is actually working with
 * the thing instead of reading past it.
 */
export function Artifact({ lang, code }: { lang: string; code: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const kind = normalizeKind(lang);
  const specName = useMemo(() => specTitle(kind, code), [kind, code]);
  const title = specName ?? defaultTitle(kind);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [expanded]);

  const body = expanded ? (
    <div className="px-3 py-5 text-center font-mono text-[10px] uppercase tracking-wider text-faint">
      open in the expanded view
    </div>
  ) : (
    renderVisual(kind, code)
  );

  return (
    <>
      <figure className="my-3 overflow-hidden rounded-xl border border-line-soft bg-ink-950/40">
        <figcaption className="flex items-center gap-2 border-b border-line-soft px-2.5 py-1.5">
          <span className="grid h-5 w-5 place-items-center rounded-md border border-line-soft bg-white/[0.03] text-accent/90">
            {icon(kind, code)}
          </span>
          <span className="min-w-0 truncate text-[12px] text-fg-2">{title}</span>
          <span className="rounded border border-line bg-white/[0.02] px-1 py-[1px] font-mono text-[8.5px] uppercase tracking-wider text-faint">
            {label(kind)}
          </span>
          {kind === 'chart' || kind === 'scene' ? (
            <span className="hidden items-center gap-1 rounded border border-accent/20 bg-accent-wash px-1 py-[1px] font-mono text-[8.5px] uppercase tracking-wider text-accent sm:flex">
              <Sparkles size={8} /> interactive
            </span>
          ) : null}
          <span className="ml-auto flex items-center gap-0.5">
            <button
              onClick={() => {
                copyText(code);
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              }}
              title="Copy the source"
              className="rounded px-1.5 py-1 text-faint transition-colors hover:bg-white/5 hover:text-fg-2"
            >
              {copied ? <span className="font-mono text-[9px] uppercase tracking-wider text-ok">copied</span> : <Copy size={11} />}
            </button>
            <button
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? 'Close' : 'Expand'}
              className="rounded px-1.5 py-1 text-faint transition-colors hover:bg-white/5 hover:text-fg-2"
            >
              {expanded ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
            </button>
          </span>
        </figcaption>
        {body}
      </figure>

      {expanded ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-ink-1000/85 p-3 backdrop-blur-sm sm:p-6"
          onClick={() => setExpanded(false)}
        >
          <div
            className="w-full max-w-[1180px] overflow-hidden rounded-2xl border border-line bg-ink-950 shadow-[var(--shadow-panel)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-line-soft px-3 py-2">
              <span className="text-accent/90">{icon(kind, code)}</span>
              <span className="truncate text-[13px] text-fg">{title}</span>
              <button onClick={() => setExpanded(false)} className="ml-auto rounded-md p-1 text-faint hover:bg-white/5 hover:text-fg-2">
                <X size={14} />
              </button>
            </div>
            {renderVisual(kind, code)}
          </div>
        </div>
      ) : null}
    </>
  );
}

type Kind = 'chart' | 'scene' | 'html' | 'svg' | 'compare';

function normalizeKind(lang: string): Kind {
  if (lang === 'chart') return 'chart';
  if (lang === 'compare') return 'compare';
  if (lang === 'scene' || lang === '3d' || lang === 'three') return 'scene';
  if (lang === 'svg') return 'svg';
  return 'html';
}

function renderVisual(kind: Kind, code: string) {
  if (kind === 'chart') return <Chart code={code} />;
  if (kind === 'scene') return <Scene3D code={code} />;
  if (kind === 'compare') return <Compare code={code} />;
  return <HtmlArtifact code={code} kind={kind} title={defaultTitle(kind)} />;
}

function defaultTitle(kind: Kind): string {
  if (kind === 'chart') return 'Chart';
  if (kind === 'compare') return 'Comparison';
  if (kind === 'scene') return '3D scene';
  if (kind === 'svg') return 'Drawing';
  return 'Interactive page';
}

function label(kind: Kind) {
  if (kind === 'chart') return 'chart';
  if (kind === 'compare') return 'compare';
  if (kind === 'scene') return '3d scene';
  if (kind === 'svg') return 'svg';
  return 'html';
}

function icon(kind: Kind, code: string) {
  if (kind === 'chart') {
    const parsed = safeParse<ChartSpec>(code);
    return chartIcon(parsed?.type);
  }
  if (kind === 'scene') return <Move3d size={12} />;
  if (kind === 'compare') return <Columns2 size={12} />;
  return <Sparkles size={12} />;
}

function specTitle(kind: Kind, code: string): string | undefined {
  if (kind !== 'chart' && kind !== 'scene' && kind !== 'compare') return undefined;
  const parsed = safeParse<ChartSpec | SceneSpec>(code);
  return typeof parsed?.title === 'string' && parsed.title.trim() ? parsed.title.trim() : undefined;
}

function safeParse<T>(code: string): T | undefined {
  try {
    return JSON.parse(code) as T;
  } catch {
    const result = parseSpec<T>(code);
    return result.spec;
  }
}
