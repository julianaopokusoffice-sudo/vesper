import { useState } from 'react';
import { AlertTriangle, Command, FolderOpen, GitBranch, Puzzle, RefreshCw, ShieldAlert } from 'lucide-react';
import type { Plugin } from '@shared/types';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { CodeBlock } from './CodeBlock';
import { Button, Chip, PageHeader, SectionLabel, Toggle, cn } from './ui';

export function PluginsView() {
  const plugins = useStore((s) => s.plugins);
  const replacePlugins = useStore((s) => s.replacePlugins);
  const app = useStore((s) => s.app);
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    setBusy(true);
    try {
      replacePlugins(await api.reloadPlugins());
      toast('success', 'Plugins reloaded');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Reload failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-[900px]">
        <PageHeader
          title="Plugins"
          meta={<Chip tone="accent">{plugins.filter((p) => p.enabled).length} enabled</Chip>}
          subtitle="Plugins add tools from a folder: a plugin.json manifest plus either a JS module or a command template. Drop one into ~/.vesper/plugins and reload — no rebuild, no restart."
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => toast('info', `Plugin folder: ${app?.home}/plugins`)}>
                <FolderOpen size={12} /> Folder
              </Button>
              <Button variant="primary" size="sm" onClick={reload} disabled={busy}>
                <RefreshCw size={12} className={cn(busy && 'animate-spin')} /> Reload
              </Button>
            </>
          }
        />

        <div className="mt-5 grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {plugins.map((plugin) => (
            <PluginCard key={plugin.id} plugin={plugin} onToggle={async (enabled) => replacePlugins(await api.togglePlugin(plugin.id, enabled))} />
          ))}
          {!plugins.length && (
            <div className="rounded-xl border border-dashed border-line p-6 text-center text-[12px] text-faint md:col-span-2">
              No plugins found. Drop a folder with a plugin.json into the plugin directory and hit reload.
            </div>
          )}
        </div>

        <div className="mt-6 grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-line-soft bg-ink-950/30 p-4">
            <SectionLabel>plugin.json</SectionLabel>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
              <span className="mono text-fg-2">kind: "command"</span> maps each tool to an executable with{' '}
              <span className="mono">{'{{arg}}'}</span> placeholders — no shell involved. <span className="mono text-fg-2">kind: "js"</span>{' '}
              imports an ES module that exports a <span className="mono">tools</span> object.
            </p>
            <CodeBlock
              lang="json"
              code={`{
  "name": "git",
  "version": "1.0.0",
  "kind": "command",
  "tools": [{
    "name": "git_status",
    "description": "Show working tree status",
    "parameters": { "type": "object", "properties": {} },
    "command": "git",
    "args": ["status", "--short", "--branch"]
  }]
}`}
            />
          </div>
          <div className="rounded-xl border border-line-soft bg-ink-950/30 p-4">
            <SectionLabel>js plugin</SectionLabel>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
              Handlers get the parsed arguments and a context with the sandboxed workspace path. Set{' '}
              <span className="mono">requiresApproval</span> when a tool writes or runs something.
            </p>
            <CodeBlock
              lang="javascript"
              code={`export const tools = {
  async note_add(input, ctx) {
    await appendFile(
      join(ctx.workspace, 'NOTES.md'),
      '- ' + input.text + '\\n'
    );
    return 'saved';
  },
};`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function PluginCard({ plugin, onToggle }: { plugin: Plugin; onToggle: (enabled: boolean) => void }) {
  return (
    <div className={cn('flex flex-col rounded-xl border bg-ink-950/40 p-3.5', plugin.error ? 'border-danger/30' : 'border-line-soft', !plugin.enabled && 'opacity-60')}>
      <div className="flex items-start gap-2.5">
        <span className="mt-[2px] grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line bg-ink-900 text-muted">
          {plugin.id === 'git' ? <GitBranch size={13} /> : plugin.kind === 'command' ? <Command size={13} /> : <Puzzle size={13} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-[13px] font-medium text-fg">{plugin.name}</h3>
            <span className="mono text-[9.5px] text-faint">v{plugin.version}</span>
            <Chip tone={plugin.kind === 'command' ? 'cool' : 'violet'}>{plugin.kind}</Chip>
            {plugin.builtin && <Chip>bundled</Chip>}
          </div>
          <p className="mt-1 text-[11.5px] leading-snug text-muted">{plugin.description}</p>
        </div>
        <Toggle checked={plugin.enabled} onChange={onToggle} label={`Enable ${plugin.name}`} />
      </div>

      {plugin.error && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md border border-danger/25 bg-danger/[0.07] px-2 py-1.5 font-mono text-[10px] text-danger">
          <AlertTriangle size={11} className="mt-[1px] shrink-0" /> {plugin.error}
        </div>
      )}

      <div className="mt-2.5 flex flex-col gap-1">
        {plugin.tools.map((tool) => (
          <div key={tool.name} className="flex items-start gap-1.5 rounded-md border border-line-soft/60 px-2 py-1">
            <span className="mono mt-[1px] shrink-0 text-[10.5px] text-fg-2">{tool.name}</span>
            {tool.requiresApproval && (
              <span className="flex shrink-0 items-center gap-0.5 rounded border border-accent/25 px-1 font-mono text-[8px] uppercase text-accent">
                <ShieldAlert size={7} /> gate
              </span>
            )}
            <span className="ml-auto line-clamp-1 text-right text-[10px] leading-snug text-faint">{tool.description}</span>
          </div>
        ))}
      </div>

      <span className="mono mt-2.5 truncate text-[9.5px] text-faint/60">{plugin.path}</span>
    </div>
  );
}
