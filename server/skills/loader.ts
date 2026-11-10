import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BUNDLED, PATHS } from '../kernel/paths.ts';
import { asList, asString, parseFrontmatter } from '../kernel/frontmatter.ts';
import { readKV, writeKV } from '../kernel/kv.ts';
import type { Skill } from '../../shared/types.ts';

interface SkillState {
  enabled: Record<string, boolean>;
}

/**
 * Skills follow the Agent Skills format (agentskills.io): a directory with a
 * SKILL.md carrying `name` + `description` frontmatter. Discovery is progressive:
 * only name/description ever go into the prompt, and the full body is loaded on
 * demand through the `load_skill` tool. That keeps the context window honest.
 */
export function listSkills(): Skill[] {
  const state = readKV<SkillState>('skills', { enabled: {} });
  const byId = new Map<string, Skill>();

  for (const [dir, builtin] of [
    [BUNDLED.skills, true],
    [PATHS.skills, false],
  ] as const) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      let isDir = false;
      try {
        isDir = statSync(path).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;
      const file = join(path, 'SKILL.md');
      if (!existsSync(file)) continue;
      const skill = parseSkill(entry, file, builtin);
      if (!skill) continue;
      const toggled = state.enabled[skill.id];
      byId.set(skill.id, { ...skill, enabled: toggled ?? true });
    }
  }
  return [...byId.values()].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
}

function parseSkill(id: string, file: string, builtin: boolean): Skill | null {
  try {
    const raw = readFileSync(file, 'utf8');
    const { data, body } = parseFrontmatter(raw);
    return {
      id,
      name: asString(data.name) || id,
      description: asString(data.description) || 'No description provided.',
      license: asString(data.license) || undefined,
      allowedTools: asList(data['allowed-tools'] ?? data.allowedTools),
      body,
      path: file,
      enabled: true,
      tokens: Math.ceil(body.length / 4),
      builtin,
    };
  } catch {
    return null;
  }
}

export function enabledSkills(): Skill[] {
  return listSkills().filter((s) => s.enabled);
}

export function getSkill(id: string): Skill | undefined {
  return listSkills().find((s) => s.id === id || s.name.toLowerCase() === id.toLowerCase());
}

export function toggleSkill(id: string, enabled: boolean) {
  const state = readKV<SkillState>('skills', { enabled: {} });
  writeKV('skills', { enabled: { ...state.enabled, [id]: enabled } });
}
