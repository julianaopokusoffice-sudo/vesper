import { useState } from 'react';
import { motion } from 'motion/react';
import { Brain, ChevronRight, RefreshCw, Sparkles } from 'lucide-react';
import type { Agent, Message as MessageType } from '@shared/types';
import { Markdown } from './Markdown';
import { Download } from 'lucide-react';
import { TraceList } from './TraceList';
import { Sources } from './Sources';
import { CopyButton } from './CodeBlock';
import { cn, Chip, Glyph, Tooltip } from './ui';
import { clockTime, formatCost, formatNumber } from '@/lib/format';
import { useStore } from '@/lib/store';

export function MessageView({
  message,
  agent,
  isLast,
}: {
  message: MessageType;
  agent?: Agent;
  isLast?: boolean;
}) {
  const regenerate = useStore((s) => s.regenerate);
  const [reasoningOpen, setReasoningOpen] = useState(false);

  if (message.role === 'user') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
        className="group flex justify-end"
      >
        <div className="flex max-w-[min(80%,44rem)] flex-col items-end gap-1">
          <div className="rounded-2xl rounded-br-md border border-line bg-ink-850/80 px-3.5 py-2.5 text-[13.5px] leading-[1.6] text-fg shadow-[0_1px_0_oklch(1_0_0/0.04)_inset] whitespace-pre-wrap">
            {message.content}
          </div>
          <div className="flex items-center gap-2 pr-1 font-mono text-[10px] text-faint/0 transition-colors group-hover:text-faint">
            <span>{clockTime(message.createdAt)}</span>
            <CopyButton text={message.content} />
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="group relative"
    >
      <div className="flex items-center gap-2">
        <Glyph agent={agent ?? { accent: '#f0b429', glyph: 'V', name: 'Vesper' }} size="sm" />
        <span className="text-[12.5px] font-medium text-fg">{agent?.name ?? 'Agent'}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-faint">{agent?.role ?? ''}</span>
        {message.lane === 'synthesis' && (
          <Chip tone="accent">
            <Sparkles size={8} /> synthesis
          </Chip>
        )}
        <span className="font-mono text-[10px] text-faint/60">{clockTime(message.createdAt)}</span>
        {message.model && (
          <span className="ml-auto hidden font-mono text-[10px] text-faint/70 md:block">{message.model}</span>
        )}
      </div>

      {message.reasoning && (
        <div className="mt-2 rounded-lg border border-line-soft bg-ink-950/40">
          <button
            onClick={() => setReasoningOpen((v) => !v)}
            className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
          >
            <Brain size={11} className="text-violet" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted">thinking</span>
            <span className="font-mono text-[10px] text-faint">{formatNumber(message.reasoning.length / 4)} tok</span>
            <ChevronRight size={11} className={cn('ml-auto text-faint transition-transform', reasoningOpen && 'rotate-90')} />
          </button>
          {reasoningOpen && (
            <p className="whitespace-pre-wrap border-t border-line-soft px-3 py-2 text-[12px] italic leading-relaxed text-muted">
              {message.reasoning}
            </p>
          )}
        </div>
      )}

      <div className="mt-1.5 pl-[34px]">
        {message.images && message.images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {message.images.map((src, index) => (
              <figure key={index} className="group relative overflow-hidden rounded-xl border border-line-soft bg-ink-950">
                <img src={src} alt={`attachment ${index + 1}`} className="max-h-[280px] w-auto max-w-full object-contain" />
                <a
                  href={src}
                  download={`vesper-${message.id.slice(0, 6)}-${index + 1}.png`}
                  className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-md bg-ink-1000/85 px-1.5 py-1 font-mono text-[9.5px] uppercase tracking-wider text-fg-2 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Download size={10} /> save
                </a>
              </figure>
            ))}
          </div>
        )}
        <Markdown>{message.content}</Markdown>
        <Sources sources={message.sources} />
        <TraceList traces={message.traces} />

        <div className="mt-2 flex items-center gap-2 font-mono text-[10px] text-faint">
          {message.usage && (
            <>
              <span title="prompt tokens">↑{formatNumber(message.usage.promptTokens)}</span>
              <span title="completion tokens">↓{formatNumber(message.usage.completionTokens)}</span>
              <span className="text-faint/50">·</span>
              <span title="approximate cost">{formatCost(message.usage.costUSD)}</span>
              {message.usage.ms ? (
                <>
                  <span className="text-faint/50">·</span>
                  <span>{(message.usage.ms / 1000).toFixed(1)}s</span>
                </>
              ) : null}
            </>
          )}
        </div>

        <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <CopyButton text={message.content} />
          {isLast && (
            <Tooltip text="Regenerate with the same agents">
              <button
                onClick={() => regenerate()}
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-faint hover:bg-white/5 hover:text-fg-2"
              >
                <RefreshCw size={11} />
                <span className="font-mono text-[9.5px] uppercase tracking-wider">retry</span>
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </motion.div>
  );
}
