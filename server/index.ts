import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createApi, VERSION } from './api.ts';
import { ensureDirs, PATHS } from './kernel/paths.ts';
import { store } from './kernel/store.ts';
import { syncPersonaFiles } from './agents/registry.ts';
import { providerInfos } from './providers/registry.ts';
import { startUpdateChecks } from './update/index.ts';
import { ensureMcpExample, refreshMcpTools, shutdownMcp } from './mcp/index.ts';
import { startAutomations, stopAutomations } from './automations/index.ts';

ensureDirs();
const db = store();
syncPersonaFiles();
seedWelcome();

const app = createApi();

// MCP: seed an example config on first run, then discover tools once so the
// first agent run does not pay the cost (and a broken server is visible early).
ensureMcpExample();
void refreshMcpTools();
startAutomations();
startUpdateChecks(VERSION);
process.on('exit', () => {
  shutdownMcp();
  stopAutomations();
});

// Serve the built renderer when it exists (desktop / production mode).
if (existsSync('dist/index.html')) {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', serveStatic({ path: './dist/index.html' }));
}

const port = Number(process.env.VESPER_PORT ?? 8787);
// Reachable on the LAN so paired devices can call /link. Set VESPER_HOST=127.0.0.1
// to keep even the link surface off the network.
const hostname = process.env.VESPER_HOST ?? '0.0.0.0';

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  const primary = providerInfos().find((p) => p.hasKey);
  const ready = primary ? `${primary.label} (${primary.models[0]})` : 'offline demo model';
  console.log(`\n  \x1b[38;5;214m◆\x1b[0m \x1b[1mVesper\x1b[0m  agent runtime`);
  console.log(`  \x1b[2m────────────────────────────────────────────\x1b[0m`);
  console.log(`  api      http://${hostname}:${info.port}/api`);
  console.log(`  home     ${PATHS.home}`);
  console.log(`  workspace ${PATHS.workspace}`);
  console.log(`  model    ${ready}`);
  console.log(`  \x1b[2mkeys are encrypted at rest · tools ask before they act\x1b[0m\n`);
});

process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});

function seedWelcome() {
  if (db.listThreads().length > 0) return;
  const thread = db.createThread({ title: 'Welcome to Vesper', agentId: 'vesper' });
  db.addMessage({
    id: randomUUID(),
    threadId: thread.id,
    role: 'assistant',
    agentId: 'vesper',
    lane: 'synthesis',
    content: `**Vesper is running locally.** Everything — threads, keys, tool output — stays on this machine.

- **Agents** are personas with their own prompts, model, temperature, and tool allow-list. Eight ship built in; edit them or write your own as \`~/.vesper/agents/*.md\`.
- **Council mode** sends one question to several agents at once, then a chair merges the answers. Switch it with the toggle above the composer.
- **Skills** are \`SKILL.md\` procedures loaded on demand — the model sees only a one-line summary until it calls \`load_skill\`.
- **Plugins** add tools from a folder: a \`plugin.json\` plus either a JS module or a command template. Git and notes are enabled by default.

You are on the **offline demo model**, so replies are generated locally with no network call. Open **Settings → Providers** and add an OpenAI, Anthropic, Groq, OpenRouter, Ollama, or custom endpoint key to switch to real inference — the interface is identical.

Try: *"Plan a two-week hardening sprint for a small web app"* in council mode with three agents selected.`,
    traces: [],
  });
}
