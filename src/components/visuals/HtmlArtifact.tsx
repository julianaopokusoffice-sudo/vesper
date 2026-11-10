import { useEffect, useMemo, useRef, useState } from 'react';
import { Code2, Download, ExternalLink, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { copyText, downloadText, safeFilename, wrapHtmlDocument } from '../../lib/download';
import { cn } from '../ui';
import { VisualFooter, FooterButton } from './VisualChrome';

/**
 * Live HTML/SVG rendering. `sandbox="allow-scripts"` without
 * `allow-same-origin` means the frame cannot touch the console's storage,
 * cookies or DOM — which is the only way running model-written markup is safe.
 * Exported files are plain HTML: openable anywhere, no Vesper needed.
 */
export function HtmlArtifact({ code, kind, title }: { code: string; kind: 'html' | 'svg' | 'artifact'; title?: string }) {
  const [view, setView] = useState<'preview' | 'code'>('preview');
  const [height, setHeight] = useState(300);
  const [nonce, setNonce] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  const document = useMemo(() => {
    const body =
      kind === 'svg'
        ? `<div style="display:grid;place-items:center;min-height:240px">${code}</div>`
        : code;
    const wrapped = wrapHtmlDocument(body);
    const probe = `<script>
      (function () {
        var last = 0;
        function send() {
          var h = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
          if (h && Math.abs(h - last) > 4) { last = h; parent.postMessage({ __vesper: 'artifact-height', height: h }, '*'); }
        }
        window.addEventListener('load', send);
        window.addEventListener('resize', send);
        if (window.ResizeObserver) new ResizeObserver(send).observe(document.documentElement);
        setTimeout(send, 60); setTimeout(send, 320);
      })();
    </script>`;
    return /<\/body>/i.test(wrapped) ? wrapped.replace(/<\/body>/i, `${probe}</body>`) : wrapped + probe;
  }, [code, kind]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const payload = event.data as { __vesper?: string; height?: number } | undefined;
      if (payload?.__vesper === 'artifact-height' && typeof payload.height === 'number') {
        setHeight(Math.max(120, Math.min(expanded ? 1600 : 720, Math.round(payload.height))));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [expanded]);

  const filename = safeFilename(title, kind === 'svg' ? 'drawing' : 'artifact', kind === 'svg' ? 'svg' : 'html');
  const htmlOut = kind === 'svg' ? code : document;
  const open = () => {
    const blob = new Blob([htmlOut], { type: kind === 'svg' ? 'image/svg+xml' : 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  if (view === 'code') {
    return (
      <div>
        <pre className="mono max-h-[420px] overflow-auto whitespace-pre-wrap border-b border-line-soft bg-ink-1000/50 px-3 py-2.5 text-[11px] leading-relaxed text-muted">
          {code}
        </pre>
        <VisualFooter note={`${kind} source`}>
          <FooterButton icon={<Download size={11} />} label={kind === 'svg' ? 'svg' : 'html'} onClick={() => downloadText(htmlOut, filename, kind === 'svg' ? 'image/svg+xml' : 'text/html')} />
          <FooterButton icon={<Code2 size={11} />} label="preview" active={false} onClick={() => setView('preview')} />
        </VisualFooter>
      </div>
    );
  }

  return (
    <div>
      <div className={cn('relative bg-ink-1000', expanded && 'h-[70vh]')} style={expanded ? undefined : { height }}>
        <iframe
          key={nonce}
          ref={frame}
          title={title ?? 'Artifact'}
          sandbox="allow-scripts allow-modals allow-popups"
          srcDoc={document}
          className="h-full w-full border-0"
          style={{ colorScheme: 'normal' }}
        />
        <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-md border border-line-soft bg-ink-1000/80 p-0.5 opacity-0 backdrop-blur transition-opacity focus-within:opacity-100 hover:opacity-100">
          <button onClick={() => setNonce((n) => n + 1)} title="Reload the preview" className="rounded px-1.5 py-1 text-faint hover:text-fg-2">
            <RefreshCw size={11} />
          </button>
          <button onClick={open} title="Open in a new tab" className="rounded px-1.5 py-1 text-faint hover:text-fg-2">
            <ExternalLink size={11} />
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Collapse' : 'Expand'}
            className="rounded px-1.5 py-1 text-faint hover:text-fg-2"
          >
            {expanded ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
          </button>
        </div>
      </div>
      <VisualFooter note={kind === 'svg' ? 'drawing · live' : 'live html · sandboxed'}>
        <FooterButton icon={<Code2 size={11} />} label="code" onClick={() => setView('code')} />
        <FooterButton icon={<Download size={11} />} label={kind === 'svg' ? 'svg' : 'html'} onClick={() => downloadText(htmlOut, filename, kind === 'svg' ? 'image/svg+xml' : 'text/html')} />
        <FooterButton icon={<ExternalLink size={11} />} label="open" onClick={open} />
      </VisualFooter>
    </div>
  );
}

/** Sanity helper used by the demo path and tests: does this look like markup? */
export function looksLikeMarkup(text: string): boolean {
  return /<\w+[\s>]/.test(text) && text.length < 400_000;
}

export function copyArtifact(code: string) {
  copyText(code);
}
