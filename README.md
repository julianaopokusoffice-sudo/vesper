# Vesper

**A local-first agentic workspace that runs on every machine you own — desktop, laptop, phone — and lets them drive each other over your own network.**

Vesper is an agent runtime with four surfaces: a **web console**, an **agentic coding CLI**, an **Android app with an on-demand Linux (PRoot) runtime**, and a **signed peer-to-peer mesh** that ties them together. Threads, keys, tool output and memory stay on the devices you control. There is no account, no relay, and no server of ours in the path.

Built for research, coding, and students: one persona runs tools on the machine you are sitting at, then hands a task to your laptop or your phone, with shared memory following you.

---

## Quick start

Requires Node.js 22.

```bash
npm ci
npm run dev          # API on :8787, console on :3000
```

Open <http://localhost:3000>. You start on the **offline demo model**, so everything works with no key and no network call. Add an OpenAI, Anthropic, Groq, OpenRouter, Ollama, LM Studio, llama.cpp or custom endpoint in **Settings → Providers** to switch to real inference — the interface does not change.

Other useful commands:

| Command | What it does |
| --- | --- |
| `npm run dev` | console + API together |
| `npm run dev:server` / `npm run dev:web` | either side alone |
| `npm run build` | typecheck + production console into `dist/` |
| `npm run start` | serve the built console from the API |
| `npm run cli -- run "task" --yes` | one-shot agentic run from the terminal |
| `npm run test:link` | end-to-end mesh test: two live nodes, 21 checks |
| `npm run mobile:runtime` | pin the Android Linux runtime (see below) |

---

## The four surfaces

### 1 · The console

Threads, personas (**Agents**), council mode (several agents answer, a chair merges), **Skills** (`SKILL.md` procedures loaded on demand), **Plugins** (extra tools from a folder), **Memory**, **Connectors** (mail, calendar, GitHub, Vercel, Railway, Supabase and friends), **Automations** (cron-style research briefings), **Devices**, and **Settings**. Tools that change things pause for approval; read-only tools run straight away.

While a run is live, a **thinking orb** shows the verb rather than a generic spinner: working while the model reasons, searching while it reads sources, solving while it uses tools, weaving while the chair merges the panel.

### 2 · The CLI — `vesper`

An agentic coding session in your terminal, talking to the same runtime:

```bash
vesper                                  # interactive session in this directory
vesper run "find the N+1 query in src and fix it" --yes
vesper run "write a test for the parser" --agent reviewer --verbose
vesper agents                            # list personas
vesper devices --probe                   # paired machines + capabilities
vesper code --scopes memory,files,agents # mint a pairing code
vesper pair http://192.168.1.20:8787 XXXX-XXXX
vesper remote pixel "run the suite and summarise the failures"
vesper remote laptop --shell "git log --oneline -5"
vesper memory list | add | search | sync
```

Flags: `--workspace <path>`, `--agent <id>`, `--yes`, `--json`, `--verbose`, `--quiet`. The session streams every tool call as it happens; `--json` gives a machine-readable transcript for scripts.

### 3 · The Android app

A real app, not a page: it boots an **Ubuntu root filesystem under PRoot on demand**, runs the Vesper node *inside* it on your phone, and opens the same console. No root, no emulator, no custom kernel.

- **Prepare Linux** unpacks the runtime (rootfs + Node + PRoot), verifying each file against a SHA-256 pinned at build time.
- **Start console** starts the node on `:8787` and opens the full console in a WebView, with a foreground service keeping it reachable.
- From there the phone pairs with your laptop exactly like any other device: same memory, same agents, same approvals, and it can accept a `shell` capability because it *has* a Linux userland to run it in.

Build notes live in [android/README.md](android/README.md); the short version:

```bash
npm run mobile:runtime   # pins rootfs + Node + PRoot into android/runtime/
npm run mobile:apk       # builds the payload, syncs Capacitor, assembles the APK
```

### 4 · The mesh — pairing two devices so each controls the other

On device **A**: **Devices → Generate pairing code** (choose capabilities). On device **B**: enter A's address and the code. One code produces **two** keys — A can call B and B can call A.

```
  ┌──────────────┐   signed /link calls    ┌──────────────┐
  │  phone       │◄───────────────────────►│  laptop      │
  │  Vesper in   │  invoke · task · memory │  Vesper      │
  │  PRoot       │                         │  console+CLI │
  └──────────────┘                         └──────┬───────┘
                                                  │  invoke · task
                                           ┌──────▼───────┐
                                           │  your server │
                                           └──────────────┘
```

Capabilities are separate grants — **memory**, **files**, **agents**, **shell**. A phone can contribute memory without ever being able to run code on your laptop. Every call is HMAC-signed over a timestamp, a single-use nonce and the body hash; replayed, edited or unsigned requests are refused, and each call lands in an audit log you can read in the Devices view.

```bash
vesper devices                          # who is paired, who is online
vesper remote laptop "summarise branch state"
vesper memory sync                      # converge memory with every peer
```

---

## How it fits together

```
src/          React console (web + desktop + the Android WebView)
mobile/web    Android boot screen: install / start / open a peer
cli/vesper.mjs  the CLI, no runtime dependency beyond Node
server/
  index.ts    entry: serves the built console on the API port
  api.ts      management API — loopback-only
  agent/      orchestrator: lanes, council, tool approval, prompt
  agents/     personas (built-in + ~/.vesper/agents/*.md)
  providers/  OpenAI, Anthropic, Groq, OpenRouter, Ollama, LM Studio, demo
  skills/     SKILL.md loader; plugins/  folder-based tools
  memory/     shared memory: id + content hash, source device, tags
  connectors/ the services around the work: sealed credentials, OAuth, one REST bridge
  automations/ scheduled read-only runs that leave markdown briefings
  link/       the device mesh: pairing, signatures, presence, remote runs
  kernel/     SQLite store, encrypted key storage, paths, frontmatter
shared/       types shared by every surface
android/      Kotlin: runtime installer, PRoot supervisor, Capacitor shell
```

**State** lives in `~/.vesper` (override with `VESPER_HOME`): SQLite database, sealed provider keys, skills, plugins, personas, logs. Tools run against `VESPER_WORKSPACE` (default `~/.vesper/workspace`), so you can point a run at any checkout with `--workspace`.

---

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — runtime, agent pipeline, link protocol, memory merge, Android PRoot layering
- [docs/SECURITY.md](docs/SECURITY.md) — threat model, key storage, what the mesh does and does not protect
- [android/README.md](android/README.md) — building the APK, and why `targetSdk` is 28

---

## What is verified here

The GitHub Actions CI workflow runs `npm ci`, `npm run typecheck`,
`npm run test:browser`, `npm run test:crew`, `npm run test:update`,
`npm run test:connectors`, and `npm run build`. The release workflow builds
Windows and Linux desktop packages and an Android APK. Tagged Android releases
require signing secrets; manual workflow runs from a branch can produce a
debug APK.

`npm run test:link` exercises pairing, presence, remote tool calls, capability
refusal, remote agent runs, bidirectional memory sync, audit logging, and live
revocation (21 checks). It is available as a separate test, not part of CI.
`npm run test:visuals` and local Android/desktop packaging are also separate
from the regular CI checks.

## Limits worth knowing

- The mesh is **LAN-only**: there is no relay, so both devices must be reachable on the same network (or you run a tunnel and set `VESPER_PUBLIC_URL`).
- Android builds target **SDK 28** on purpose so PRoot can exec inside app storage — sideload it; it is not a Play Store build.
- Signing keys are sealed to this machine's storage. There is no key recovery.

## License

MIT.
