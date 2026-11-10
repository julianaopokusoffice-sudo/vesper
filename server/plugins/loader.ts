import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BUNDLED, PATHS } from '../kernel/paths.ts';
import { readKV, writeKV } from '../kernel/kv.ts';
import type { Plugin, PluginTool } from '../../shared/types.ts';

interface PluginState {
  enabled: Record<string, boolean>;
}

interface Manifest extends Partial<Omit<Plugin, 'id' | 'path' | 'builtin' | 'enabled' | 'tools'>> {
  name: string;
  tools?: (PluginTool & { command?: string; args?: string[] })[];
  entry?: string;
}

export interface PluginBinding {
  plugin: Plugin;
  tool: PluginTool;
  run: (input: Record<string, unknown>) => Promise<string>;
}

const moduleCache = new Map<string, any>();

export function listPlugins(): Plugin[] {
  const state = readKV<PluginState>('plugins', { enabled: {} });
  const byId = new Map<string, Plugin>();

  for (const [dir, builtin] of [
    [BUNDLED.plugins, true],
    [PATHS.plugins, false],
  ] as const) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      const root = join(dir, entry);
      try {
        if (!statSync(root).isDirectory()) continue;
      } catch {
        continue;
      }
      const manifestPath = join(root, 'plugin.json');
      if (!existsSync(manifestPath)) continue;
      let manifest: Manifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
      } catch (err) {
        byId.set(entry, {
          id: entry,
          name: entry,
          version: '0.0.0',
          description: 'Invalid plugin.json',
          kind: 'js',
          enabled: false,
          tools: [],
          path: root,
          builtin,
          error: err instanceof Error ? err.message : 'parse error',
        });
        continue;
      }
      const plugin: Plugin = {
        id: entry,
        name: manifest.name || entry,
        version: manifest.version || '0.0.0',
        description: manifest.description || '',
        author: manifest.author,
        kind: manifest.kind === 'command' ? 'command' : 'js',
        tools: (manifest.tools ?? []).map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters ?? { type: 'object', properties: {} },
          requiresApproval: !!t.requiresApproval,
        })),
        enabled: state.enabled[entry] ?? true,
        path: root,
        builtin,
      };
      if (!plugin.tools.length) plugin.error = 'No tools declared in plugin.json';
      byId.set(entry, plugin);
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function togglePlugin(id: string, enabled: boolean) {
  const state = readKV<PluginState>('plugins', { enabled: {} });
  writeKV('plugins', { enabled: { ...state.enabled, [id]: enabled } });
}

/** All tools from enabled plugins, ready to hand to the model. */
export function pluginBindings(): PluginBinding[] {
  const bindings: PluginBinding[] = [];
  for (const plugin of listPlugins()) {
    if (!plugin.enabled || plugin.error) continue;
    const manifest = readManifest(plugin.path);
    for (const tool of plugin.tools) {
      bindings.push({
        plugin,
        tool,
        run: (input) => execute(plugin, manifest, tool, input),
      });
    }
  }
  return bindings;
}

function readManifest(root: string): Manifest {
  try {
    return JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf8')) as Manifest;
  } catch {
    return { name: 'unknown' };
  }
}

async function execute(plugin: Plugin, manifest: Manifest, tool: PluginTool, input: Record<string, unknown>): Promise<string> {
  if (plugin.kind === 'command') {
    const spec = (manifest.tools ?? []).find((t) => t.name === tool.name);
    if (!spec?.command) throw new Error(`Plugin "${plugin.id}" tool "${tool.name}" has no command.`);
    const args = (spec.args ?? []).map((arg) => interpolate(arg, input));
    return runCommand(spec.command, args, input);
  }

  const entry = manifest.entry ?? 'index.mjs';
  const file = join(plugin.path, entry);
  if (!existsSync(file)) throw new Error(`Plugin entry not found: ${entry}`);
  let mod = moduleCache.get(file);
  if (!mod) {
    mod = await import(pathToFileURL(file).href);
    moduleCache.set(file, mod);
  }
  const table = mod.tools ?? mod.default?.tools ?? mod.default ?? mod;
  const handler = table?.[tool.name];
  if (typeof handler !== 'function') throw new Error(`Plugin "${plugin.id}" does not export a "${tool.name}" function.`);
  const result = await handler(input, {
    workspace: PATHS.workspace,
    plugin: plugin.id,
    fetch,
  });
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
}

function interpolate(template: string, input: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const value = key.split('.').reduce<any>((acc, part) => (acc == null ? acc : acc[part]), input);
    return value == null ? '' : String(value);
  });
}

function runCommand(command: string, args: string[], input: Record<string, unknown>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PATHS.workspace,
      windowsHide: true,
      shell: false,
      env: { ...process.env, VESPER_WORKSPACE: PATHS.workspace },
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Plugin command timed out after 20s: ${command}`));
    }, 20_000);

    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not start "${command}": ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const trimmed = out.trim();
      if (code === 0) return resolve(trimmed || '(no output)');
      reject(new Error(`${command} exited ${code}${err ? `: ${err.trim().slice(0, 800)}` : ''}`));
    });
    if (child.stdin) {
      child.stdin.write(JSON.stringify(input ?? {}));
      child.stdin.end();
    }
  });
}

export function reloadPlugins() {
  moduleCache.clear();
  return listPlugins();
}
