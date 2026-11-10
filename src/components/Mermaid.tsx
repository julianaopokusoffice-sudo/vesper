import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Download } from 'lucide-react';

/**
 * Renders ```mermaid blocks as SVG. Mermaid is loaded on first use — a couple
 * hundred kilobytes the chat should not pay for unless someone actually draws.
 */
export function Mermaid({ code }: { code: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string>('');
  const key = useId();

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSvg('');
    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'strict',
          fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
          themeVariables: {
            background: '#101014',
            primaryColor: '#1b1b22',
            primaryTextColor: '#eae8e4',
            primaryBorderColor: '#5a5a66',
            lineColor: '#8a8a99',
            secondaryColor: '#2a2a33',
            tertiaryColor: '#15151a',
          },
        });
        const id = `vesper-${Math.random().toString(36).slice(2, 10)}`;
        const { svg: rendered } = await mermaid.render(id, code);
        if (!cancelled) setSvg(rendered);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not draw this diagram.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, key]);

  if (error) {
    return (
      <div className="my-3 rounded-lg border border-danger/25 bg-danger/[0.06] px-3 py-2">
        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-danger">
          <AlertTriangle size={11} /> mermaid
        </div>
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{error}</p>
        <pre className="mono mt-1.5 overflow-x-auto whitespace-pre-wrap text-[10.5px] text-faint">{code}</pre>
      </div>
    );
  }

  if (!svg) {
    return <div className="my-3 h-24 animate-pulse rounded-lg border border-line-soft bg-ink-950/50" />;
  }

  const save = () => {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `diagram-${Date.now()}.svg`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  return (
    <div className="group my-3 overflow-x-auto rounded-lg border border-line-soft bg-[#101014] px-3 py-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9.5px] uppercase tracking-wider text-faint">diagram</span>
        <button
          type="button"
          onClick={save}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[9.5px] uppercase tracking-wider text-faint opacity-0 transition-opacity hover:text-fg-2 group-hover:opacity-100"
        >
          <Download size={10} /> svg
        </button>
      </div>
      <div ref={host} className="mt-1 [&_svg]:mx-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}
