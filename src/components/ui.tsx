import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import clsx from 'clsx';
import { Check, X } from 'lucide-react';
import type { Agent } from '@shared/types';
import { useStore } from '@/lib/store';

export const cn = clsx;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'subtle' | 'ghost' | 'danger' | 'outline';
  size?: 'xs' | 'sm' | 'md';
  children?: ReactNode;
};

export function Button({ variant = 'subtle', size = 'md', className, children, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex select-none items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-40',
        size === 'xs' && 'h-7 px-2 text-[11px]',
        size === 'sm' && 'h-8 px-2.5 text-xs',
        size === 'md' && 'h-9 px-3.5 text-[13px]',
        variant === 'primary' &&
          'bg-accent text-[oklch(0.22_0.05_78)] shadow-[0_1px_0_oklch(1_0_0/0.25)_inset,0_8px_20px_-12px_oklch(0.805_0.148_78/0.9)] hover:brightness-105 active:translate-y-px',
        variant === 'subtle' && 'border border-line bg-ink-850 text-fg-2 hover:border-line-strong hover:bg-ink-800 hover:text-fg',
        variant === 'outline' && 'border border-line bg-transparent text-fg-2 hover:border-line-strong hover:text-fg',
        variant === 'ghost' && 'border border-transparent text-muted hover:bg-white/[0.045] hover:text-fg',
        variant === 'danger' && 'border border-danger/30 bg-danger/10 text-danger hover:bg-danger/20',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({
  label,
  active,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <Tooltip text={label}>
      <button
        {...props}
        aria-label={label}
        className={cn(
          'grid h-8 w-8 place-items-center rounded-lg border border-transparent text-muted transition-all duration-150 hover:bg-white/[0.05] hover:text-fg',
          active && 'border-line bg-ink-850 text-fg',
          className,
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function Tooltip({ text, children, side = 'bottom' }: { text: string; children: ReactNode; side?: 'bottom' | 'top' | 'right' }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        className={cn(
          'pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-line bg-ink-900 px-2 py-1 font-mono text-[10px] tracking-wide text-fg-2 opacity-0 shadow-panel transition-opacity duration-150 group-hover/tt:opacity-100',
          side === 'bottom' && 'left-1/2 top-[calc(100%+6px)] -translate-x-1/2',
          side === 'top' && 'bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2',
          side === 'right' && 'left-[calc(100%+8px)] top-1/2 -translate-y-1/2',
        )}
      >
        {text}
      </span>
    </span>
  );
}

export function Chip({
  children,
  tone = 'neutral',
  className,
  onClick,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'ok' | 'danger' | 'cool' | 'violet';
  className?: string;
  onClick?: () => void;
}) {
  return (
    <span
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]',
        tone === 'neutral' && 'border-line bg-white/[0.03] text-muted',
        tone === 'accent' && 'border-accent/30 bg-accent/10 text-accent',
        tone === 'ok' && 'border-ok/30 bg-ok/10 text-ok',
        tone === 'danger' && 'border-danger/30 bg-danger/10 text-danger',
        tone === 'cool' && 'border-cool/30 bg-cool/10 text-cool',
        tone === 'violet' && 'border-violet/30 bg-violet/10 text-violet',
        onClick && 'cursor-pointer hover:brightness-125',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-[22px] w-[38px] shrink-0 rounded-full border transition-colors duration-200',
        checked ? 'border-accent/50 bg-accent/25' : 'border-line bg-ink-800',
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] h-[16px] w-[16px] rounded-full transition-all duration-200',
          checked ? 'left-[19px] bg-accent shadow-[0_0_10px_oklch(0.805_0.148_78/0.6)]' : 'left-[2px] bg-faint',
        )}
      />
    </button>
  );
}

export function Glyph({ agent, size = 'md', className }: { agent: Pick<Agent, 'accent' | 'glyph' | 'name'>; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const dimensions = size === 'sm' ? 'h-6 w-6 text-[10px] rounded-md' : size === 'lg' ? 'h-14 w-14 text-xl rounded-2xl' : 'h-8 w-8 text-xs rounded-lg';
  return (
    <span
      className={cn('grid shrink-0 place-items-center border font-mono font-semibold uppercase', dimensions, className)}
      style={{
        color: agent.accent,
        borderColor: `${agent.accent}55`,
        backgroundColor: `${agent.accent}14`,
        boxShadow: `inset 0 1px 0 ${agent.accent}22`,
      }}
      title={agent.name}
    >
      {agent.glyph || agent.name.slice(0, 1)}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions, meta }: { title: string; subtitle: string; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line-soft pb-4">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="font-serif text-[26px] leading-none tracking-[-0.01em] text-fg">{title}</h2>
          {meta}
        </div>
        <p className="mt-1.5 max-w-[62ch] text-[12.5px] leading-relaxed text-muted">{subtitle}</p>
      </div>
      {actions && <div className="flex items-center gap-1.5">{actions}</div>}
    </div>
  );
}

export function SectionLabel({ children, className, right }: { children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <span className="label">{children}</span>
      {right}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[12px] font-medium text-fg-2">{label}</span>
        {hint && <span className="shrink-0 font-mono text-[10px] text-faint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-line bg-ink-950/70 px-3 py-2 text-[13px] text-fg placeholder:text-faint/80 transition-colors focus:border-accent-dim focus:outline-none focus:ring-2 focus:ring-accent/15';

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-ink-900 px-1.5 py-[1px] font-mono text-[10px] text-muted shadow-[0_1px_0_oklch(1_0_0/0.06)_inset]">
      {children}
    </kbd>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-2xl',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[8vh] sm:p-6 sm:pt-[10vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <div className="fixed inset-0 bg-ink-1000/75 backdrop-blur-[3px]" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 12, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className={cn('surface relative z-10 w-full overflow-hidden rounded-2xl', width)}
          >
            <div className="flex items-start justify-between gap-4 border-b border-line-soft px-5 py-4">
              <div>
                <h2 className="font-serif text-[19px] leading-tight text-fg">{title}</h2>
                {subtitle && <p className="mt-0.5 text-[12px] text-muted">{subtitle}</p>}
              </div>
              <IconButton label="Close" onClick={onClose}>
                <X size={15} />
              </IconButton>
            </div>
            <div className="max-h-[64vh] overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex items-center justify-end gap-2 border-t border-line-soft bg-ink-950/50 px-5 py-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function ToastHost() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return createPortal(
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex flex-col items-end gap-2">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4 }}
            className={cn(
              'pointer-events-auto flex max-w-sm items-start gap-2 rounded-lg border px-3 py-2 text-[12px] shadow-panel backdrop-blur',
              toast.kind === 'error' ? 'border-danger/40 bg-danger/10 text-danger' : 'border-line bg-ink-900/95 text-fg-2',
            )}
          >
            {toast.kind === 'success' && <Check size={14} className="mt-0.5 text-ok" />}
            <span className="leading-snug">{toast.text}</span>
            <button onClick={() => dismiss(toast.id)} className="ml-1 text-faint hover:text-fg">
              <X size={12} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
