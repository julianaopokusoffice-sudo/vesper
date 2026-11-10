import { useState } from 'react';
import { Check, Download, ExternalLink, ImageOff } from 'lucide-react';
import { downloadImage } from '../lib/download';

/**
 * An image in the transcript is a document, not decoration: it keeps its
 * caption, opens full size, and saves to disk with one click. Model-written
 * `image://<file>` markers resolve to the local image store automatically.
 */
export function Figure({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed' | 'missing'>('idle');
  const url = src ? (src.startsWith('image://') ? `/api/images/${src.slice('image://'.length)}` : src) : '';
  const name = alt?.trim() || title?.trim() || url.split('/').pop()?.split('?')[0] || 'image';

  if (!url) return null;

  if (state === 'missing') {
    return (
      <div className="my-3 flex items-center gap-2 rounded-lg border border-line-soft bg-ink-950/40 px-3 py-2 text-[11.5px] text-muted">
        <ImageOff size={13} className="text-faint" />
        Image unavailable — {name}
      </div>
    );
  }

  return (
    <figure className="group/fig my-3 overflow-hidden rounded-xl border border-line-soft bg-ink-950/40">
      <div className="relative">
        <a href={url} target="_blank" rel="noreferrer noopener" className="block">
          <img
            src={url}
            alt={alt ?? ''}
            title={title}
            loading="lazy"
            onError={() => setState('missing')}
            className="max-h-[460px] w-full object-contain"
          />
        </a>
        <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-md border border-line-soft bg-ink-1000/80 p-0.5 backdrop-blur transition-opacity md:opacity-0 md:group-hover/fig:opacity-100">
          <button
            onClick={async () => {
              setState('saving');
              const ok = await downloadImage(url, name);
              setState(ok ? 'saved' : 'failed');
              setTimeout(() => setState('idle'), 1600);
            }}
            title="Save this image"
            className="rounded px-1.5 py-1 text-faint transition-colors hover:text-fg-2"
          >
            {state === 'saved' ? <Check size={11} className="text-ok" /> : <Download size={11} />}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            title="Open full size"
            className="rounded px-1.5 py-1 text-faint transition-colors hover:text-fg-2"
          >
            <ExternalLink size={11} />
          </a>
        </div>
      </div>
      {alt?.trim() ? (
        <figcaption className="border-t border-line-soft px-3 py-1.5 text-[11px] leading-relaxed text-muted">{alt}</figcaption>
      ) : null}
    </figure>
  );
}
