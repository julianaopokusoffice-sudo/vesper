import type { ThemeId } from '@shared/types';
import { cn } from './ui';

const THEMES: { id: ThemeId; name: string; note: string; bg: string; panel: string; accent: string }[] = [
  { id: 'dark', name: 'Ink', note: 'the original', bg: 'oklch(0.135 0.008 272)', panel: 'oklch(0.192 0.01 272)', accent: 'oklch(0.805 0.148 78)' },
  { id: 'dim', name: 'Dim', note: 'lifted surfaces', bg: 'oklch(0.19 0.008 272)', panel: 'oklch(0.245 0.01 272)', accent: 'oklch(0.805 0.148 78)' },
  { id: 'dusk', name: 'Dusk', note: 'violet hour', bg: 'oklch(0.145 0.021 303)', panel: 'oklch(0.207 0.027 303)', accent: 'oklch(0.78 0.155 322)' },
  { id: 'ember', name: 'Ember', note: 'warm charcoal', bg: 'oklch(0.14 0.014 42)', panel: 'oklch(0.2 0.019 42)', accent: 'oklch(0.79 0.16 48)' },
  { id: 'tide', name: 'Tide', note: 'deep water', bg: 'oklch(0.135 0.016 225)', panel: 'oklch(0.196 0.021 225)', accent: 'oklch(0.81 0.125 192)' },
  { id: 'moss', name: 'Moss', note: 'forest terminal', bg: 'oklch(0.14 0.014 155)', panel: 'oklch(0.2 0.019 155)', accent: 'oklch(0.81 0.145 138)' },
  { id: 'ultraviolet', name: 'Ultraviolet', note: 'after hours', bg: 'oklch(0.12 0.022 292)', panel: 'oklch(0.18 0.03 292)', accent: 'oklch(0.73 0.2 295)' },
];

export function ThemePicker({ theme, onChange }: { theme: ThemeId; onChange: (theme: ThemeId) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {THEMES.map((entry) => (
        <button
          key={entry.id}
          onClick={() => onChange(entry.id)}
          aria-pressed={theme === entry.id}
          className={cn(
            'group relative overflow-hidden rounded-lg border p-1.5 text-left transition-all',
            theme === entry.id ? 'border-accent/55 ring-1 ring-accent/20' : 'border-line-soft hover:border-line-strong',
          )}
        >
          <span
            className="flex h-9 items-end gap-1 rounded-md border border-white/[0.06] p-1.5"
            style={{ background: entry.bg }}
          >
            <span className="h-4 flex-1 rounded-sm" style={{ background: entry.panel }} />
            <span className="h-4 w-2.5 rounded-sm" style={{ background: entry.accent }} />
            <span className="h-2 w-2 rounded-full" style={{ background: entry.accent }} />
          </span>
          <span className="mt-1 flex items-baseline justify-between gap-1">
            <span className={cn('text-[10.5px]', theme === entry.id ? 'text-fg' : 'text-fg-2')}>{entry.name}</span>
            <span className="truncate font-mono text-[8px] uppercase tracking-wider text-faint">{entry.note}</span>
          </span>
          {theme === entry.id && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full" style={{ background: entry.accent }} />}
        </button>
      ))}
    </div>
  );
}
