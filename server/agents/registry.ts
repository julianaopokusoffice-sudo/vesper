import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_AGENTS } from './builtin.ts';
import { PATHS } from '../kernel/paths.ts';
import { store } from '../kernel/store.ts';
import { asList, asString, parseFrontmatter } from '../kernel/frontmatter.ts';
import type { Agent, ModelRef, ProviderId } from '../../shared/types.ts';

const ACCENTS = ['#f0b429', '#22d3ee', '#fb923c', '#86efac', '#f472b6', '#a78bfa', '#4ade80', '#60a5fa'];

export function listAgents(): Agent[] {
  const custom = store().customAgents();
  const byId = new Map<string, Agent>();
  for (const agent of BUILTIN_AGENTS) byId.set(agent.id, agent);
  for (const agent of custom) byId.set(agent.id, { ...agent, builtin: BUILTIN_AGENTS.some((b) => b.id === agent.id) });
  return [...byId.values()];
}

export function getAgent(id: string): Agent {
  const found = listAgents().find((a) => a.id === id);
  if (!found) throw new Error(`Unknown agent "${id}"`);
  return found;
}

export function saveAgent(input: Partial<Agent> & { id?: string }): Agent {
  const existing = input.id ? listAgents().find((a) => a.id === input.id) : undefined;
  const id = input.id ?? slugify(input.name ?? 'agent');
  const agent: Agent = {
    id,
    name: input.name?.trim() || existing?.name || 'New agent',
    handle: input.handle?.trim() || existing?.handle || id,
    role: input.role?.trim() || existing?.role || 'Custom',
    description: input.description ?? existing?.description ?? '',
    system: input.system ?? existing?.system ?? 'You are a helpful agent.',
    accent: input.accent ?? existing?.accent ?? ACCENTS[Math.floor(Math.random() * ACCENTS.length)]!,
    glyph: (input.glyph ?? existing?.glyph ?? input.name?.trim()?.[0] ?? 'A').slice(0, 2).toUpperCase(),
    model: input.model ?? existing?.model ?? null,
    temperature: clamp(input.temperature ?? existing?.temperature ?? 0.7, 0, 2),
    maxSteps: clamp(input.maxSteps ?? existing?.maxSteps ?? 6, 1, 24),
    tools: input.tools ?? existing?.tools ?? ['*'],
    skills: input.skills ?? existing?.skills ?? [],
    builtin: existing?.builtin ?? false,
    createdAt: existing?.createdAt || Date.now(),
  };
  store().saveAgent(agent);
  return agent;
}

export function deleteAgent(id: string) {
  store().deleteAgent(id);
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || `agent-${randomUUID().slice(0, 6)}`
  );
}

/** Import a Claude-Code-style subagent markdown file into the roster. */
export function importPersona(raw: string, fileName = ''): Agent {
  const { data, body } = parseFrontmatter(raw);
  const name = asString(data.name) || fileName.replace(/\.md$/i, '') || 'Imported agent';
  const modelName = asString(data.model);
  const tools = asList(data.tools);
  const provider: ProviderId = modelName.startsWith('claude') ? 'anthropic' : modelName.startsWith('gpt') ? 'openai' : 'demo';
  const model: ModelRef | null = modelName ? { provider, id: modelName } : null;
  return saveAgent({
    id: slugify(name),
    name,
    handle: slugify(name),
    role: asString(data.role) || 'Imported',
    description: asString(data.description) || 'Imported from a persona file.',
    system: body,
    model,
    tools: tools.length ? tools : ['*'],
    skills: asList(data.skills),
  });
}

/** Pick up `~/.vesper/agents/*.md` on boot so personas are just files on disk. */
export function syncPersonaFiles() {
  if (!existsSync(PATHS.personas)) return;
  const existing = new Set(listAgents().map((a) => a.id));
  for (const file of readdirSync(PATHS.personas).filter((f) => f.endsWith('.md'))) {
    const id = slugify(file.replace(/\.md$/i, ''));
    if (existing.has(id)) continue;
    try {
      importPersona(readFileSync(join(PATHS.personas, file), 'utf8'), file);
    } catch {
      /* a malformed persona file should never block boot */
    }
  }
}

/** Write a persona back out as a portable markdown file. */
export function exportPersona(agent: Agent): string {
  mkdirSync(PATHS.personas, { recursive: true, mode: 0o700 });
  const frontmatter = [
    '---',
    `name: ${agent.name}`,
    `description: ${agent.description.replace(/\n/g, ' ')}`,
    `role: ${agent.role}`,
    ...(agent.model ? [`model: ${agent.model.id}`] : []),
    `tools: [${agent.tools.join(', ')}]`,
    ...(agent.skills.length ? [`skills: [${agent.skills.join(', ')}]`] : []),
    '---',
    '',
    agent.system,
    '',
  ].join('\n');
  const file = join(PATHS.personas, `${agent.id}.md`);
  writeFileSync(file, frontmatter, { mode: 0o600 });
  return file;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
