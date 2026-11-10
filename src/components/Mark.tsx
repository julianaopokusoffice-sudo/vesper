import { cn } from './ui';

export function Mark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden>
      <defs>
        <linearGradient id="vesper-star" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(0.92 0.13 88)" />
          <stop offset="55%" stopColor="oklch(0.81 0.15 78)" />
          <stop offset="100%" stopColor="oklch(0.62 0.12 62)" />
        </linearGradient>
      </defs>
      <path
        d="M16 2.4c.42 5.9 1.9 9.06 4.62 11.1 1.96 1.47 4.6 2.06 8.98 2.5-4.38.44-7.02 1.03-8.98 2.5C17.9 20.54 16.42 23.7 16 29.6c-.42-5.9-1.9-9.06-4.62-11.1-1.96-1.47-4.6-2.06-8.98-2.5 4.38-.44 7.02-1.03 8.98-2.5C13.9 11.46 15.58 8.3 16 2.4Z"
        fill="url(#vesper-star)"
      />
      <circle cx="16" cy="16" r="1.55" fill="oklch(0.16 0.01 272)" />
      <circle cx="16" cy="16" r="5.6" stroke="oklch(0.81 0.15 78 / 0.22)" strokeWidth="0.6" fill="none" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-baseline gap-1.5', className)}>
      <span className="font-serif text-[19px] leading-none tracking-[-0.01em] text-fg">vesper</span>
      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-faint">console</span>
    </span>
  );
}
