import { BRAND_PATHS } from './brandPaths';
import { cn } from './ui';

/**
 * A service's real mark on its brand colour, so the Connectors grid reads as a
 * shelf of apps rather than a list of initials. Unknown services fall back to
 * their first letter; nothing has to be declared here to add a connector.
 */
export function BrandIcon({
  id,
  name,
  accent,
  className,
}: {
  id: string;
  name: string;
  accent: string;
  className?: string;
}) {
  const path = BRAND_PATHS[id];
  const light = luminance(accent) > 0.55;
  const ink = light ? '#101013' : '#ffffff';

  return (
    <span
      aria-hidden="true"
      className={cn('grid shrink-0 place-items-center rounded-lg', className)}
      style={{ backgroundColor: accent }}
    >
      {path ? (
        <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" style={{ fill: ink }}>
          <path d={path} />
        </svg>
      ) : (
        <span className="font-mono text-[11px] font-semibold" style={{ color: ink }}>
          {name.slice(0, 1)}
        </span>
      )}
    </span>
  );
}

/** WCAG relative luminance, enough to decide ink vs white on a brand tile. */
function luminance(hex: string): number {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return 0;
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(parseInt(clean.slice(0, 2), 16));
  const g = channel(parseInt(clean.slice(2, 4), 16));
  const b = channel(parseInt(clean.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
