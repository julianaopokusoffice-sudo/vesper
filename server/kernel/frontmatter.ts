export interface ParsedDoc {
  data: Record<string, string | string[]>;
  body: string;
}

/**
 * Minimal frontmatter reader for SKILL.md and persona files. Supports the flat
 * `key: value`, quoted strings, inline arrays `[a, b]`, and `- item` lists that
 * the Agent Skills spec and Claude Code subagents use. Anything more exotic is
 * kept as a raw string.
 */
export function parseFrontmatter(raw: string): ParsedDoc {
  const text = raw.replace(/\r\n/g, '\n');
  if (!text.startsWith('---')) return { data: {}, body: text.trim() };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: text.trim() };

  const head = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\n+/, '');
  const data: Record<string, string | string[]> = {};
  let currentKey: string | null = null;

  for (const line of head.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem && currentKey) {
      const existing = data[currentKey];
      const value = clean(listItem[1]!);
      data[currentKey] = Array.isArray(existing) ? [...existing, value] : [value];
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1]!;
    const value = kv[2]!.trim();
    currentKey = key;
    if (!value) {
      data[key] = [];
    } else if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => clean(s))
        .filter(Boolean);
    } else {
      data[key] = clean(value);
    }
  }
  return { data, body };
}

function clean(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '');
}

export function asString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(', ');
  return value ?? '';
}

export function asList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
