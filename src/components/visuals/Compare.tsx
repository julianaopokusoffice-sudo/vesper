import { Columns2 } from 'lucide-react';
import { parseSpec, type ChartSpec, type SceneSpec } from '../../../shared/visuals';
import { Chart } from './Chart';
import { Scene3D } from './Scene3D';
import { VisualError } from './VisualChrome';

interface Pane {
  label?: string;
  kind?: 'chart' | 'scene';
  spec?: ChartSpec | SceneSpec;
}

interface CompareSpec {
  title?: string;
  panes?: Pane[];
  left?: Pane;
  right?: Pane;
}

/**
 * Two versions of the same thing, side by side: before/after, model A/model B,
 * observed/projected. Comparison is how a claim becomes an argument, so it gets
 * a first-class block instead of two figures stacked in the transcript.
 */
export function Compare({ code }: { code: string }) {
  const parsed = parseSpec<CompareSpec>(code);
  const spec = parsed.spec;
  const panes = spec ? (Array.isArray(spec.panes) ? spec.panes : [spec.left, spec.right].filter(Boolean) as Pane[]) : [];

  if (parsed.error || !spec || !panes.length) {
    return (
      <VisualError
        message={parsed.error ?? 'The comparison needs two panes.'}
        hint='{"panes":[{"label":"2020","kind":"chart","spec":{…}},{"label":"2024","kind":"chart","spec":{…}}]}'
        code={code}
      />
    );
  }

  return (
    <div className="grid gap-2 p-2 sm:grid-cols-2">
      {panes.slice(0, 2).map((pane, index) => {
        const kind = pane.kind ?? 'chart';
        // The pane header already names it; the chart should not repeat that.
        const payload = JSON.stringify({ ...(pane.spec ?? {}), title: undefined });
        return (
          <div key={index} className="overflow-hidden rounded-lg border border-line-soft bg-ink-1000/40">
            <div className="flex items-center gap-1.5 border-b border-line-soft px-2.5 py-1">
              <Columns2 size={10} className="text-faint" />
              <span className="truncate font-mono text-[9.5px] uppercase tracking-wider text-faint">
                {pane.label ?? (index === 0 ? 'left' : 'right')}
              </span>
            </div>
            {kind === 'scene' ? <Scene3D code={payload} /> : <Chart code={payload} />}
          </div>
        );
      })}
    </div>
  );
}
