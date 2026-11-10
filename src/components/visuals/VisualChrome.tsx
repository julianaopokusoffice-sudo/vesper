import type { ReactNode } from 'react';
import { cn } from '../ui';

/** Shared chrome for the footer of a visual: label on the left, actions on the right. */
export function VisualFooter({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-t border-line-soft px-2 py-1.5">
      {note ? <span className="mr-auto font-mono text-[9.5px] uppercase tracking-wider text-faint">{note}</span> : null}
      <div className={cn('flex flex-wrap items-center gap-0.5', !note && 'ml-auto')}>{children}</div>
    </div>
  );
}

export function FooterButton({
  icon,
  label,
  title,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  title?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      className={cn(
        'flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[9.5px] uppercase tracking-wider transition-colors',
        active ? 'bg-white/[0.07] text-fg-2' : 'text-faint hover:bg-white/5 hover:text-fg-2',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

export function VisualError({ message, hint, code }: { message: string; hint?: string; code: string }) {
  return (
    <div className="px-3 py-3">
      <p className="text-[12px] text-danger">{message}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted">{hint}</p> : null}
      <pre className="mono mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-line-soft bg-ink-950/60 px-2 py-1.5 text-[10.5px] leading-relaxed text-faint">
        {code.slice(0, 1800)}
      </pre>
    </div>
  );
}
