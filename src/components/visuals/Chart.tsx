import { useMemo, useRef, useState } from 'react';
import { BarChart3, Download, FileJson, Image as ImageIcon, LineChart, PieChart, Table2 } from 'lucide-react';
import {
  CHART_PALETTE,
  chartToCsv,
  formatValue,
  niceTicks,
  normalizeChart,
  parseSpec,
  type ChartSpec,
  type NormalizedChart,
} from '../../../shared/visuals';
import { downloadBlob, downloadJson, downloadText, safeFilename, serializeSvg, svgToPngBlob } from '../../lib/download';
import { cn } from '../ui';
import { FooterButton, VisualError, VisualFooter } from './VisualChrome';

const W = 900;
const AXIS = '#6d6a7c';
const LABEL = '#a5a2b4';
const TITLE = '#ecebf3';
const GRID = 'rgba(255,255,255,0.07)';
const AXIS_LINE = 'rgba(255,255,255,0.14)';

/**
 * A chart you can work with, not a picture of one: hover reads a point, the
 * legend filters series, and every state can be taken out as SVG, PNG, CSV or
 * the spec itself. This is the piece researchers asked for most — a visual you
 * can interrogate and then paste into the paper.
 */
export function Chart({ code }: { code: string }) {
  const parsed = useMemo(() => parseSpec<ChartSpec>(code), [code]);
  // A chart is a view of the data, not a verdict: the reader can re-plot the
  // same numbers as bars, a line or a pie without asking the model again.
  const [variant, setVariant] = useState<ChartSpec['type'] | null>(null);
  const normalized = useMemo(
    () => (parsed.spec ? normalizeChart(variant ? { ...parsed.spec, type: variant } : parsed.spec) : undefined),
    [parsed.spec, variant],
  );
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const chart = normalized?.chart;
  const spec = chart?.spec;

  const visible = useMemo(
    () => (chart ? chart.series.filter((s) => !hidden.has(s.key)) : []),
    [chart, hidden],
  );

  if (parsed.error || normalized?.error || !chart || !spec) {
    return (
      <VisualError
        message={parsed.error ?? normalized?.error ?? 'The chart spec could not be read.'}
        hint="Emit a fenced block tagged `chart` with { type, data: [ { label, value } ], title }. Type: line, area, bar, scatter, pie or donut."
        code={code}
      />
    );
  }

  const pie = spec.type === 'pie' || spec.type === 'donut';
  const height = Math.min(560, Math.max(180, spec.height ?? (pie ? 320 : 300)));
  const legendOn = spec.legend !== false;

  const toggle = (key: string) => {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else if (chart.series.length - next.size > 1) next.add(key);
      return next;
    });
  };

  const savePng = async () => {
    if (!svgRef.current) return;
    try {
      const blob = await svgToPngBlob(svgRef.current);
      downloadBlob(blob, safeFilename(spec.title, 'chart', 'png'));
    } catch {
      /* fall through to the SVG, which never needs a canvas */
      downloadText(serializeSvg(svgRef.current), safeFilename(spec.title, 'chart', 'svg'), 'image/svg+xml');
    }
  };

  return (
    <div className="relative">
      {view === 'chart' ? (
        <ChartCanvas
          ref={svgRef}
          chart={chart}
          visible={visible}
          height={height}
          legend={legendOn}
          hover={hover}
          onHover={setHover}
          onToggle={toggle}
        />
      ) : (
        <ChartTable chart={chart} />
      )}

      {hover !== null && view === 'chart' && !pie ? (
        <HoverCard chart={chart} index={hover} visibleKeys={new Set(visible.map((s) => s.key))} />
      ) : null}

      <VisualFooter note={`${spec.type}${chart.rows.length ? ` · ${chart.rows.length} rows` : ''}`}>
        <div className="mr-1 flex items-center gap-0.5 rounded-md border border-line-soft p-0.5" role="group" aria-label="Chart type">
          {(['bar', 'line', 'area', 'pie', 'donut'] as const).map((type) => (
            <button
              key={type}
              type="button"
              title={`Re-plot as ${type}`}
              onClick={() => {
                setVariant(type === parsed.spec?.type ? null : type);
                setHidden(new Set());
              }}
              className={cn(
                'rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors',
                spec.type === type ? 'bg-white/[0.08] text-fg-2' : 'text-faint hover:text-fg-2',
              )}
            >
              {type === 'donut' ? '◍' : type === 'pie' ? '◔' : type === 'bar' ? '▮' : type === 'line' ? '∿' : '▤'}
            </button>
          ))}
        </div>
        <FooterButton
          icon={<Table2 size={11} />}
          label={view === 'chart' ? 'table' : 'chart'}
          title="Switch between the drawing and the numbers"
          active={view === 'table'}
          onClick={() => setView((current) => (current === 'chart' ? 'table' : 'chart'))}
        />
        <FooterButton icon={<Download size={11} />} label="svg" onClick={() => svgRef.current && downloadText(serializeSvg(svgRef.current), safeFilename(spec.title, 'chart', 'svg'), 'image/svg+xml')} />
        <FooterButton icon={<ImageIcon size={11} />} label="png" onClick={() => void savePng()} />
        <FooterButton icon={<Download size={11} />} label="csv" onClick={() => downloadText(chartToCsv(chart), safeFilename(spec.title, 'data', 'csv'), 'text/csv;charset=utf-8')} />
        <FooterButton icon={<FileJson size={11} />} label="spec" onClick={() => downloadJson({ ...spec, type: 'chart' }, safeFilename(spec.title, 'chart', 'json'))} />
      </VisualFooter>
      <span className="sr-only">{describe(chart)}</span>
    </div>
  );
}

function describe(chart: NormalizedChart): string {
  const first = chart.rows[0];
  return `Chart: ${chart.spec.title ?? chart.xKey}, ${chart.series.map((s) => s.name).join(', ')} across ${chart.rows.length} rows${
    first ? `, starting at ${first.label}` : ''
  }.`;
}

const ChartCanvas = ({
  ref,
  chart,
  visible,
  height,
  legend,
  hover,
  onHover,
  onToggle,
}: {
  ref: React.RefObject<SVGSVGElement | null>;
  chart: NormalizedChart;
  visible: NormalizedChart['series'];
  height: number;
  legend: boolean;
  hover: number | null;
  onHover: (index: number | null) => void;
  onToggle: (key: string) => void;
}) => {
  const spec = chart.spec;
  const headerH = spec.title ? (spec.subtitle ? 44 : 30) : 10;
  const top = 10 + headerH;
  const left = 60;
  const right = 24;
  const xLabelsH = 26;
  const legendH = legend ? 26 : 0;
  const xLabelH = spec.xLabel ? 16 : 0;
  const bottom = xLabelsH + legendH + xLabelH + 10;
  const plotW = W - left - right;
  const plotH = height - top - bottom;
  const vbH = height;
  const n = chart.rows.length;
  const bandW = plotW / Math.max(1, n);

  const values = chart.rows.flatMap((row) => visible.map((s) => row.values[s.key]).filter((v): v is number => v !== null));
  const rawMin = values.length ? Math.min(...values) : 0;
  const rawMax = values.length ? Math.max(...values) : 1;
  const zeroBase = spec.type === 'bar' || spec.type === 'area' || spec.stacked;
  const min = zeroBase ? Math.min(0, rawMin) : rawMin - Math.abs(rawMax - rawMin) * 0.08 || 0;
  const max = zeroBase ? Math.max(0, rawMax) : rawMax + Math.abs(rawMax - rawMin) * 0.08 || 1;
  const ticks = niceTicks(min, max === min ? min + 1 : max, 4);
  const domainMin = Math.min(min, ticks[0] ?? min);
  const domainMax = Math.max(max, ticks[ticks.length - 1] ?? max);
  const y = (value: number) => top + plotH - ((value - domainMin) / (domainMax - domainMin || 1)) * plotH;
  const baseline = y(Math.max(domainMin, Math.min(0, domainMax)));
  const cx = (index: number) => left + bandW * (index + 0.5);

  const labelEvery = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(plotW / 78))));

  if (spec.type === 'pie' || spec.type === 'donut') {
    return (
      <svg ref={ref} viewBox={`0 0 ${W} ${vbH}`} width="100%" role="img" aria-label={describe(chart)} className="block">
        <rect width={W} height={vbH} fill="transparent" />
        {spec.title ? (
          <text x={W / 2} y={26} textAnchor="middle" fill={TITLE} fontSize={17} fontWeight={600} fontFamily="inherit">
            {spec.title}
          </text>
        ) : null}
        <PieSlices
          chart={chart}
          visible={visible}
          cx={W * 0.36}
          cy={vbH / 2 + 6}
          radius={Math.min(plotH, 260) / 2}
          hover={hover}
          onHover={onHover}
        />
        {legend ? <PieLegend chart={chart} visible={visible} x={W * 0.66} cy={vbH / 2 - 60} /> : null}
      </svg>
    );
  }

  const grouped = !spec.stacked;
  const groupW = bandW * 0.66;
  const barW = grouped ? Math.max(2, groupW / Math.max(1, visible.length)) : Math.max(2, groupW);

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${W} ${vbH}`}
      width="100%"
      role="img"
      aria-label={describe(chart)}
      className="block touch-manipulation"
      onMouseLeave={() => onHover(null)}
    >
      <rect width={W} height={vbH} fill="transparent" />

      {spec.title ? (
        <text x={left - 34} y={26} fill={TITLE} fontSize={17} fontWeight={600} fontFamily="inherit">
          {spec.title}
        </text>
      ) : null}
      {spec.subtitle ? (
        <text x={left - 34} y={45} fill={LABEL} fontSize={12} fontFamily="inherit">
          {spec.subtitle}
        </text>
      ) : null}

      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={left} x2={W - right} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? AXIS_LINE : GRID} strokeWidth={1} />
          <text x={left - 10} y={y(tick) + 3.5} textAnchor="end" fill={AXIS} fontSize={10.5} fontFamily="ui-monospace, monospace">
            {formatValue(tick, chart.format, spec.unit)}
          </text>
        </g>
      ))}

      {spec.yLabel ? (
        <text x={14} y={top + plotH / 2} fill={LABEL} fontSize={10.5} transform={`rotate(-90 14 ${top + plotH / 2})`} textAnchor="middle">
          {spec.yLabel}
        </text>
      ) : null}

      {chart.rows.map((row, index) =>
        index % labelEvery === 0 ? (
          <text
            key={`x-${index}`}
            x={cx(index)}
            y={top + plotH + 17}
            textAnchor="middle"
            fill={hover === index ? TITLE : AXIS}
            fontSize={10.5}
            fontFamily="inherit"
          >
            {row.label.length > 14 ? `${row.label.slice(0, 13)}…` : row.label}
          </text>
        ) : null,
      )}
      {spec.xLabel ? (
        <text x={left + plotW / 2} y={top + plotH + xLabelsH + legendH - 2} textAnchor="middle" fill={LABEL} fontSize={10.5}>
          {spec.xLabel}
        </text>
      ) : null}

      {hover !== null && hover < n ? (
        <rect x={left + bandW * hover} y={top} width={bandW} height={plotH} fill="rgba(255,255,255,0.035)" />
      ) : null}

      {spec.type === 'bar'
        ? chart.rows.map((row, index) => {
            let stackPos = 0;
            let stackNeg = 0;
            return visible.map((series, sIndex) => {
              const value = row.values[series.key];
              if (value === null || value === 0) return null;
              let xPos: number;
              let yTop: number;
              let yBottom: number;
              if (grouped) {
                xPos = cx(index) - groupW / 2 + sIndex * (groupW / Math.max(1, visible.length));
                yTop = y(value);
                yBottom = baseline;
              } else {
                xPos = cx(index) - groupW / 2;
                const start = value > 0 ? stackPos : stackNeg;
                const end = start + value;
                if (value > 0) stackPos = end;
                else stackNeg = end;
                yTop = y(end);
                yBottom = y(start);
              }
              return (
                <rect
                  key={`${series.key}-${index}`}
                  x={xPos}
                  y={Math.min(yTop, yBottom)}
                  width={grouped ? Math.max(1, groupW / Math.max(1, visible.length) - 2) : barW}
                  height={Math.max(1.5, Math.abs(yBottom - yTop))}
                  rx={2}
                  fill={series.color}
                  opacity={hover === null || hover === index ? 1 : 0.55}
                  style={{ transition: 'opacity 120ms ease' }}
                />
              );
            });
          })
        : null}

      {spec.type !== 'bar'
        ? visible.map((series) => {
            const points = chart.rows.map((row, index) => ({ index, value: row.values[series.key] }));
            const segments: Array<Array<{ x: number; y: number }>> = [];
            let current: Array<{ x: number; y: number }> = [];
            for (const point of points) {
              if (point.value === null) {
                if (current.length) segments.push(current);
                current = [];
                continue;
              }
              current.push({ x: cx(point.index), y: y(point.value) });
            }
            if (current.length) segments.push(current);
            const line = segments
              .map((segment) => segment.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '))
              .join(' ');
            const area = segments
              .map((segment) => {
                if (!segment.length) return '';
                const head = `M${segment[0]!.x.toFixed(2)},${baseline.toFixed(2)}`;
                const body = segment.map((p) => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
                return `${head} ${body} L${segment[segment.length - 1]!.x.toFixed(2)},${baseline.toFixed(2)} Z`;
              })
              .join(' ');
            const dots = spec.type === 'scatter';
            return (
              <g key={series.key}>
                {spec.type === 'area' ? <path d={area} fill={series.color} opacity={0.16} /> : null}
                {!dots ? (
                  <path
                    d={line}
                    fill="none"
                    stroke={series.color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={hover === null ? 1 : 0.9}
                  />
                ) : null}
                {(dots || hover !== null) &&
                  points.map((point) =>
                    point.value === null ? null : (
                      <circle
                        key={`${series.key}-dot-${point.index}`}
                        cx={cx(point.index)}
                        cy={y(point.value)}
                        r={dots ? (hover === point.index ? 4.5 : 3) : hover === point.index ? 4 : 2.6}
                        fill={series.color}
                        stroke="#14141c"
                        strokeWidth={1.5}
                      />
                    ),
                  )}
              </g>
            );
          })
        : null}

      <line x1={left} x2={W - right} y1={top + plotH} y2={top + plotH} stroke={AXIS_LINE} strokeWidth={1} />

      {legend && chart.series.length > 1 ? (
        <g>
          {chart.series.map((series, index) => {
            const isHidden = !visible.some((v) => v.key === series.key);
            const xPos = left + index * Math.min(180, plotW / Math.max(1, chart.series.length));
            return (
              <g
                key={series.key}
                transform={`translate(${xPos}, ${top + plotH + 40})`}
                onClick={() => onToggle(series.key)}
                style={{ cursor: 'pointer' }}
                opacity={isHidden ? 0.38 : 1}
              >
                <rect x={0} y={-7} width={9} height={9} rx={2} fill={series.color} />
                <text x={15} y={1} fill={LABEL} fontSize={10.5} fontFamily="inherit">
                  {series.name ?? series.key}
                </text>
              </g>
            );
          })}
        </g>
      ) : null}

      <rect
        x={left}
        y={top}
        width={plotW}
        height={plotH}
        fill="transparent"
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (!rect.width) return;
          const vbX = (event.clientX - rect.left) * (plotW / rect.width) + left;
          const index = Math.max(0, Math.min(n - 1, Math.floor((vbX - left) / bandW)));
          onHover(index);
        }}
      />
    </svg>
  );
};

function HoverCard({
  chart,
  index,
  visibleKeys,
}: {
  chart: NormalizedChart;
  index: number;
  visibleKeys: Set<string>;
}) {
  const row = chart.rows[index];
  if (!row) return null;
  const n = chart.rows.length;
  const ratio = (index + 0.5) / Math.max(1, n);
  const align = ratio > 0.72 ? 'right' : ratio < 0.28 ? 'left' : 'center';
  const transform = align === 'right' ? 'translate(-100%, 0)' : align === 'left' ? 'translate(0, 0)' : 'translate(-50%, 0)';
  return (
    <div
      className="pointer-events-none absolute z-10 max-w-[240px] rounded-lg border border-line bg-ink-950/95 px-2.5 py-2 shadow-lg backdrop-blur"
      style={{
        left: `calc(${(ratio * 100).toFixed(2)}% - ${align === 'right' ? 8 : align === 'left' ? -8 : 0}px)`,
        top: 12,
        transform,
      }}
    >
      <p className="mono text-[10px] uppercase tracking-wider text-faint">{row.label}</p>
      <div className="mt-1 space-y-0.5">
        {chart.series
          .filter((series) => visibleKeys.has(series.key))
          .map((series) => (
            <div key={series.key} className="flex items-baseline gap-1.5 text-[11px]">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: series.color }} />
              <span className="text-muted">{series.name}</span>
              <span className="mono ml-auto text-fg-2">
                {row.values[series.key] === null ? '—' : formatValue(row.values[series.key]!, chart.format, chart.spec.unit)}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

function PieSlices({
  chart,
  visible,
  cx,
  cy,
  radius,
  hover,
  onHover,
}: {
  chart: NormalizedChart;
  visible: NormalizedChart['series'];
  cx: number;
  cy: number;
  radius: number;
  hover: number | null;
  onHover: (index: number | null) => void;
}) {
  const series = visible[0] ?? chart.series[0];
  if (!series) return null;
  const values = chart.rows.map((row) => Math.max(0, row.values[series.key] ?? 0));
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  let angle = -Math.PI / 2;
  const donut = chart.spec.type === 'donut';
  return (
    <g>
      {chart.rows.map((row, index) => {
        const value = values[index] ?? 0;
        const sweep = (value / total) * Math.PI * 2;
        const start = angle;
        angle += sweep;
        if (value <= 0) return null;
        const large = sweep > Math.PI ? 1 : 0;
        const outer = hover === index ? radius * 1.03 : radius;
        const inner = donut ? radius * 0.58 : 0;
        const path = [
          `M${(cx + Math.cos(start) * outer).toFixed(2)},${(cy + Math.sin(start) * outer).toFixed(2)}`,
          `A${outer},${outer} 0 ${large} 1 ${(cx + Math.cos(angle) * outer).toFixed(2)},${(cy + Math.sin(angle) * outer).toFixed(2)}`,
          inner
            ? `L${(cx + Math.cos(angle) * inner).toFixed(2)},${(cy + Math.sin(angle) * inner).toFixed(2)}`
            : `L${cx},${cy}`,
          inner
            ? `A${inner},${inner} 0 ${large} 0 ${(cx + Math.cos(start) * inner).toFixed(2)},${(cy + Math.sin(start) * inner).toFixed(2)}`
            : '',
          'Z',
        ]
          .filter(Boolean)
          .join(' ');
        const color = CHART_PALETTE[index % CHART_PALETTE.length]!;
        const mid = (start + angle) / 2;
        return (
          <g key={row.label}>
            <path
            d={path}
            fill={color}
            opacity={hover === null || hover === index ? 1 : 0.5}
            onMouseEnter={() => onHover(index)}
            onMouseLeave={() => onHover(null)}
            style={{ cursor: 'pointer' }}
          />
            {sweep > 0.34 ? (
              <text
                x={cx + Math.cos(mid) * radius * 0.72}
                y={cy + Math.sin(mid) * radius * 0.72}
                fill="#14141c"
                fontSize={11}
                fontWeight={600}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {Math.round((value / total) * 100)}%
              </text>
            ) : null}
          </g>
        );
      })}
      {donut ? (
        <>
          <text x={cx} y={cy - 2} textAnchor="middle" fill={TITLE} fontSize={20} fontWeight={600}>
            {formatValue(total, chart.format, chart.spec.unit)}
          </text>
          <text x={cx} y={cy + 16} textAnchor="middle" fill={AXIS} fontSize={10.5}>
            {series.name ?? series.key}
          </text>
        </>
      ) : null}
    </g>
  );
}

function PieLegend({ chart, visible, x, cy }: { chart: NormalizedChart; visible: NormalizedChart['series']; x: number; cy: number }) {
  const series = visible[0] ?? chart.series[0];
  if (!series) return null;
  const total = chart.rows.reduce((sum, row) => sum + Math.max(0, row.values[series.key] ?? 0), 0) || 1;
  return (
    <g>
      {chart.rows.slice(0, 12).map((row, index) => {
        const value = Math.max(0, row.values[series.key] ?? 0);
        return (
          <g key={row.label} transform={`translate(${x}, ${cy + index * 24})`}>
            <rect x={0} y={-8} width={9} height={9} rx={2} fill={CHART_PALETTE[index % CHART_PALETTE.length]} />
            <text x={16} y={0} fill={LABEL} fontSize={11}>
              {row.label.length > 18 ? `${row.label.slice(0, 17)}…` : row.label}
            </text>
            <text x={Math.min(250, W - x - 40)} y={0} textAnchor="end" fill={AXIS} fontSize={10.5} fontFamily="ui-monospace, monospace">
              {Math.round((value / total) * 100)}%
            </text>
          </g>
        );
      })}
    </g>
  );
}

function ChartTable({ chart }: { chart: NormalizedChart }) {
  const spec = chart.spec;
  return (
    <div className="max-h-[360px] overflow-auto">
      <table className="w-full border-collapse text-[11.5px]">
        <thead className="sticky top-0 bg-ink-950/95">
          <tr>
            <th className="border-b border-line-soft px-3 py-1.5 text-left font-mono text-[9.5px] uppercase tracking-wider text-faint">
              {chart.xKey}
            </th>
            {chart.series.map((series) => (
              <th
                key={series.key}
                className="border-b border-line-soft px-3 py-1.5 text-right font-mono text-[9.5px] uppercase tracking-wider text-faint"
              >
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: series.color }} />
                  {series.name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.rows.map((row, index) => (
            <tr key={index} className={cn(index % 2 === 0 ? 'bg-white/[0.015]' : '')}>
              <td className="border-b border-line-soft/60 px-3 py-1.5 text-fg-2">{row.label}</td>
              {chart.series.map((series) => (
                <td key={series.key} className="mono border-b border-line-soft/60 px-3 py-1.5 text-right text-muted">
                  {row.values[series.key] === null ? '—' : formatValue(row.values[series.key]!, spec.format, spec.unit)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Icon for the artifact header, so a chart reads as a chart at a glance. */
export function chartIcon(type: ChartSpec['type'] | undefined) {
  if (type === 'pie' || type === 'donut') return <PieChart size={12} />;
  if (type === 'line' || type === 'area' || type === 'scatter') return <LineChart size={12} />;
  return <BarChart3 size={12} />;
}
